/**
 * F2-B · B3.2 — PAUSA HUMANA DERIVADA DO HISTÓRICO (pura). B3.0 Rev. 2 §3 e §4.
 *
 * Fonte de verdade: o histórico de intervenções humanas, de duas origens combinadas —
 *  1. mensagens gravadas (`property_chat_messages`): remetente ≠ hóspede, não nota interna,
 *     não mensagem da própria IA;
 *  2. webhooks brutos do Airbnb (`channex_raw_records`, `webhook:message`, `sender='property'`,
 *     mesma thread) — cobrem o intervalo recebimento → gravação e mensagens do anfitrião que nunca
 *     viraram mensagem gravada (7 casos reais na reconciliação de 03/11).
 * A coluna `ai_paused`/`paused_until` é REFORÇO: vale a condição mais restritiva.
 *
 * Instante de cada intervenção: `max(t_channel, t_received, t_persisted)` (o mais tardio conhecido),
 * para que um webhook atrasado não "coma" parte da pausa. `pausedUntil = max(instantes) + 10 min`.
 * Nova intervenção reinicia a janela integralmente (o máximo só cresce).
 *
 * Classificação (sem heurística de conteúdo — o módulo nem recebe texto):
 *  - hóspede (`guest` + `user`) e IA (`ai` + `assistant`, ou eco bruto ligado a uma mensagem da IA
 *    pelo id externo) não pausam;
 *  - nota interna (`is_internal_note = true`) não é mensagem ao hóspede: não pausa;
 *  - `human` ⇒ intervenção verificada; `system` (mensagem do anfitrião sem usuário — app do Airbnb ou
 *    mensagem programada) ⇒ intervenção não comprovada, CONTA como humana;
 *  - qualquer outra combinação, remetente bruto desconhecido ⇒ intervenção preventiva;
 *  - automação só é excluída com flag EXPLÍCITA e confiável (`automation === true`). Hoje nenhuma
 *    fonte real tem essa flag (payload do Airbnb inspecionado); o campo existe só no contrato.
 *
 * Fail-closed: leitura falha, histórico incompleto (acima do teto), instante inválido, fonte bruta de
 * outro imóvel ou divergência entre fontes (bruto diz anfitrião, gravado diz hóspede) ⇒ `unknown`,
 * que todo chamador trata como bloqueio.
 */
import { parseInstant } from "./wall-clock";

export const HUMAN_PAUSE_VERSION = "human-pause.2026-11-03.1";
/** Janela homologada (decisões 1 e 7 da B3.0 Rev. 1). Não é configurável. */
export const HUMAN_PAUSE_WINDOW_MS = 10 * 60_000;

export type InterventionClass = "human_verified" | "human_channel" | "system_unproven" | "unknown_non_guest";

export interface PausePersistedRow {
  id: string;
  role: string | null;
  sender_type: string | null;
  is_internal_note: boolean | null;
  created_at: string | null;
  external_id: string | null;
}

export interface PauseRawRow {
  record_id: string;
  first_seen_at: string | null;
  sender: string | null;
  inserted_at: string | null;
  message_id: string | null;
  ota_message_id: string | null;
  channex_property_id: string | null;
  /** Flag explícita de automação (nenhuma fonte real a fornece hoje). */
  automation?: boolean | null;
}

export interface HumanPauseInput {
  lookup: "ok" | "failed";
  now: string;
  column: { ai_paused: unknown; paused_until: unknown } | null;
  persisted: readonly PausePersistedRow[];
  /** `false` quando a leitura bateu no teto (lista possivelmente cortada) ⇒ `unknown`. */
  persistedComplete: boolean;
  raw: readonly PauseRawRow[];
  rawComplete: boolean;
  /** Propriedades Channex do imóvel do turno; bruto de outra ⇒ conflito. `null` = não se aplica. */
  allowedSourcePropertyIds: readonly string[] | null;
}

/** O que o loader real entrega (o instante vem da cadeia, nunca da fonte). */
export type HumanPauseSource = Omit<HumanPauseInput, "now">;

export type PauseUnknownReason = "lookup_failed" | "history_incomplete" | "invalid_timestamp" | "source_conflict" | "column_unreadable";

