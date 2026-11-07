/**
 * MEMÓRIA DO HÓSPEDE · processo ASSÍNCRONO pós-checkout (diretriz do titular, 06/11/2026).
 *
 * Cada execução (o mesmo caminho idempotente serve à carga retroativa, quando autorizada):
 *  1. FAIL-CLOSED: só executa com `GUEST_MEMORY_WORKER=on` (exatamente) e teto diário válido em
 *     `GUEST_MEMORY_DAILY_COST_USD`; a configuração é validada antes de qualquer consulta ou chamada;
 *  2. lista estadias com CHECKOUT CONFIRMADO ainda sem memória (até 10, mais antigas primeiro);
 *  3. ADQUIRE cada estadia de forma exclusiva e atômica (`guest_ai_claim_stay_memory`): posse com prazo,
 *     recuperação de posse abandonada, até 3 tentativas, reserva do pior caso de custo no teto diário do
 *     banco (inclusive de tentativas concorrentes e interrompidas) e teto por execução;
 *  4. garante o perfil do TITULAR pelas identidades da Channex; reservas antigas recuperam a conta OTA do
 *     payload bruto da Channex (só o id; nada mais do payload é usado);
 *  5. lê a conversa da reserva (titular, acompanhante, equipe, notas internas) e os fatos de horário;
 *  6. UMA chamada ao modelo, com teto do pior caso conferido ANTES da rede;
 *  7. grava (só quem detém a posse vigente) o resumo da estadia e a memória consolidada, com
 *     `behavioral_notes` (hospitalidade) e `internal_assessment` (só equipe) separados.
 * Roda mesmo com a equipe no comando (`ai_paused`): é resumo, não resposta ao hóspede. Nunca envia nada a
 * ninguém. Logs só com códigos (nunca conteúdo da conversa, das notas ou da avaliação).
 */
import { generateGuestLlm } from "@/lib/guest-ai/llm/gateway.server";
import type { LlmProvider } from "@/lib/guest-ai/llm/providers/types";
import { GUEST_AI_RESERVE_MODEL } from "@/lib/guest-ai/orchestrator/contracts";
import { propertyTimeZoneOrNull } from "@/lib/property-timezone";
import { otaGuestAccountId } from "@/lib/channex-guest-identity";
import {
  StayMemoryOutputError,
  emptyConsolidated,
  emptyStayAssessment,
  validateStayMemoryOutput,
  GUEST_MEMORY_VERSION,
  type ConsolidatedDimension,
  type HospitalityNote,
  type StayMemoryResult,
  type StaySummary,
} from "./contracts";
import {
  buildStayMemoryPrompt,
  deriveStayFacts,
  type ArrivalCard,
  type StayMessage,
  type StaySpeaker,
} from "./prompt";

/** Teto do PIOR CASO por estadia, já contando a nova tentativa interna do Gateway (2 tentativas). */
export const GUEST_MEMORY_MAX_CALL_COST_USD = 0.02;
export const GUEST_MEMORY_GATEWAY_ATTEMPTS = 2;
export const GUEST_MEMORY_MAX_OUTPUT_TOKENS = 2_048;
/** Até 10 estadias por execução (limite homologado). */
export const GUEST_MEMORY_DEFAULT_LIMIT = 10;
export const GUEST_MEMORY_MAX_LIMIT = 10;
export const GUEST_MEMORY_MAX_MESSAGES = 400;
/** Prazo de posse de uma estadia (s). Vencido, outro worker pode recuperar (a tentativa conta). */
export const GUEST_MEMORY_LEASE_SECONDS = 300;
export const GUEST_MEMORY_MAX_DAILY_CAP_USD = 10;

export interface GuestMemoryConfig {
  enabled: true;
  dailyCapUsd: number;
  limit: number;
  runBudgetUsd: number;
}

/**
 * Configuração FAIL-CLOSED: `null` ⇒ não executa. Habilita só com `GUEST_MEMORY_WORKER` exatamente `on` e
 * `GUEST_MEMORY_DAILY_COST_USD` numérico em (0, 10]. Ausente, vazio, `off`, `ON`, `true`, ` on`… ⇒ desligado.
 */
