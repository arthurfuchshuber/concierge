/**
 * F2-B · B3.1 — COLETOR: avaliação da janela de mensagens pendentes de uma conversa (puro).
 *
 * Decide, a partir do estado PERSISTIDO (mensagens gravadas + metadados dos webhooks brutos + pausa
 * derivada) e de um instante recebido por parâmetro, se a conversa está coletando, pronta, bloqueada
 * ou sem nada a fazer. Não agenda, não espera, não escreve, não chama modelo e não envia: um timer
 * externo pode apenas ACORDAR o worker; a elegibilidade é sempre recalculada aqui.
 *
 * Regras:
 *  - instante de referência de cada mensagem = `max(t_channel, t_received, t_persisted)`; o debounce
 *    (15 s por padrão, configurável por canal, sem adaptação dinâmica) conta a partir da referência
 *    da ÚLTIMA mensagem: nova mensagem reinicia a janela. `now ≥ eligibleAt` ⇒ pronta (inclusivo);
 *  - espera máxima desde a primeira mensagem (`maxWaitMs`) contra inanição em rajadas longas;
 *  - mensagem Airbnb gravada sem webhook bruto correspondente, ou bruto de hóspede ainda não gravado,
 *    segura o lote (`awaiting_reconciliation` / `awaiting_persistence`) até a carência de reconciliação;
 *    depois disso segue com o instante de canal DESCONHECIDO (contado na telemetria) — os atrasos
 *    reais chegam a 25 min, então o debounce NÃO garante que todo webhook chegou;
 *  - pausa: `unknown` ou indeterminada ⇒ bloqueio; ativa ⇒ bloqueio até o fim; depois do fim só as
 *    mensagens ESTRITAMENTE posteriores formam lote (`guestMessageActionability`); as da pausa viram
 *    `pausedBacklog` (nunca respondidas retroativamente, continuam no histórico);
 *  - limites do B2.5 (20 mensagens, 4.000 por mensagem, 12.000 no lote) sem truncamento: estouro ⇒
 *    estado tipado `rejected`; nunca lote parcial que pareça completo;
 *  - ordem do lote = ordem de gravação (a mesma do histórico, conferida pela cadeia); diferenças com a
 *    ordem do canal são CONTADAS (`reorderedByChannelTime`), não escondidas.
 */
import { BATCH_LIMITS, DEBOUNCE_REFERENCE, buildGuestMessageBatch, type BatchChannel, type BatchRejection, type BatchScope, type BatchSenderRole, type GuestMessageBatch } from "./message-batch";
import { guestMessageActionability, type HumanPauseState } from "@/lib/guest-ai/policy/human-pause";

export const COLLECTOR_VERSION = "collector.2026-11-03.1";

export interface CollectorConfig {
  /** Silêncio que encerra o lote (ms). Valor inicial homologado: 15 s. */
  quietWindowMs: number;
  maxWaitMs: number;
  /** Carência para reconciliar gravado × bruto antes de seguir com instante de canal desconhecido. */
  reconciliationGraceMs: number;
  perChannel?: Partial<Record<BatchChannel, { quietWindowMs?: number }>>;
}
/** Configuração inicial (diretriz B3.1 §3.2): 15 s, sem aumento automático nem adaptação. */
export const COLLECTOR_DEFAULTS: Readonly<CollectorConfig> = Object.freeze({ quietWindowMs: 15_000, maxWaitMs: 120_000, reconciliationGraceMs: 60_000 });

export function quietWindowFor(cfg: CollectorConfig, channel: BatchChannel): number {
  return cfg.perChannel?.[channel]?.quietWindowMs ?? cfg.quietWindowMs;
}

export function checkCollectorConfig(c: CollectorConfig): "ok" | "quiet_window_invalid" | "max_wait_invalid" | "grace_invalid" {
  const ws = [c.quietWindowMs, ...Object.values(c.perChannel ?? {}).map((p) => p?.quietWindowMs).filter((x): x is number => typeof x === "number")];
  // Diretriz B3.1: debounce configurável só entre 8 e 15 s (faixa do contrato B2.5, `DEBOUNCE_REFERENCE`).
  if (ws.some((w) => !Number.isFinite(w) || w < DEBOUNCE_REFERENCE.minQuietWindowMs || w > DEBOUNCE_REFERENCE.maxQuietWindowMs)) return "quiet_window_invalid";
  if (!Number.isFinite(c.maxWaitMs) || c.maxWaitMs < Math.max(...ws)) return "max_wait_invalid";
  if (!Number.isFinite(c.reconciliationGraceMs) || c.reconciliationGraceMs < 0 || c.reconciliationGraceMs > 30 * 60_000) return "grace_invalid";
  return "ok";
}

