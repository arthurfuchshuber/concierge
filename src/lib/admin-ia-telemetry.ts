/**
 * TELEMETRIA IA (Admin SaaS, /admin/ia) — regras puras de leitura.
 *
 * Fonte: tabelas já existentes `guest_ai_copilot_suggestions` (uma linha por mensagem do hóspede que o
 * Copiloto avaliou; retenção de 14 dias por `expires_at`) e `guest_ai_ops_actions` (ações nos cards).
 * Nada aqui escreve, nada aqui chama modelo. Sem migrations: o que o banco não grava não é inventado
 * (fatos do Dossiê = só a contagem `context_dossier_entries`; D9 = só `allow`/`deny`).
 */

/** Taxa referencial para mostrar o custo aproximado em reais (decisão do titular, 07/11/2026). */
export const BRL_PER_USD = 5.8;
/** Retenção das sugestões (`expires_at = now() + 14 days`). */
export const TELEMETRY_WINDOW_DAYS = 14;
export const TITULAR_MODEL = "openai/gpt-6-astra";
export const RESERVE_MODEL = "google/gemini-3.8-flash";

/** Intervalos do "Ao vivo" (0 = pausado). */
export const LIVE_INTERVALS = [
  { key: "0", label: "Pausar", ms: 0 },
  { key: "5", label: "5s", ms: 5_000 },
  { key: "10", label: "10s", ms: 10_000 },
  { key: "30", label: "30s", ms: 30_000 },
] as const;

export type TelemetrySurface = "airbnb" | "whatsapp" | "guide_chat";

/** Linha resumida da sugestão (só o que a tela usa). */
export interface SuggestionRow {
  id: string;
  propertyId: string;
  conversationId: string;
  triggerMessageId: string;
  surface: TelemetrySurface;
  state: string;
  outcomeKind: string | null;
  outcomeCode: string | null;
  strategy: string | null;
  warnings: string[];
  modelId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number;
  latencyMs: number | null;
  gatewayError: string | null;
  attempts: number;
  startedAt: string;
  edited: boolean;
  hasSuggestion: boolean;
  stayPhase: string | null;
  reservationLinked: boolean | null;
  historyMessages: number | null;
  dossierEntries: number | null;
  credentialPolicy: "allow" | "deny" | null;
  senderIdentity: string | null;
  humanInCommand: boolean | null;
}

export interface OpsRow {
  id: string;
  triggerMessageId: string;
  action: string;
  mode: string;
  outcome: string;
  code: string | null;
  createdAt: string;
  appliedAt: string | null;
  cardBefore: Record<string, unknown> | null;
  cardAfter: Record<string, unknown> | null;
}

export type OutcomeKey =
  | "card"
  | "d9"
  | "error"
  | "silence"
  | "sent"
  | "available"
  | "discarded"
  | "superseded"
  | "generating";

export const OUTCOME_LABEL: Record<OutcomeKey, string> = {
  card: "Aplicou card",
  d9: "Recusou D9",
  error: "Erro",
  silence: "Silêncio",
  sent: "Enviada",
  available: "Disponível",
  discarded: "Descartada",
  superseded: "Substituída",
  generating: "Gerando",
};

/** Desfecho de UMA inferência: a primeira regra que bate vence (erro e card falam mais alto). */
export function classifyOutcome(s: SuggestionRow, ops: readonly OpsRow[]): OutcomeKey {
  if (
    s.state === "generation_failed" ||
    s.state === "send_failed" ||
    s.outcomeKind === "technical_error"
  )
    return "error";
  if (ops.some((o) => o.outcome === "applied")) return "card";
  if (s.warnings.includes("credential_request_denied")) return "d9";
  if (s.state === "no_suggestion" || s.outcomeKind === "silence" || s.strategy === "silence")
    return "silence";
  if (s.state === "sent") return "sent";
  if (s.state === "available" || s.state === "edited" || s.state === "sending") return "available";
  if (s.state === "discarded") return "discarded";
  if (s.state === "superseded") return "superseded";
  return "generating";
}