export function guestMemoryConfig(
  env: Record<string, string | undefined>,
  limit?: number,
): GuestMemoryConfig | null {
  if (env["GUEST_MEMORY_WORKER"] !== "on") return null;
  const rawCap = env["GUEST_MEMORY_DAILY_COST_USD"];
  if (typeof rawCap !== "string" || !/^\d+(\.\d+)?$/.test(rawCap)) return null;
  const cap = Number(rawCap);
  if (!Number.isFinite(cap) || cap <= 0 || cap > GUEST_MEMORY_MAX_DAILY_CAP_USD) return null;
  const want =
    typeof limit === "number" && Number.isFinite(limit)
      ? Math.floor(limit)
      : GUEST_MEMORY_DEFAULT_LIMIT;
  const n = Math.max(1, Math.min(GUEST_MEMORY_MAX_LIMIT, want));
  return {
    enabled: true,
    dailyCapUsd: cap,
    limit: n,
    runBudgetUsd: Math.min(cap, n * GUEST_MEMORY_MAX_CALL_COST_USD),
  };
}

/** WhatsApp de número que não é telefone oficial do titular ⇒ acompanhante (nunca vira preferência do titular). */
export function isCompanionSession(sessionId: string, titularPhones: readonly string[]): boolean {
  if (!sessionId.startsWith("wa:")) return false;
  const norm = (v: string) => v.replace(/\D/g, "").replace(/^00/, "");
  const session = norm(sessionId.slice(3));
  return !session || !titularPhones.some((p) => norm(p) === session);
}

export interface PendingStay {
  reservationId: string;
  propertyId: string;
  tenantId: string;
  checkoutDate: string;
}

export interface StayMaterial {
  otaGuestId: string | null;
  phones: string[];
  guestName: string | null;
  checkinDate: string | null;
  checkoutDate: string | null;
  checkinTime: string | null;
  checkoutTime: string | null;
  timeZone: string | null;
  checkinCard: ArrivalCard | null;
  checkoutCard: ArrivalCard | null;
  messages: StayMessage[];
}

export interface ProfileMemory {
  reservationIds: Set<string>;
  notes: HospitalityNote[];
  assessment: Partial<Record<string, ConsolidatedDimension>>;
  stays: Array<Pick<StaySummary, "hospitalidade" | "avaliacao"> & { checkout_date?: string }>;
}

export type ClaimResult =
  | { kind: "claimed"; token: string; attempt: number }
  | { kind: "completed" | "busy" | "exhausted" | "budget_daily_exceeded" | "invalid" };

/** Acesso a dados do processo (Supabase em produção; memória nos testes). */
export interface GuestMemoryStore {
  pending(limit: number): Promise<PendingStay[]>;
  /** Aquisição exclusiva e atômica, com reserva de custo no teto diário. */
  claim(
    stay: PendingStay,
    opts: { leaseSeconds: number; reserveUsd: number; dailyCapUsd: number },
  ): Promise<ClaimResult>;
  material(stay: PendingStay): Promise<StayMaterial | null>;
  upsertTitular(
    tenantId: string,
    ota: string | null,
    phones: string[],
    name: string | null,
  ): Promise<{ canonicalId: string } | { skipped: string }>;
  profile(tenantId: string, canonicalId: string): Promise<ProfileMemory | null>;
  record(input: {
    tenantId: string;
    canonicalId: string;
    reservationId: string;
    checkoutDate: string;
    token: string;
    result: StayMemoryResult;
  }): Promise<"recorded" | "exists" | "lease_lost" | "invalid">;
  finish(
    reservationId: string,
    token: string,
    status: "done" | "skipped" | "failed",
    reason: string,
    spentUsd: number,
  ): Promise<"finished" | "lease_lost" | "invalid">;
}

export interface GuestMemoryCycleDeps {
  store: GuestMemoryStore;
  env?: Record<string, string | undefined>;
  provider?: LlmProvider;
  limit?: number;
  modelId?: string;
  log?: (event: Record<string, unknown>) => void;
}

