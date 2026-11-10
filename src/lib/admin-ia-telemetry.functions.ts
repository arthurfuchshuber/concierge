import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  TELEMETRY_WINDOW_DAYS,
  cardSnapshotRows,
  classifyOutcome,
  computeKpis,
  computeLearningKpis,
  isOscillation,
  TOOL_KPIS_UNAVAILABLE,
  type LearningKpis,
  type ToolKpis,
  type OpsRow,
  type OutcomeKey,
  type SuggestionRow,
  type TelemetryKpis,
  type TelemetrySurface,
} from "@/lib/admin-ia-telemetry";

/**
 * Telemetria IA (Admin SaaS, /admin/ia) — SOMENTE LEITURA.
 *
 * Só administradores do SaaS (`has_role(admin)`); a leitura cruza contas, então usa o cliente
 * administrativo depois da verificação. Nenhuma escrita, nenhuma migration: lê
 * `guest_ai_copilot_suggestions` (janela de 14 dias = retenção), `guest_ai_ops_actions` e, desde 10/11/2026,
 * só status/origem/data de `guest_ai_learning_entries` (nunca o texto do fato).
 */

/** Teto de linhas lidas para os indicadores (a janela inteira) e para o feed (as mais recentes). */
const KPI_ROW_CAP = 5000;
const FEED_ROW_CAP = 200;
const PREVIEW_CHARS = 120;

const SUMMARY_COLUMNS =
  "id, property_id, conversation_id, trigger_message_id, surface, state, outcome_kind, outcome_code, strategy, warnings, model_id, gateway_input_tokens, gateway_output_tokens, gateway_cost_usd, gateway_latency_ms, gateway_error, generation_attempts, generation_started_at, edited_text, suggested_text, context_stay_phase, context_reservation_linked, context_history_messages, context_dossier_entries, context_credential_policy, context_sender_identity, context_human_in_command";

const OPS_COLUMNS =
  "id, trigger_message_id, action, mode, outcome, code, created_at, applied_at, card_before, card_after";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

async function assertSaasAdmin(supabase: Db, userId: string): Promise<void> {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) throw new Error("Erro ao verificar permissão");
  if (!data) throw new Error("Acesso restrito aos administradores do SaaS.");
}

function toSuggestion(r: Record<string, unknown>): SuggestionRow {
  const num = (v: unknown) =>
    typeof v === "number" ? v : v === null || v === undefined ? null : Number(v);
  const policy = r.context_credential_policy;
  return {
    id: String(r.id),
    propertyId: String(r.property_id),
    conversationId: String(r.conversation_id),
    triggerMessageId: String(r.trigger_message_id),
    surface: (r.surface as TelemetrySurface) ?? "guide_chat",
    state: String(r.state ?? ""),
    outcomeKind: (r.outcome_kind as string | null) ?? null,
    outcomeCode: (r.outcome_code as string | null) ?? null,
    strategy: (r.strategy as string | null) ?? null,
    warnings: Array.isArray(r.warnings) ? (r.warnings as string[]) : [],
    modelId: (r.model_id as string | null) ?? null,
    inputTokens: num(r.gateway_input_tokens),
    outputTokens: num(r.gateway_output_tokens),
    costUsd: Number(r.gateway_cost_usd ?? 0) || 0,
    latencyMs: num(r.gateway_latency_ms),
    gatewayError: (r.gateway_error as string | null) ?? null,
    attempts: Number(r.generation_attempts ?? 1) || 1,
    startedAt: String(r.generation_started_at),
    edited: typeof r.edited_text === "string" && r.edited_text !== r.suggested_text,
    hasSuggestion: typeof r.suggested_text === "string" && r.suggested_text.length > 0,
    stayPhase: (r.context_stay_phase as string | null) ?? null,
    reservationLinked: (r.context_reservation_linked as boolean | null) ?? null,
    historyMessages: num(r.context_history_messages),
    dossierEntries: num(r.context_dossier_entries),
    credentialPolicy: policy === "allow" || policy === "deny" ? policy : null,
    senderIdentity: (r.context_sender_identity as string | null) ?? null,
    humanInCommand: (r.context_human_in_command as boolean | null) ?? null,
  };
}