/** Usou o Reserva (ou tentou mais de uma vez): conta como oscilação. */
export function isOscillation(s: SuggestionRow): boolean {
  return (s.modelId !== null && s.modelId !== TITULAR_MODEL) || s.attempts > 1;
}

export type FeedFilter = "all" | "cards" | "errors" | "approved";
export const FEED_FILTERS: ReadonlyArray<{ key: FeedFilter; label: string }> = [
  { key: "all", label: "Todos" },
  { key: "cards", label: "Ações de cartão" },
  { key: "errors", label: "Erros e oscilações" },
  { key: "approved", label: "Aprovados" },
];

export function matchesFilter(f: FeedFilter, s: SuggestionRow, ops: readonly OpsRow[]): boolean {
  const o = classifyOutcome(s, ops);
  if (f === "cards") return ops.length > 0;
  if (f === "errors") return o === "error" || isOscillation(s);
  if (f === "approved") return o === "sent" || o === "card";
  return true;
}

/** Filtro do feed sobre as linhas já classificadas no servidor (mesma regra de `matchesFilter`). */
export function filterFeedRows<
  T extends { hasOps: boolean; outcome: OutcomeKey; oscillation: boolean },
>(rows: readonly T[], f: FeedFilter): T[] {
  if (f === "cards") return rows.filter((r) => r.hasOps);
  if (f === "errors") return rows.filter((r) => r.outcome === "error" || r.oscillation);
  if (f === "approved") return rows.filter((r) => r.outcome === "sent" || r.outcome === "card");
  return [...rows];
}

export const SURFACE_LABEL: Record<TelemetrySurface, string> = {
  airbnb: "Airbnb",
  whatsapp: "WhatsApp",
  guide_chat: "Guia",
};

/**
 * Rótulo do modelo no feed e no inspetor. Desde a PR #60 (10/11/2026) o Gemini Flash é o TITULAR do Copiloto;
 * o GPT-6 Astra só aparece numa sugestão em contingência (ex.: variável `GUEST_AI_COPILOT_MODEL`), como reserva.
 */
export function modelLabel(id: string | null): string {
  if (!id) return "—";
  if (id === RESERVE_MODEL) return "Flash (titular)";
  if (id === TITULAR_MODEL) return "Astra (reserva)";
  return id;
}

/** O mesmo rótulo sem o papel entre parênteses (cartões e linhas compactas). */
export function modelShortLabel(id: string | null): string {
  return modelLabel(id).replace(/\s*\((titular|reserva)\)$/, "");
}

export interface TelemetryKpis {
  costTodayUsd: number;
  costWindowUsd: number;
  dailyLimitUsd: number;
  dailyUsePct: number;
  avgLatencyMs: number | null;
  maxLatencyMs: number | null;
  activeModel: string | null;
  reserveUsesToday: number;
  /** enviadas sem alteração ÷ enviadas (null sem envios). */
  assertivenessPct: number | null;
  /** enviadas ÷ geradas (null sem geradas). */
  adoptionPct: number | null;
  sentCount: number;
  generatedCount: number;
  cardsApplied: number;
  cardsRefused: number;
  todayBySurface: Record<TelemetrySurface, number>;
  todayTotal: number;
}