export interface GuestMemoryCycleResult {
  status: "off" | "ran";
  processed: number;
  recorded: number;
  skipped: number;
  failed: number;
  notClaimed: number;
  stoppedBy: "none" | "run_budget" | "daily_budget";
  costUsd: number;
}

/** Processa um lote de estadias. Nunca lança por falha de uma estadia; erros viram códigos fechados. */
export async function runGuestMemoryCycle(
  deps: GuestMemoryCycleDeps,
): Promise<GuestMemoryCycleResult> {
  const result: GuestMemoryCycleResult = {
    status: "ran",
    processed: 0,
    recorded: 0,
    skipped: 0,
    failed: 0,
    notClaimed: 0,
    stoppedBy: "none",
    costUsd: 0,
  };
  // FAIL-CLOSED: nada é consultado, adquirido ou chamado sem configuração explícita e válida
  const cfg = guestMemoryConfig(deps.env ?? process.env, deps.limit);
  if (!cfg) return { ...result, status: "off" };
  const log = deps.log ?? ((e) => console.info("[guest-memory]", JSON.stringify(e)));
  // Rotina de fundo com teto de US$ 0,01 por tentativa: roda no Reserva do catálogo (o Titular não cabe no teto).
  const modelId = deps.modelId ?? GUEST_AI_RESERVE_MODEL;
  const pending = await deps.store.pending(cfg.limit);
  let reservedThisRun = 0;

  for (const stay of pending.slice(0, cfg.limit)) {
    // teto por execução: reserva o pior caso ANTES de adquirir a estadia
    if (reservedThisRun + GUEST_MEMORY_MAX_CALL_COST_USD > cfg.runBudgetUsd + 1e-9) {
      result.stoppedBy = "run_budget";
      break;
    }
    let claim: ClaimResult;
    try {
      claim = await deps.store.claim(stay, {
        leaseSeconds: GUEST_MEMORY_LEASE_SECONDS,
        reserveUsd: GUEST_MEMORY_MAX_CALL_COST_USD,
        dailyCapUsd: cfg.dailyCapUsd,
      });
    } catch {
      claim = { kind: "invalid" };
    }
    if (claim.kind === "budget_daily_exceeded") {
      result.stoppedBy = "daily_budget";
      log({ reservation: stay.reservationId, status: "not_claimed", reason: claim.kind });
      break;
    }
    if (claim.kind !== "claimed") {
      result.notClaimed += 1;
      log({ reservation: stay.reservationId, status: "not_claimed", reason: claim.kind });
      continue;
    }
    const lease = claim;
    reservedThisRun += GUEST_MEMORY_MAX_CALL_COST_USD;
    result.processed += 1;
    let spent = 0;
    const done = async (status: "done" | "skipped" | "failed", reason: string) => {
      if (status === "done") result.recorded += 1;
      else if (status === "skipped") result.skipped += 1;
      else result.failed += 1;
      log({ reservation: stay.reservationId, attempt: lease.attempt, status, reason });
      await deps.store
        .finish(stay.reservationId, lease.token, status, reason, Math.round(spent * 1e6) / 1e6)
        .catch(() => undefined);
    };
    try {
      const m = await deps.store.material(stay);
      if (!m) {
        await done("skipped", "material_missing");
        continue;
      }
      const titular = await deps.store.upsertTitular(
        stay.tenantId,
        m.otaGuestId,
        m.phones,
        m.guestName,
      );
      if ("skipped" in titular) {
        await done("skipped", `titular_${titular.skipped}`);
        continue;
      }
      const profile = await deps.store.profile(stay.tenantId, titular.canonicalId);
      if (!profile) {
        await done("failed", "profile_missing");
        continue;
      }
      if (profile.reservationIds.has(stay.reservationId)) {
        await done("done", "already_recorded");
        continue;
      }

      let memory: StayMemoryResult;
      if (m.messages.length === 0) {
        // sem conversa: registra a estadia sem chamar o modelo; a memória consolidada fica como estava
        memory = {
          summary: {
            versao: GUEST_MEMORY_VERSION,
            hospitalidade: [],
            avaliacao: emptyStayAssessment(),
            fonte: "sem_conversa",
          },
          behavioralNotes: profile.notes,
          internalAssessment: {
            ...emptyConsolidated(),
            ...profile.assessment,
            versao: GUEST_MEMORY_VERSION,
          },
        };
      } else {
        const prompt = buildStayMemoryPrompt(
          {
            previousNotes: profile.notes,
            previousAssessment: profile.assessment,
            previousStays: profile.stays,
            stay: { checkinDate: m.checkinDate, checkoutDate: m.checkoutDate },
            facts: deriveStayFacts(m),
            messages: m.messages.slice(-GUEST_MEMORY_MAX_MESSAGES),
          },
          {
            modelId,
            maxOutputTokens: GUEST_MEMORY_MAX_OUTPUT_TOKENS,
            // o teto vale para o pior caso das DUAS tentativas que o Gateway pode fazer
            maxCallCostUsd: GUEST_MEMORY_MAX_CALL_COST_USD / GUEST_MEMORY_GATEWAY_ATTEMPTS,
          },
        );
        if (!prompt) {
          await done("failed", "budget_call_exceeded");
          continue;
        }
        const llm = await generateGuestLlm(
          {
            purpose: "evaluation",
            model: modelId,
            messages: prompt.messages,
            maxOutputTokens: GUEST_MEMORY_MAX_OUTPUT_TOKENS,
            reasoningEffort: "low",
            responseFormat: "json",
            traceId: `gm-${stay.reservationId}`.slice(0, 80),
          },
          { provider: deps.provider },
        );
        spent = llm.telemetry.costUsd;
        result.costUsd += spent;
        if (!llm.ok) {
          await done("failed", `llm_${llm.error.code}`);
          continue;
        }
        try {
          memory = validateStayMemoryOutput(llm.json, prompt.refs);
        } catch (e) {
          await done(
            "failed",
            e instanceof StayMemoryOutputError ? `output_${e.code}` : "output_invalid",
          );
          continue;
        }
      }
      const rec = await deps.store.record({
        tenantId: stay.tenantId,
        canonicalId: titular.canonicalId,
        reservationId: stay.reservationId,
        checkoutDate: stay.checkoutDate,
        token: lease.token,
        result: memory,
      });
      await done(rec === "recorded" || rec === "exists" ? "done" : "failed", rec);
    } catch {
      await done("failed", "internal_error");
    }
  }
  result.costUsd = Math.round(result.costUsd * 1e6) / 1e6;
  return result;
}