function toOps(r: Record<string, unknown>): OpsRow {
  const obj = (v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  return {
    id: String(r.id),
    triggerMessageId: String(r.trigger_message_id),
    action: String(r.action ?? ""),
    mode: String(r.mode ?? ""),
    outcome: String(r.outcome ?? ""),
    code: (r.code as string | null) ?? null,
    createdAt: String(r.created_at),
    appliedAt: (r.applied_at as string | null) ?? null,
    cardBefore: obj(r.card_before),
    cardAfter: obj(r.card_after),
  };
}

export interface TelemetryFeedRow {
  id: string;
  startedAt: string;
  propertyName: string;
  ownerName: string | null;
  ownerPhone: string | null;
  ownerPhoneCountry: string | null;
  surface: TelemetrySurface;
  triggerPreview: string;
  outcome: OutcomeKey;
  outcomeCode: string | null;
  modelId: string | null;
  latencyMs: number | null;
  costUsd: number;
  hasOps: boolean;
  oscillation: boolean;
}

export interface TelemetryOverview {
  generatedAt: string;
  windowDays: number;
  kpis: TelemetryKpis;
  rows: TelemetryFeedRow[];
  truncated: boolean;
  /** Aprendizado contínuo; `null` se a leitura falhar (a página continua). */
  learning: LearningKpis | null;
  /** Ferramentas externas: sem registro persistido hoje. */
  tools: ToolKpis;
  /** Mensagens da IA apagadas pela equipe na janela (auditoria; `null` se a leitura falhar). */
  aiMessagesDeleted: number | null;
}

interface PropertyInfo {
  name: string;
  ownerName: string | null;
  ownerPhone: string | null;
  ownerPhoneCountry: string | null;
}

async function loadProperties(admin: Db, ids: string[]): Promise<Map<string, PropertyInfo>> {
  const out = new Map<string, PropertyInfo>();
  if (!ids.length) return out;
  const { data: props } = await admin
    .from("properties")
    .select("id, name, owner_contact_id")
    .in("id", ids);
  const ownerIds = [
    ...new Set(
      ((props ?? []) as Array<{ owner_contact_id: string | null }>)
        .map((p) => p.owner_contact_id)
        .filter(Boolean),
    ),
  ] as string[];
  const owners = new Map<
    string,
    { name: string; trade_name: string | null; phone: string | null; phone_country: string | null }
  >();
  if (ownerIds.length) {
    const { data } = await admin
      .from("property_owners")
      .select("id, name, trade_name, phone, phone_country")
      .in("id", ownerIds);
    for (const o of (data ?? []) as Array<{
      id: string;
      name: string;
      trade_name: string | null;
      phone: string | null;
      phone_country: string | null;
    }>)
      owners.set(o.id, o);
  }
  for (const p of (props ?? []) as Array<{
    id: string;
    name: string | null;
    owner_contact_id: string | null;
  }>) {
    const o = p.owner_contact_id ? owners.get(p.owner_contact_id) : undefined;
    out.set(p.id, {
      name: (p.name ?? "").trim() || "Imóvel",
      ownerName: (o?.trade_name || o?.name || "").trim() || null,
      ownerPhone: o?.phone ?? null,
      ownerPhoneCountry: o?.phone_country ?? null,
    });
  }
  return out;
}

export const getAiTelemetry = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TelemetryOverview> => {
    await assertSaasAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as Db;
    const nowMs = Date.now();
    const since = new Date(nowMs - TELEMETRY_WINDOW_DAYS * 86_400_000).toISOString();

    const { data: sRaw, error: sErr } = await admin
      .from("guest_ai_copilot_suggestions")
      .select(SUMMARY_COLUMNS)
      .gte("generation_started_at", since)
      .order("generation_started_at", { ascending: false })
      .limit(KPI_ROW_CAP);
    if (sErr) throw new Error("Não foi possível ler a telemetria da IA.");
    const all = ((sRaw ?? []) as Array<Record<string, unknown>>).map(toSuggestion);

    const { data: oRaw, error: oErr } = await admin
      .from("guest_ai_ops_actions")
      .select(OPS_COLUMNS)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(KPI_ROW_CAP);
    if (oErr) throw new Error("Não foi possível ler as ações nos cards.");
    const ops = ((oRaw ?? []) as Array<Record<string, unknown>>).map(toOps);
    const opsByTrigger = new Map<string, OpsRow[]>();
    for (const o of ops)
      opsByTrigger.set(o.triggerMessageId, [...(opsByTrigger.get(o.triggerMessageId) ?? []), o]);

    // aprendizado contínuo: só status/origem/data (nunca o texto do fato); falha só esvazia o bloco
    let learning: LearningKpis | null = null;
    try {
      const { data: lRaw, error: lErr } = await admin
        .from("guest_ai_learning_entries")
        .select("status, source, created_at")
        .order("created_at", { ascending: false })
        .limit(KPI_ROW_CAP);
      if (!lErr)
        learning = computeLearningKpis(
          ((lRaw ?? []) as Array<Record<string, unknown>>).map((r) => ({
            status: String(r["status"] ?? ""),
            source: String(r["source"] ?? ""),
            createdAt: String(r["created_at"] ?? ""),
          })),
          { nowMs },
        );
    } catch {
      learning = null;
    }

    // auditoria: mensagens da IA apagadas pela equipe (só a contagem; nenhuma regra nasce disso)
    let aiMessagesDeleted: number | null = null;
    try {
      const { count, error: dErr } = await admin
        .from("ai_system_events")
        .select("id", { count: "exact", head: true })
        .eq("event_type", "ai_message_deleted_by_team")
        .gte("created_at", since);
      if (!dErr) aiMessagesDeleted = count ?? 0;
    } catch {
      aiMessagesDeleted = null;
    }

    const { copilotDailyLimitUsd } = await import("@/lib/guest-ai/copilot/contracts");
    const kpis = computeKpis(all, ops, { nowMs, dailyLimitUsd: copilotDailyLimitUsd() });

    const feed = all.slice(0, FEED_ROW_CAP);
    const props = await loadProperties(admin, [...new Set(feed.map((r) => r.propertyId))]);
    const msgIds = feed.map((r) => r.triggerMessageId);
    const previews = new Map<string, string>();
    if (msgIds.length) {
      const { data } = await admin
        .from("property_chat_messages")
        .select("id, content")
        .in("id", msgIds);
      for (const m of (data ?? []) as Array<{ id: string; content: string | null }>) {
        const t = (m.content ?? "").replace(/\s+/g, " ").trim();
        previews.set(m.id, t.length > PREVIEW_CHARS ? `${t.slice(0, PREVIEW_CHARS - 1)}…` : t);
      }
    }

    const rows: TelemetryFeedRow[] = feed.map((s) => {
      const p = props.get(s.propertyId);
      const o = opsByTrigger.get(s.triggerMessageId) ?? [];
      return {
        id: s.id,
        startedAt: s.startedAt,
        propertyName: p?.name ?? "Imóvel",
        ownerName: p?.ownerName ?? null,
        ownerPhone: p?.ownerPhone ?? null,
        ownerPhoneCountry: p?.ownerPhoneCountry ?? null,
        surface: s.surface,
        triggerPreview: previews.get(s.triggerMessageId) || "—",
        outcome: classifyOutcome(s, o),
        outcomeCode: s.outcomeCode ?? s.gatewayError,
        modelId: s.modelId,
        latencyMs: s.latencyMs,
        costUsd: s.costUsd,
        hasOps: o.length > 0,
        oscillation: isOscillation(s),
      };
    });

    return {
      generatedAt: new Date(nowMs).toISOString(),
      windowDays: TELEMETRY_WINDOW_DAYS,
      kpis,
      rows,
      truncated: all.length >= KPI_ROW_CAP,
      learning,
      tools: TOOL_KPIS_UNAVAILABLE,
      aiMessagesDeleted,
    };
  });