/** Início do dia em UTC: o mesmo corte do teto diário (`copilot_claim_generation`). */
export function utcDayStart(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

export function computeKpis(
  rows: readonly SuggestionRow[],
  ops: readonly OpsRow[],
  opts: { nowMs: number; dailyLimitUsd: number },
): TelemetryKpis {
  const dayStart = utcDayStart(opts.nowMs);
  const today = rows.filter((r) => Date.parse(r.startedAt) >= dayStart);
  const costToday = today.reduce((a, r) => a + r.costUsd, 0);
  const costWindow = rows.reduce((a, r) => a + r.costUsd, 0);
  const lat = rows.map((r) => r.latencyMs).filter((v): v is number => typeof v === "number");
  const latest = rows.find((r) => r.modelId) ?? null;
  const sent = rows.filter((r) => r.state === "sent");
  const generated = rows.filter((r) => r.hasSuggestion);
  const bySurface: Record<TelemetrySurface, number> = { airbnb: 0, whatsapp: 0, guide_chat: 0 };
  for (const r of today) bySurface[r.surface] = (bySurface[r.surface] ?? 0) + 1;
  const live = ops.filter((o) => o.mode === "live");
  return {
    costTodayUsd: costToday,
    costWindowUsd: costWindow,
    dailyLimitUsd: opts.dailyLimitUsd,
    dailyUsePct: opts.dailyLimitUsd > 0 ? Math.round((costToday / opts.dailyLimitUsd) * 100) : 0,
    avgLatencyMs: lat.length ? Math.round(lat.reduce((a, v) => a + v, 0) / lat.length) : null,
    maxLatencyMs: lat.length ? Math.max(...lat) : null,
    activeModel: latest?.modelId ?? null,
    reserveUsesToday: today.filter((r) => r.modelId === RESERVE_MODEL).length,
    assertivenessPct: pct(sent.filter((r) => !r.edited).length, sent.length),
    adoptionPct: pct(sent.length, generated.length),
    sentCount: sent.length,
    generatedCount: generated.length,
    cardsApplied: live.filter((o) => o.outcome === "applied").length,
    cardsRefused: live.filter((o) => o.outcome === "refused").length,
    todayBySurface: bySurface,
    todayTotal: today.length,
  };
}

/* ---------- formatação ---------- */

export function formatUsd(v: number, decimals = 2): string {
  return `$ ${v.toFixed(decimals)}`;
}
export function formatBrl(usd: number, decimals = 2): string {
  return `~ R$ ${(usd * BRL_PER_USD).toFixed(decimals).replace(".", ",")}`;
}
/** Custo de uma linha do feed: 4 casas, como no Gateway. */
export function formatRowCost(usd: number): string {
  return formatUsd(usd, 4);
}
export function formatMs(ms: number | null): string {
  if (ms === null) return "—";
  return `${ms.toLocaleString("pt-BR")} ms`;
}
export function formatSeconds(ms: number | null): string {
  if (ms === null) return "—";
  return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
}
export function formatPct(v: number | null): string {
  return v === null ? "—" : `${String(v).replace(".", ",")}%`;
}
export function formatClock(iso: string, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      ...(timeZone ? { timeZone } : {}),
    }).format(new Date(iso));
  } catch {
    return "—";
  }
}

export const STAY_PHASE_LABEL: Record<string, string> = {
  inquiry: "Consulta",
  pre_stay: "Pré-estadia",
  in_stay: "Em estadia",
  post_checkout: "Pós-saída",
  cancelled: "Cancelada",
  no_show: "No-show",
  unknown: "Desconhecida",
};

export const OPS_ACTION_LABEL: Record<string, string> = {
  eta_checkin: "Previsão de chegada",
  eta_checkout: "Previsão de saída",
  checkin_done: "Check-in concluído",
  checkout_done: "Check-out concluído",
  early_departure: "Saída antecipada",
  late_checkout: "Late checkout",
};

const CARD_STATUS_LABEL: Record<string, string> = {
  pending: "Pendente",
  done: "Concluído",
  no_show: "No-show",
};

/**
 * Foto do card (antes: chaves camelCase do executor; depois: colunas do banco) em linhas legíveis.
 * Só campos conhecidos; nenhum valor sensível (o card não guarda credenciais).
 */
export function cardSnapshotRows(
  snap: Record<string, unknown> | null,
): Array<{ label: string; value: string }> | null {
  if (!snap || snap.exists === false) return null;
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = snap[k];
      if (v !== null && v !== undefined && v !== "") return String(v);
    }
    return null;
  };
  const out: Array<{ label: string; value: string }> = [];
  const status = pick("status");
  if (status) out.push({ label: "Etapa", value: CARD_STATUS_LABEL[status] ?? status });
  const done = pick("doneAt", "done_at");
  if (done) out.push({ label: "Baixa", value: formatClock(done) });
  const eta = pick("arrivalTimeOverride", "arrival_time_override");
  if (eta) {
    const src = pick("arrivalTimeSource", "arrival_time_source");
    out.push({
      label: "Previsão",
      value: src ? `${eta.slice(0, 5)} · ${src === "guest_ai" ? "IA" : src}` : eta.slice(0, 5),
    });
  }
  const etaDate = pick("arrivalDateOverride", "arrival_date_override");
  if (etaDate) out.push({ label: "Data prevista", value: etaDate });
  const late = pick("lateCheckoutTime", "late_checkout_time");
  if (late) out.push({ label: "Late checkout", value: late.slice(0, 5) });
  return out.length ? out : [{ label: "Etapa", value: "Sem dados" }];
}

