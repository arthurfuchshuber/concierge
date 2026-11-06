/**
 * MEMÓRIA DO HÓSPEDE · processo ASSÍNCRONO pós-checkout (diretriz do titular, 06/11/2026).
 *
 * Cada execução (cron horário + carga retroativa, o mesmo caminho idempotente):
 *  1. pega as estadias com CHECKOUT CONFIRMADO no sistema ainda sem memória (`guest_ai_pending_stay_memories`,
 *     mais antigas primeiro, até `limit`);
 *  2. garante o perfil do TITULAR pelas identidades da Channex (conta OTA e telefone oficial); a conta OTA de
 *     reservas antigas é recuperada do payload bruto da Channex e gravada em `guest_contacts.ota_guest_id`;
 *  3. lê a conversa da reserva (titular, acompanhante, equipe, notas internas) e os fatos objetivos;
 *  4. UMA chamada ao modelo, com custo por chamada limitado ANTES da rede, resume a estadia e reconsolida a
 *     memória com o histórico do hóspede;
 *  5. grava atomicamente: resumo da estadia (duas partes separadas), `behavioral_notes` (hospitalidade) e
 *     `internal_assessment` (só equipe).
 * Roda mesmo com a equipe no comando (`ai_paused`): é resumo, não resposta ao hóspede. Nunca envia nada a
 * ninguém. `GUEST_MEMORY_WORKER=off` desliga. Falha de uma estadia não para as outras (até 3 tentativas).
 */
import { generateGuestLlm } from "@/lib/guest-ai/llm/gateway.server";
import type { LlmProvider } from "@/lib/guest-ai/llm/providers/types";
import { GUEST_AI_DEFAULT_MODEL } from "@/lib/guest-ai/orchestrator/contracts";
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

export const GUEST_MEMORY_MAX_CALL_COST_USD = 0.02;
export const GUEST_MEMORY_MAX_OUTPUT_TOKENS = 2_048;
export const GUEST_MEMORY_DEFAULT_LIMIT = 10;
export const GUEST_MEMORY_MAX_MESSAGES = 400;

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

/** Acesso a dados do processo (Supabase em produção; memória nos testes). */
export interface GuestMemoryStore {
  pending(limit: number): Promise<PendingStay[]>;
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
    result: StayMemoryResult;
  }): Promise<"recorded" | "exists" | "invalid">;
  mark(
    reservationId: string,
    tenantId: string,
    status: "done" | "skipped" | "failed",
    reason: string,
  ): Promise<void>;
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
  costUsd: number;
}

/** Processa um lote de estadias. Nunca lança por falha de uma estadia; erros viram códigos fechados. */
export async function runGuestMemoryCycle(
  deps: GuestMemoryCycleDeps,
): Promise<GuestMemoryCycleResult> {
  const env = deps.env ?? process.env;
  const result: GuestMemoryCycleResult = {
    status: "ran",
    processed: 0,
    recorded: 0,
    skipped: 0,
    failed: 0,
    costUsd: 0,
  };
  if (env["GUEST_MEMORY_WORKER"] === "off") return { ...result, status: "off" };
  const log = deps.log ?? ((e) => console.info("[guest-memory]", JSON.stringify(e)));
  const modelId = deps.modelId ?? GUEST_AI_DEFAULT_MODEL;
  const limit = Math.max(1, Math.min(50, Math.floor(deps.limit ?? GUEST_MEMORY_DEFAULT_LIMIT)));
  const pending = await deps.store.pending(limit);

  for (const stay of pending) {
    result.processed += 1;
    const done = async (status: "done" | "skipped" | "failed", reason: string) => {
      if (status === "done") result.recorded += 1;
      else if (status === "skipped") result.skipped += 1;
      else result.failed += 1;
      log({ reservation: stay.reservationId, status, reason });
      await deps.store
        .mark(stay.reservationId, stay.tenantId, status, reason)
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
        const facts = deriveStayFacts(m);
        const prompt = buildStayMemoryPrompt(
          {
            previousNotes: profile.notes,
            previousAssessment: profile.assessment,
            previousStays: profile.stays,
            stay: { checkinDate: m.checkinDate, checkoutDate: m.checkoutDate },
            facts,
            messages: m.messages.slice(-GUEST_MEMORY_MAX_MESSAGES),
          },
          {
            modelId,
            maxOutputTokens: GUEST_MEMORY_MAX_OUTPUT_TOKENS,
            maxCallCostUsd: GUEST_MEMORY_MAX_CALL_COST_USD,
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
        result.costUsd += llm.telemetry.costUsd;
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
        result: memory,
      });
      await done(rec === "invalid" ? "failed" : "done", rec);
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
        if (ota) {
          await admin
            .from("property_reservations")
            .update({ guest_contacts: { ...contacts, ota_guest_id: ota } })
            .eq("id", stay.reservationId);
        }
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
      const titularPhones = new Set(phones.map((p) => p.replace(/\D/g, "").replace(/^00/, "")));
      const companionConv = new Set<string>();
      const channelOf = new Map<string, string>();
      for (const c of (convs ?? []) as Array<{ id: string; guest_session_id: string | null }>) {
        const sid = c.guest_session_id ?? "";
        channelOf.set(
          c.id,
          sid.startsWith("wa:") ? "whatsapp" : sid.startsWith("airbnb:") ? "airbnb" : "guia",
        );
        // WhatsApp de número que não é o telefone oficial do titular ⇒ acompanhante
        if (
          sid.startsWith("wa:") &&
          !titularPhones.has(sid.slice(3).replace(/\D/g, "").replace(/^00/, ""))
        )
          companionConv.add(c.id);
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

    async record({ tenantId, canonicalId, reservationId, checkoutDate, result }) {
      const { data, error } = await admin.rpc("guest_ai_record_stay_summary", {
        p_tenant_id: tenantId,
        p_canonical_id: canonicalId,
        p_reservation_id: reservationId,
        p_checkout: checkoutDate,
        p_summary: result.summary,
        p_behavioral_notes: result.behavioralNotes,
        p_internal_assessment: result.internalAssessment,
      });
      if (error || !data) return "invalid";
      const r = (data as { result?: string }).result;
      return r === "recorded" || r === "exists" ? r : "invalid";
    },

    async mark(reservationId, tenantId, status, reason) {
      await admin.rpc("guest_ai_mark_stay_memory", {
        p_reservation_id: reservationId,
        p_tenant_id: tenantId,
        p_status: status,
        p_reason: reason,
      });
    },
  };
}