export interface TelemetryDetail {
  row: SuggestionRow;
  outcome: OutcomeKey;
  propertyName: string;
  ownerName: string | null;
  ownerPhone: string | null;
  ownerPhoneCountry: string | null;
  guestName: string | null;
  guestText: string | null;
  suggestedText: string | null;
  editedText: string | null;
  ops: TelemetryOpsView[];
}

/** Ação no card já traduzida para linhas legíveis (antes × depois), serializável. */
export interface TelemetryOpsView {
  id: string;
  action: string;
  mode: string;
  outcome: string;
  code: string | null;
  createdAt: string;
  appliedAt: string | null;
  before: Array<{ label: string; value: string }> | null;
  after: Array<{ label: string; value: string }> | null;
}

export const getAiTelemetryDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<TelemetryDetail> => {
    await assertSaasAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as Db;
    const { data: raw, error } = await admin
      .from("guest_ai_copilot_suggestions")
      .select(SUMMARY_COLUMNS)
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error("Não foi possível ler esta inferência.");
    if (!raw) throw new Error("Inferência não encontrada (pode ter expirado após 14 dias).");
    const r = raw as Record<string, unknown>;
    const row = toSuggestion(r);
    const [{ data: oRaw }, { data: msg }, { data: conv }, props] = await Promise.all([
      admin
        .from("guest_ai_ops_actions")
        .select(OPS_COLUMNS)
        .eq("trigger_message_id", row.triggerMessageId),
      admin
        .from("property_chat_messages")
        .select("content")
        .eq("id", row.triggerMessageId)
        .maybeSingle(),
      admin
        .from("property_chat_conversations")
        .select("guest_name")
        .eq("id", row.conversationId)
        .maybeSingle(),
      loadProperties(admin, [row.propertyId]),
    ]);
    const ops = ((oRaw ?? []) as Array<Record<string, unknown>>).map(toOps);
    const p = props.get(row.propertyId);
    return {
      row,
      outcome: classifyOutcome(row, ops),
      propertyName: p?.name ?? "Imóvel",
      ownerName: p?.ownerName ?? null,
      ownerPhone: p?.ownerPhone ?? null,
      ownerPhoneCountry: p?.ownerPhoneCountry ?? null,
      guestName: ((conv as { guest_name?: string | null } | null)?.guest_name ?? null) || null,
      guestText: ((msg as { content?: string | null } | null)?.content ?? null) || null,
      suggestedText: (r.suggested_text as string | null) ?? null,
      editedText: (r.edited_text as string | null) ?? null,
      ops: ops.map((o) => ({
        id: o.id,
        action: o.action,
        mode: o.mode,
        outcome: o.outcome,
        code: o.code,
        createdAt: o.createdAt,
        appliedAt: o.appliedAt,
        before: cardSnapshotRows(o.cardBefore),
        after: cardSnapshotRows(o.cardAfter),
      })),
    };
  });