/* ---------- aprendizado contínuo e ferramentas (Etapa 4, 10/11/2026) ---------- */

export type LearningStatusKey = "pending" | "approved" | "rejected" | "revoked";
export type LearningSourceKey = "checkout_done" | "incident_resolved" | "guest_confirmation";

/** Linha mínima de `guest_ai_learning_entries` (sem o texto do fato: a tela só conta). */
export interface LearningRow {
  status: string;
  source: string;
  createdAt: string;
}

export interface LearningKpis {
  /** todas as propostas já registradas (qualquer data) */
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  revoked: number;
  /** propostas criadas na janela da telemetria (14 dias) */
  proposedWindow: number;
  /** aprovadas ÷ decididas (aprovadas + rejeitadas); null sem decisões */
  approvalPct: number | null;
  bySource: Record<LearningSourceKey, number>;
}

/** Contagens do aprendizado. Status/origem desconhecidos entram só no total (nunca quebram a tela). */
export function computeLearningKpis(rows: readonly LearningRow[], opts: { nowMs: number; windowDays?: number }): LearningKpis {
  const since = opts.nowMs - (opts.windowDays ?? TELEMETRY_WINDOW_DAYS) * 86_400_000;
  const k: LearningKpis = {
    total: rows.length,
    pending: 0,
    approved: 0,
    rejected: 0,
    revoked: 0,
    proposedWindow: 0,
    approvalPct: null,
    bySource: { checkout_done: 0, incident_resolved: 0, guest_confirmation: 0 },
  };
  for (const r of rows) {
    if (r.status === "pending" || r.status === "approved" || r.status === "rejected" || r.status === "revoked") k[r.status] += 1;
    if (r.source in k.bySource) k.bySource[r.source as LearningSourceKey] += 1;
    const t = Date.parse(r.createdAt);
    if (Number.isFinite(t) && t >= since) k.proposedWindow += 1;
  }
  k.approvalPct = pct(k.approved, k.approved + k.rejected);
  return k;
}

/**
 * Ferramentas externas (clima, voos, Places/Routes): o banco NÃO registra as execuções hoje (só existem na
 * memória do turno). Sem migration, a tela mostra "sem registro" em vez de inventar números. A proposta de
 * persistência (SQL) está no relatório da Etapa 4.
 */
export interface ToolKpis {
  available: false;
  reason: "not_persisted";
}
export const TOOL_KPIS_UNAVAILABLE: ToolKpis = Object.freeze({ available: false, reason: "not_persisted" });

export const LEARNING_STATUS_LABEL: Record<LearningStatusKey, string> = {
  pending: "Pendentes",
  approved: "Aprovadas",
  rejected: "Rejeitadas",
  revoked: "Revogadas",
};
export const LEARNING_SOURCE_LABEL: Record<LearningSourceKey, string> = {
  checkout_done: "Checkout",
  incident_resolved: "Atendimento resolvido",
  guest_confirmation: "Confirmação do hóspede",
};

/**
 * Nota do cartão "Modelo" (10/11/2026): o Copiloto roda no Gemini Flash como TITULAR; contar "reserva usada"
 * para ele enganava. Só quando o titular é outro (ex.: Astra pela variável) o Flash é contado como reserva.
 */
export function modelNote(k: Pick<TelemetryKpis, "activeModel" | "reserveUsesToday">): string {
  if (k.activeModel === RESERVE_MODEL) return "titular do Copiloto";
  return k.reserveUsesToday ? `reserva usada ${k.reserveUsesToday}× hoje` : "sem reserva hoje";
}