export interface HumanPauseState {
  version: string;
  state: "active" | "paused" | "unknown";
  /** Fim da pausa por histórico/coluna; `null` sem pausa ou com pausa por tempo indeterminado. */
  pausedUntil: string | null;
  /** Coluna `ai_paused = true` sem prazo futuro: pausa até a equipe devolver (B2.4 inalterado). */
  indefinite: boolean;
  reason: "none" | "recent_human_intervention" | "column_pause" | PauseUnknownReason;
  latestInterventionAt: string | null;
  interventions: Record<InterventionClass, number>;
  echoesIgnored: number;
  internalNotesIgnored: number;
  automatedIgnored: number;
}

const emptyCounts = (): Record<InterventionClass, number> => ({ human_verified: 0, human_channel: 0, system_unproven: 0, unknown_non_guest: 0 });

function unknown(reason: PauseUnknownReason): HumanPauseState {
  return { version: HUMAN_PAUSE_VERSION, state: "unknown", pausedUntil: null, indefinite: false, reason, latestInterventionAt: null, interventions: emptyCounts(), echoesIgnored: 0, internalNotesIgnored: 0, automatedIgnored: 0 };
}

type PersistedClass = "guest" | "ai" | "internal_note" | InterventionClass;
function classifyPersisted(r: PausePersistedRow): PersistedClass {
  if (r.is_internal_note === true) return "internal_note";
  if (r.is_internal_note !== false) return "unknown_non_guest";
  if (r.sender_type === "guest" && r.role === "user") return "guest";
  if (r.sender_type === "ai" && r.role === "assistant") return "ai";
  if (r.sender_type === "human" && r.role === "assistant") return "human_verified";
  if (r.sender_type === "system" && r.role === "assistant") return "system_unproven";
  return "unknown_non_guest";
}

const maxMs = (xs: Array<number | null>): number | null => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? Math.max(...v) : null;
};

/** Instante opcional: ausente = desconhecido; presente e ilegível = inválido (fail-closed). */
function optInstant(v: unknown): { ok: true; ms: number | null } | { ok: false } {
  if (v === null || v === undefined || v === "") return { ok: true, ms: null };
  const d = parseInstant(v);
  return d ? { ok: true, ms: d.getTime() } : { ok: false };
}

export function deriveHumanPause(i: HumanPauseInput): HumanPauseState {
  if (!i || i.lookup !== "ok") return unknown("lookup_failed");
  const now = parseInstant(i.now);
  if (!now) return unknown("invalid_timestamp");
  if (!i.persistedComplete || !i.rawComplete || !Array.isArray(i.persisted) || !Array.isArray(i.raw)) return unknown("history_incomplete");

  // Coluna (reforço): leitura ilegível ⇒ unknown.
  let columnUntil: number | null = null;
  let indefinite = false;
  if (i.column) {
    const ap = i.column.ai_paused;
    if (ap !== null && ap !== undefined && typeof ap !== "boolean") return unknown("column_unreadable");
    const pu = optInstant(i.column.paused_until);
    if (!pu.ok) return unknown("column_unreadable");
    if (pu.ms !== null && pu.ms > now.getTime()) columnUntil = pu.ms;
    else if (ap === true) indefinite = true;
  }

  // Índice dos brutos pelos ids do Airbnb (id e ota_message_id).
  const allowed = i.allowedSourcePropertyIds ? new Set(i.allowedSourcePropertyIds) : null;
  const rawById = new Map<string, PauseRawRow[]>();
  for (const r of i.raw) {
    if (!r || typeof r.record_id !== "string") return unknown("history_incomplete");
    if (allowed && (!r.channex_property_id || !allowed.has(r.channex_property_id))) return unknown("source_conflict");
    for (const k of [r.message_id, r.ota_message_id]) if (k) rawById.set(k, [...(rawById.get(k) ?? []), r]);
  }

  const counts = emptyCounts();
  let echoes = 0;
  let notes = 0;
  let automated = 0;
  const instants: number[] = [];
  const consumedRaw = new Set<string>();

  for (const m of i.persisted) {
    if (!m || typeof m.id !== "string") return unknown("history_incomplete");
    const persisted = optInstant(m.created_at);
    if (!persisted.ok || persisted.ms === null) return unknown("invalid_timestamp");
    const cls = classifyPersisted(m);
    const matched = m.external_id ? rawById.get(m.external_id) ?? [] : [];
    for (const r of matched) consumedRaw.add(r.record_id);
    // Divergência entre fontes: o mesmo id é hóspede numa e anfitrião na outra.
    if (cls === "guest" ? matched.some((r) => r.sender !== "guest") : matched.some((r) => r.sender === "guest")) return unknown("source_conflict");
    if (cls === "guest") continue;
    if (cls === "ai") { echoes += matched.length; continue; }
    if (cls === "internal_note") { notes++; continue; }
    if (matched.some((r) => r.automation === true) && matched.every((r) => r.automation === true)) { automated++; continue; }
    const times: Array<number | null> = [persisted.ms];
    for (const r of matched) {
      const ch = optInstant(r.inserted_at);
      const rc = optInstant(r.first_seen_at);
      if (!ch.ok || !rc.ok) return unknown("invalid_timestamp");
      times.push(ch.ms, rc.ms);
    }
    counts[cls]++;
    instants.push(maxMs(times)!);
  }

  for (const r of i.raw) {
    if (consumedRaw.has(r.record_id)) continue;
    const rc = optInstant(r.first_seen_at);
    const ch = optInstant(r.inserted_at);
    if (!rc.ok || !ch.ok || rc.ms === null) return unknown("invalid_timestamp");
    if (r.sender === "guest") continue;
    if (r.automation === true) { automated++; continue; }
    const cls: InterventionClass = r.sender === "property" ? "human_channel" : "unknown_non_guest";
    counts[cls]++;
    instants.push(maxMs([rc.ms, ch.ms])!);
  }

  const latest = instants.length ? Math.max(...instants) : null;
  const historyUntil = latest === null ? null : latest + HUMAN_PAUSE_WINDOW_MS;
  const until = maxMs([historyUntil, columnUntil]);
  const base = { version: HUMAN_PAUSE_VERSION, interventions: counts, echoesIgnored: echoes, internalNotesIgnored: notes, automatedIgnored: automated, latestInterventionAt: latest === null ? null : new Date(latest).toISOString() };
  if (indefinite) return { ...base, state: "paused", pausedUntil: until === null ? null : new Date(until).toISOString(), indefinite: true, reason: "column_pause" };
  if (until !== null && now.getTime() <= until) {
    return { ...base, state: "paused", pausedUntil: new Date(until).toISOString(), indefinite: false, reason: historyUntil !== null && historyUntil >= (columnUntil ?? -Infinity) ? "recent_human_intervention" : "column_pause" };
  }
  return { ...base, state: "active", pausedUntil: until === null ? null : new Date(until).toISOString(), indefinite: false, reason: "none" };
}