// -------- Divergências com o Dossiê (10/11/2026) --------

export interface DivergenceRow {
  entryId: string;
  propertyName: string;
  ownerName: string | null;
  ownerPhone: string | null;
  ownerPhoneCountry: string | null;
  dossierLabel: string;
  dossierExcerpt: string;
  livingStatement: string;
  decidedAt: string | null;
  decidedByName: string | null;
}

/**
 * Aprendizados ATIVOS do Documento Vivo (já com "a mais recente prevalece") que falam do mesmo objeto que um
 * trecho do dossiê do imóvel. Somente leitura, só admin do SaaS. Trechos saneados; campos de credencial fora.
 */
export const getAiDivergences = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DivergenceRow[]> => {
    await assertSaasAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as Db;
    const { latestPerTheme } = await import("@/lib/guest-ai/learning/learning");
    const { findDossierDivergences, CREDENTIAL_FIELD } = await import("@/lib/guest-ai-learning/divergence");

    const { data: eRaw, error } = await admin
      .from("guest_ai_learning_entries")
      .select("id, property_id, category, statement, decided_at, decided_by")
      .eq("status", "approved")
      .order("decided_at", { ascending: false })
      .limit(500);
    if (error) throw new Error("Não foi possível ler o Documento Vivo.");
    const all = ((eRaw ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: String(r["id"]),
      propertyId: String(r["property_id"]),
      category: String(r["category"]),
      statement: String(r["statement"]),
      decidedAt: (r["decided_at"] as string | null) ?? null,
      decidedBy: (r["decided_by"] as string | null) ?? null,
    }));
    // "a mais recente prevalece" vale POR IMÓVEL: só a entrada efetiva de cada tema entra na comparação
    const byProperty = new Map<string, typeof all>();
    for (const e of all) byProperty.set(e.propertyId, [...(byProperty.get(e.propertyId) ?? []), e]);
    const entries = [...byProperty.values()].flatMap((list) => latestPerTheme(list));
    const pids = [...new Set(entries.map((e) => e.propertyId))];
    if (pids.length === 0) return [];

    const [pb, man, faq, props] = await Promise.all([
      admin.from("property_playbook_entries").select("property_id, field_key, value, note, custom_label").in("property_id", pids),
      admin.from("property_manual_items").select("property_id, title, description, body").in("property_id", pids),
      admin.from("property_faqs").select("property_id, question, answer").in("property_id", pids),
      loadProperties(admin, pids),
    ]);
    const passages: Array<{ propertyId: string; label: string; text: string }> = [];
    for (const r of (pb.data ?? []) as Array<Record<string, unknown>>) {
      const key = String(r["field_key"] ?? "");
      if (CREDENTIAL_FIELD.test(key) || CREDENTIAL_FIELD.test(String(r["custom_label"] ?? ""))) continue;
      const text = [r["value"], r["note"]].filter((x) => typeof x === "string" && x.trim()).join(" · ");
      if (text) passages.push({ propertyId: String(r["property_id"]), label: `Playbook · ${String(r["custom_label"] || key)}`, text });
    }
    for (const r of (man.data ?? []) as Array<Record<string, unknown>>) {
      const text = [r["title"], r["description"], r["body"]].filter((x) => typeof x === "string" && x.trim()).join(" · ");
      if (text) passages.push({ propertyId: String(r["property_id"]), label: `Manual · ${String(r["title"] ?? "")}`, text });
    }
    for (const r of (faq.data ?? []) as Array<Record<string, unknown>>) {
      const text = [r["question"], r["answer"]].filter((x) => typeof x === "string" && x.trim()).join(" · ");
      if (text) passages.push({ propertyId: String(r["property_id"]), label: "Perguntas frequentes", text });
    }
    const found = findDossierDivergences(entries, passages);
    const authors = [...new Set(found.map((d) => d.decidedBy).filter((x): x is string => !!x))];
    const who = new Map<string, string>();
    if (authors.length) {
      const { data } = await admin.from("profiles").select("id, full_name").in("id", authors);
      for (const p of (data ?? []) as Array<{ id: string; full_name: string | null }>) if (p.full_name) who.set(p.id, p.full_name);
    }
    return found.map((d) => ({
      entryId: d.entryId,
      propertyName: props.get(d.propertyId)?.name ?? "Imóvel",
      ownerName: props.get(d.propertyId)?.ownerName ?? null,
      ownerPhone: props.get(d.propertyId)?.ownerPhone ?? null,
      ownerPhoneCountry: props.get(d.propertyId)?.ownerPhoneCountry ?? null,
      dossierLabel: d.dossierLabel,
      dossierExcerpt: d.dossierExcerpt,
      livingStatement: d.livingStatement,
      decidedAt: d.decidedAt,
      decidedByName: d.decidedBy ? (who.get(d.decidedBy) ?? null) : null,
    }));
  });