export interface CollectorMessage {
  id: string;
  conversationId: string;
  propertyId: string;
  tenantId: string;
  channel: BatchChannel;
  senderRole: BatchSenderRole;
  senderId: string;
  text: string;
  tPersisted: string | null;
  /** Instante do canal; `null` = desconhecido (sem bruto correspondente). */
  tChannel: string | null;
  tReceived: string | null;
  /** Airbnb: há webhook bruto ligado pelo id? (fora do Airbnb, sempre `true`). */
  rawMatched: boolean;
}

export interface CollectorWindowInput {
  scope: BatchScope;
  messages: readonly CollectorMessage[];
  /** Webhooks brutos de HÓSPEDE desta thread ainda sem mensagem gravada. */
  unpersistedRawGuest: ReadonlyArray<{ tReceived: string | null; tChannel: string | null }>;
  /** A leitura das pendentes bateu no teto (há mais do que o lido). */
  pendingOverflow: boolean;
  alreadyAnswered: readonly string[];
  pause: HumanPauseState;
  now: string;
  config?: CollectorConfig;
}

export interface CollectorMetrics {
  pending: number;
  pausedBacklog: number;
  channelTimeUnknown: number;
  reorderedByChannelTime: number;
  unpersistedRawGuest: number;
  maxChannelToReceiveMs: number | null;
  maxReceiveToPersistMs: number | null;
}

export type CollectorRejection = BatchRejection | "pending_overflow" | "actionability_out_of_order";

export type CollectorDecision =
  | { state: "idle"; reason: "no_pending" | "paused_backlog_only"; pausedBacklog: string[]; metrics: CollectorMetrics }
  | { state: "collecting"; reason: "quiet_window" | "awaiting_reconciliation" | "awaiting_persistence"; eligibleAt: string; metrics: CollectorMetrics }
  | { state: "blocked"; reason: "paused" | "pause_unknown" | "pause_indefinite"; retryAt: string | null; metrics: CollectorMetrics }
  | { state: "ready"; closure: "quiet_window" | "max_wait"; eligibleAt: string; batch: GuestMessageBatch; pausedBacklog: string[]; metrics: CollectorMetrics }
  | { state: "rejected"; reason: CollectorRejection; metrics: CollectorMetrics };

const ms = (v: string | null | undefined): number | null => {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};
const iso = (t: number) => new Date(t).toISOString();