// ───────────────────────── implementação Supabase ─────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from(table: string): any; rpc(fn: string, args: Record<string, unknown>): any };

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function speakerOf(
  row: { role: string | null; sender_type: string | null; is_internal_note: boolean | null },
  companion: boolean,
): StaySpeaker {
  if (row.is_internal_note) return "nota_interna_equipe";
  if (row.role === "user" && row.sender_type === "guest")
    return companion ? "acompanhante" : "hospede_titular";
  if (row.role === "assistant" && row.sender_type === "human") return "equipe";
  if (row.sender_type === "system") return "sistema";
  return "desconhecido";
}

export function createSupabaseGuestMemoryStore(admin: Admin): GuestMemoryStore {
  return {
    async pending(limit) {
      const { data, error } = await admin.rpc("guest_ai_pending_stay_memories", { p_limit: limit });
      if (error || !Array.isArray(data)) throw new Error("pending_failed");
      return (data as Array<Record<string, unknown>>).map((r) => ({
        reservationId: String(r["reservation_id"]),
        propertyId: String(r["property_id"]),
        tenantId: String(r["tenant_id"]),
        checkoutDate: String(r["checkout_date"]).slice(0, 10),
      }));
    },

    async material(stay) {
      const { data: res } = await admin
        .from("property_reservations")
        .select(
          "id, property_id, source, external_uid, checkin_date, checkout_date, guest_hint, guest_contacts",
        )
        .eq("id", stay.reservationId)
        .eq("property_id", stay.propertyId)
        .maybeSingle();
      if (!res) return null;
      const contacts = (
        res.guest_contacts && typeof res.guest_contacts === "object" ? res.guest_contacts : {}
      ) as Record<string, unknown>;
      let ota = str(contacts["ota_guest_id"]);
      // reservas antigas: recupera a conta do hóspede no payload bruto da Channex e grava na reserva
      if (!ota && res.source === "channex" && res.external_uid) {
        const projection =
          "ota_name:payload->attributes->>ota_name, raw_message:payload->attributes->>raw_message";
        const bookingId = String(res.external_uid);
        // só o id da conta é extraído do payload bruto; nada mais dele é guardado ou registrado
        const { data: booking } = await admin
          .from("channex_raw_records")
          .select(projection)
          .eq("entity_type", "booking")
          .eq("channex_id", bookingId)
          .limit(1)
          .maybeSingle();
        let raw = booking;
        if (!raw) {
          const { data: revision } = await admin
            .from("channex_raw_records")
            .select(projection)
            .eq("entity_type", "booking_revision")
            .eq("payload->attributes->>booking_id", bookingId)
            .limit(1)
            .maybeSingle();
          raw = revision;
        }
        ota = raw
          ? otaGuestAccountId({ ota_name: raw.ota_name, raw_message: raw.raw_message })
          : null;
        // a conta recuperada é usada só neste processamento: a reserva NÃO é regravada (evita corrida com o
        // webhook da Channex, que já grava `ota_guest_id` nas reservas novas)
      }
      const phones = Array.isArray(contacts["phones"])
        ? (contacts["phones"] as unknown[]).filter((p): p is string => typeof p === "string")
        : [];
      const names = Array.isArray(contacts["names"]) ? (contacts["names"] as unknown[]) : [];
      const guestName = str(names[0]) ?? str(res.guest_hint);

      const { data: prop } = await admin
        .from("properties")
        .select("id, city, country, checkin_time, checkout_time")
        .eq("id", stay.propertyId)
        .maybeSingle();
      const { data: cards } = await admin
        .from("guest_arrival_status")
        .select(
          "kind, status, done_at, concluded_at, late_checkout_time, late_checkout_approved_at, late_checkout_by",
        )
        .eq("reservation_id", stay.reservationId);
      const card = (kind: string): ArrivalCard | null =>
        ((cards ?? []) as Array<ArrivalCard & { kind: string }>).find((c) => c.kind === kind) ??
        null;

      const { data: convs } = await admin
        .from("property_chat_conversations")
        .select("id, guest_session_id")
        .eq("reservation_id", stay.reservationId)
        .eq("property_id", stay.propertyId);
      const companionConv = new Set<string>();
      const channelOf = new Map<string, string>();
      for (const c of (convs ?? []) as Array<{ id: string; guest_session_id: string | null }>) {
        const sid = c.guest_session_id ?? "";
        channelOf.set(
          c.id,
          sid.startsWith("wa:") ? "whatsapp" : sid.startsWith("airbnb:") ? "airbnb" : "guia",
        );
        if (isCompanionSession(sid, phones)) companionConv.add(c.id);
      }
      let messages: StayMessage[] = [];
      const ids = [...channelOf.keys()];
      if (ids.length > 0) {
        const { data: msgs } = await admin
          .from("property_chat_messages")
          .select(
            "id, conversation_id, role, sender_type, content, created_at, is_internal_note, attachment_type, attachment_transcript",
          )
          .in("conversation_id", ids)
          .order("created_at", { ascending: true })
          .limit(GUEST_MEMORY_MAX_MESSAGES);
        messages = ((msgs ?? []) as Array<Record<string, unknown>>)
          .map((r, i) => {
            const text = [
              str(r["content"]),
              str(r["attachment_transcript"])
                ? `[transcrição] ${str(r["attachment_transcript"])}`
                : null,
              r["attachment_type"] && !str(r["content"]) && !str(r["attachment_transcript"])
                ? `[${String(r["attachment_type"])}]`
                : null,
            ]
              .filter(Boolean)
              .join(" ");
            return {
              id: `msg:${i + 1}`,
              speaker: speakerOf(r as never, companionConv.has(String(r["conversation_id"]))),
              channel: channelOf.get(String(r["conversation_id"])) ?? "desconhecido",
              at: String(r["created_at"]),
              text,
            };
          })
          .filter((m) => m.text.length > 0);
      }
      return {
        otaGuestId: ota,
        phones,
        guestName,
        checkinDate: str(res.checkin_date),
        checkoutDate: str(res.checkout_date),
        checkinTime: str(prop?.checkin_time),
        checkoutTime: str(prop?.checkout_time),
        timeZone: prop ? propertyTimeZoneOrNull(prop.city, prop.country) : null,
        checkinCard: card("checkin"),
        checkoutCard: card("checkout"),
        messages,
      };
    },

    async upsertTitular(tenantId, ota, phones, name) {
      const { data, error } = await admin.rpc("guest_ai_upsert_titular_profile", {
        p_tenant_id: tenantId,
        p_ota_account_id: ota,
        p_phones: phones,
        p_guest_name: name,
      });
      if (error || !data || typeof data !== "object") throw new Error("upsert_failed");
      const d = data as { result?: string; canonical_id?: string; reason?: string };
      if (d.result === "ok" && d.canonical_id) return { canonicalId: d.canonical_id };
      return { skipped: d.reason ?? d.result ?? "unknown" };
    },

    async profile(tenantId, canonicalId) {
      const { data } = await admin
        .from("guest_ai_guest_profiles")
        .select("canonical_id, tenant_id, behavioral_notes, internal_assessment, stay_summaries")
        .eq("canonical_id", canonicalId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (!data) return null;
      const stays = Array.isArray(data.stay_summaries)
        ? (data.stay_summaries as Array<Record<string, unknown>>)
        : [];
      return {
        reservationIds: new Set(stays.map((s) => String(s["reservation_id"] ?? ""))),
        notes: Array.isArray(data.behavioral_notes)
          ? (data.behavioral_notes as HospitalityNote[])
          : [],
        assessment:
          data.internal_assessment && typeof data.internal_assessment === "object"
            ? data.internal_assessment
            : {},
        stays: stays as ProfileMemory["stays"],
      };
    },

    async claim(stay, opts) {
      const { data, error } = await admin.rpc("guest_ai_claim_stay_memory", {
        p_reservation_id: stay.reservationId,
        p_tenant_id: stay.tenantId,
        p_lease_seconds: opts.leaseSeconds,
        p_reserve_usd: opts.reserveUsd,
        p_daily_cap_usd: opts.dailyCapUsd,
      });
      if (error || !data || typeof data !== "object") return { kind: "invalid" };
      const d = data as { result?: string; token?: string; attempt?: number };
      if (d.result === "claimed" && typeof d.token === "string")
        return { kind: "claimed", token: d.token, attempt: Number(d.attempt ?? 0) };
      if (
        d.result === "completed" ||
        d.result === "busy" ||
        d.result === "exhausted" ||
        d.result === "budget_daily_exceeded"
      )
        return { kind: d.result };
      return { kind: "invalid" };
    },

    async record({ tenantId, canonicalId, reservationId, checkoutDate, token, result }) {
      const { data, error } = await admin.rpc("guest_ai_record_stay_summary", {
        p_tenant_id: tenantId,
        p_canonical_id: canonicalId,
        p_reservation_id: reservationId,
        p_checkout: checkoutDate,
        p_summary: result.summary,
        p_behavioral_notes: result.behavioralNotes,
        p_internal_assessment: result.internalAssessment,
        p_lease_token: token,
      });
      if (error || !data) return "invalid";
      const r = (data as { result?: string }).result;
      return r === "recorded" || r === "exists" || r === "lease_lost" ? r : "invalid";
    },

    async finish(reservationId, token, status, reason, spentUsd) {
      const { data, error } = await admin.rpc("guest_ai_finish_stay_memory", {
        p_reservation_id: reservationId,
        p_token: token,
        p_status: status,
        p_reason: reason,
        p_spent_usd: spentUsd,
      });
      if (error || !data) return "invalid";
      const r = (data as { result?: string }).result;
      return r === "finished" || r === "lease_lost" ? r : "invalid";
    },
  };
}