// -------- Aprendidos recentemente (10/11/2026) --------

export interface RecentLearningRow {
  entryId: string;
  statement: string;
  propertyName: string;
  ownerName: string | null;
  ownerPhone: string | null;
  ownerPhoneCountry: string | null;
  decidedAt: string | null;
  decidedByName: string | null;
  scope: "property" | "city" | "account";
  replicas: number;
}

/** Aprendizados aprovados na janela (só os de origem; réplicas entram como contagem). Só admin, só leitura. */
export const getRecentLearnings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RecentLearningRow[]> => {
    await assertSaasAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as Db;
    const since = new Date(Date.now() - TELEMETRY_WINDOW_DAYS * 86_400_000).toISOString();
    const { data: raw, error } = await admin
      .from("guest_ai_learning_entries")
      .select("id, property_id, statement, decided_at, decided_by, evidence_refs")
      .eq("status", "approved")
      .gte("decided_at", since)
      .order("decided_at", { ascending: false })
      .limit(200);
    if (error) throw new Error("Não foi possível ler os aprendizados.");
    const { isReplica, scopesFor } = await import("@/lib/guest-ai-learning/views.server");
    const rows = ((raw ?? []) as Array<Record<string, unknown>>).filter((r) => !isReplica(r["evidence_refs"])).slice(0, 50);
    if (rows.length === 0) return [];
    const scopes = await scopesFor(admin, rows.map((r) => ({ id: String(r["id"]), propertyId: String(r["property_id"]) })));
    const pids = [...new Set(rows.map((r) => String(r["property_id"])))];
    const props = await loadProperties(admin, pids);
    const authors = [...new Set(rows.map((r) => r["decided_by"]).filter((x): x is string => typeof x === "string"))];
    const who = new Map<string, string>();
    if (authors.length) {
      const { data } = await admin.from("profiles").select("id, full_name").in("id", authors);
      for (const p of (data ?? []) as Array<{ id: string; full_name: string | null }>) if (p.full_name) who.set(p.id, p.full_name);
    }
    return rows.map((r) => {
      const sc = scopes.get(String(r["id"])) ?? { scope: "property" as const, replicas: 0 };
      return {
        entryId: String(r["id"]),
        statement: String(r["statement"]),
        propertyName: props.get(String(r["property_id"]))?.name ?? "Imóvel",
        ownerName: props.get(String(r["property_id"]))?.ownerName ?? null,
        ownerPhone: props.get(String(r["property_id"]))?.ownerPhone ?? null,
        ownerPhoneCountry: props.get(String(r["property_id"]))?.ownerPhoneCountry ?? null,
        decidedAt: (r["decided_at"] as string | null) ?? null,
        decidedByName: typeof r["decided_by"] === "string" ? (who.get(r["decided_by"]) ?? null) : null,
        scope: sc.scope,
        replicas: sc.replicas,
      };
    });
  });