export function evaluateCollectorWindow(i: CollectorWindowInput): CollectorDecision {
  const cfg = i.config ?? COLLECTOR_DEFAULTS;
  const metrics: CollectorMetrics = { pending: 0, pausedBacklog: 0, channelTimeUnknown: 0, reorderedByChannelTime: 0, unpersistedRawGuest: 0, maxChannelToReceiveMs: null, maxReceiveToPersistMs: null };
  const reject = (reason: CollectorRejection): CollectorDecision => ({ state: "rejected", reason, metrics });
  const now = ms(i?.now);
  if (now === null || checkCollectorConfig(cfg) !== "ok") return reject("invalid_timestamp");
  if (i.pendingOverflow) return reject("pending_overflow");
  const answered = new Set(i.alreadyAnswered ?? []);
  const msgs = (i.messages ?? []).filter((m) => m && !answered.has(m.id));
  metrics.pending = msgs.length;
  metrics.unpersistedRawGuest = (i.unpersistedRawGuest ?? []).length;
  if (msgs.length === 0 && metrics.unpersistedRawGuest === 0) return { state: "idle", reason: "no_pending", pausedBacklog: [], metrics };

  // Instantes: inválidos ⇒ rejeição tipada (nunca inferência permissiva).
  const refs: Array<{ m: CollectorMessage; ref: number; persisted: number; channel: number | null }> = [];
  for (const m of msgs) {
    const p = ms(m.tPersisted);
    const c = m.tChannel === null ? null : ms(m.tChannel);
    const r = m.tReceived === null ? null : ms(m.tReceived);
    if (p === null || (m.tChannel !== null && c === null) || (m.tReceived !== null && r === null)) return reject("invalid_timestamp");
    if (c === null) metrics.channelTimeUnknown++;
    if (c !== null && r !== null) metrics.maxChannelToReceiveMs = Math.max(metrics.maxChannelToReceiveMs ?? 0, r - c);
    if (r !== null) metrics.maxReceiveToPersistMs = Math.max(metrics.maxReceiveToPersistMs ?? 0, p - r);
    refs.push({ m, ref: Math.max(p, c ?? -Infinity, r ?? -Infinity), persisted: p, channel: c });
  }
  // Ordem de gravação (= histórico); desempate estável por id.
  refs.sort((a, b) => a.persisted - b.persisted || (a.m.id < b.m.id ? -1 : a.m.id > b.m.id ? 1 : 0));
  for (let k = 1; k < refs.length; k++) if (refs[k]!.channel !== null && refs[k - 1]!.channel !== null && refs[k]!.channel! < refs[k - 1]!.channel!) metrics.reorderedByChannelTime++;

  // Pausa (fail-closed).
  const pause = i.pause;
  if (!pause || pause.state === "unknown") return { state: "blocked", reason: "pause_unknown", retryAt: null, metrics };
  if (pause.indefinite) return { state: "blocked", reason: "pause_indefinite", retryAt: null, metrics };
  if (pause.state === "paused") return { state: "blocked", reason: "paused", retryAt: pause.pausedUntil, metrics };

  // Reconciliação gravado × bruto.
  const grace = cfg.reconciliationGraceMs;
  const unrec = refs.filter((x) => !x.m.rawMatched);
  if (unrec.some((x) => now < x.persisted + grace)) return { state: "collecting", reason: "awaiting_reconciliation", eligibleAt: iso(Math.max(...unrec.map((x) => x.persisted + grace))), metrics };
  const unpersisted = (i.unpersistedRawGuest ?? []).map((r) => ms(r.tReceived));
  if (unpersisted.some((t) => t === null)) return reject("invalid_timestamp");
  if (unpersisted.some((t) => now < (t as number) + grace)) return { state: "collecting", reason: "awaiting_persistence", eligibleAt: iso(Math.max(...(unpersisted as number[]).map((t) => t + grace))), metrics };

  // Acionabilidade depois da pausa: só o SUFIXO estritamente posterior.
  const backlog: string[] = [];
  const actionable: typeof refs = [];
  for (const x of refs) {
    const a = guestMessageActionability({ tChannel: x.m.tChannel, tPersisted: x.m.tPersisted }, pause);
    if (a === "blocked_unknown") return { state: "blocked", reason: "pause_unknown", retryAt: null, metrics };
    if (a === "blocked_indefinite") return { state: "blocked", reason: "pause_indefinite", retryAt: null, metrics };
    if (a === "paused_backlog") {
      if (actionable.length) return reject("actionability_out_of_order");
      backlog.push(x.m.id);
    } else actionable.push(x);
  }
  metrics.pausedBacklog = backlog.length;
  if (actionable.length === 0) return { state: "idle", reason: "paused_backlog_only", pausedBacklog: backlog, metrics };

  const quiet = quietWindowFor(cfg, i.scope.channel);
  const last = Math.max(...actionable.map((x) => x.ref));
  const first = Math.min(...actionable.map((x) => x.ref));
  const byQuiet = last + quiet;
  const byMax = first + cfg.maxWaitMs;
  const eligible = Math.min(byQuiet, byMax);
  if (now < eligible) return { state: "collecting", reason: "quiet_window", eligibleAt: iso(eligible), metrics };

  const built = buildGuestMessageBatch({
    scope: i.scope,
    messages: actionable.map((x) => ({ id: x.m.id, conversationId: x.m.conversationId, propertyId: x.m.propertyId, tenantId: x.m.tenantId, channel: x.m.channel, senderRole: x.m.senderRole, senderId: x.m.senderId, text: x.m.text, createdAt: x.m.tPersisted as string })),
    alreadyAnswered: [...answered, ...backlog],
    closed: true,
    limits: { ...BATCH_LIMITS },
  });
  if (!built.ok) return reject(built.reason);
  return { state: "ready", closure: byQuiet <= byMax ? "quiet_window" : "max_wait", eligibleAt: iso(eligible), batch: built.batch, pausedBacklog: backlog, metrics };
}