export type ActionabilityResult = "actionable" | "paused_backlog" | "blocked_unknown" | "blocked_indefinite";

/**
 * Decisão 7: só mensagem do hóspede ESTRITAMENTE posterior ao fim da pausa, nos dois instantes
 * (canal e gravação), é acionável. Igualdade ao limite não é acionável. Instante de canal
 * desconhecido com pausa conhecida ⇒ não acionável (não dá para provar que veio depois).
 */
export function guestMessageActionability(msg: { tChannel: string | null; tPersisted: string | null }, pause: HumanPauseState): ActionabilityResult {
  if (!pause || pause.state === "unknown") return "blocked_unknown";
  if (pause.indefinite) return "blocked_indefinite";
  const persisted = parseInstant(msg?.tPersisted);
  if (!persisted) return "blocked_unknown";
  const channelRaw = msg.tChannel;
  const channel = channelRaw === null ? null : parseInstant(channelRaw);
  if (channelRaw !== null && !channel) return "blocked_unknown";
  if (pause.pausedUntil === null) return pause.state === "active" ? "actionable" : "blocked_unknown";
  const until = Date.parse(pause.pausedUntil);
  if (!channel) return "paused_backlog";
  return channel.getTime() > until && persisted.getTime() > until ? "actionable" : "paused_backlog";
}

/**
 * B2 (preempção): a pausa relida depois da cadeia mostra intervenção nova (ou ficou ilegível) ⇒ o
 * resultado obtido antes é obsoleto e não pode ser usado.
 */
export function detectPausePreemption(before: HumanPauseState, after: HumanPauseState): "unchanged" | "preempted" {
  if (!before || !after || after.state === "unknown" || before.state === "unknown") return "preempted";
  if (after.state !== "active" && before.state === "active") return "preempted";
  const b = before.latestInterventionAt ? Date.parse(before.latestInterventionAt) : -Infinity;
  const a = after.latestInterventionAt ? Date.parse(after.latestInterventionAt) : -Infinity;
  return a > b ? "preempted" : "unchanged";
}
