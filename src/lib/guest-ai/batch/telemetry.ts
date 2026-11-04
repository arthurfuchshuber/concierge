/**
 * F2-B · B3.1 — TELEMETRIA DO COLETOR (`guest_ai.collector_batch.v1`), só metadados (pura).
 *
 * Registro por lista branca: canal, ids internos opacos (conversa, lote), contagens, instantes,
 * durações, motivo de encerramento, tentativas e resultado do lease. Nenhum texto, nome, telefone,
 * credencial, token de lease, conteúdo do contexto ou id externo do canal. O registro é validado
 * (chave desconhecida ou valor fora do tipo ⇒ recusado) e congelado.
 *
 * Persistência: NÃO há tabela autorizada (exigiria migration). Só o contrato + coletor em memória
 * injetável (`emitCollectorTelemetry`), cuja falha nunca afeta o lote: o erro é engolido e contado.
 */
import type { BatchChannel } from "./message-batch";

export const COLLECTOR_TELEMETRY_VERSION = "guest_ai.collector_batch.v1";

export const CLOSURE_REASONS = ["quiet_window", "max_wait", "paused_backlog_only", "blocked_paused", "blocked_pause_unknown", "rejected", "cancelled", "expired", "failed"] as const;
export const LEASE_RESULTS = ["acquired", "held_by_other", "version_conflict", "recovered_expired", "backend_unavailable", "not_attempted"] as const;
export const FINAL_STATES = ["completed", "failed", "cancelled", "expired", "pending"] as const;

export interface CollectorTelemetryRecord {
  version: typeof COLLECTOR_TELEMETRY_VERSION;
  channel: BatchChannel;
  conversationId: string;
  batchId: string | null;
  messageCount: number;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  lastReceivedAt: string | null;
  lastPersistedAt: string | null;
  eligibleAt: string | null;
  claimedAt: string | null;
  finishedAt: string | null;
  waitMs: number | null;
  lateArrivals: number;
  channelTimeUnknown: number;
  reorderedByChannelTime: number;
  pausedBacklog: number;
  maxChannelToReceiveMs: number | null;
  maxReceiveToPersistMs: number | null;
  closureReason: (typeof CLOSURE_REASONS)[number];
  attempts: number;
  leaseResult: (typeof LEASE_RESULTS)[number];
  finalState: (typeof FINAL_STATES)[number];
  duplicatesRemoved: number;
}

const KEYS: ReadonlyArray<keyof CollectorTelemetryRecord> = [
  "version", "channel", "conversationId", "batchId", "messageCount", "firstMessageAt", "lastMessageAt", "lastReceivedAt", "lastPersistedAt", "eligibleAt",
  "claimedAt", "finishedAt", "waitMs", "lateArrivals", "channelTimeUnknown", "reorderedByChannelTime", "pausedBacklog", "maxChannelToReceiveMs",
  "maxReceiveToPersistMs", "closureReason", "attempts", "leaseResult", "finalState", "duplicatesRemoved",
];
const NUM: ReadonlySet<string> = new Set(["messageCount", "lateArrivals", "channelTimeUnknown", "reorderedByChannelTime", "pausedBacklog", "attempts", "duplicatesRemoved"]);
const NUM_NULL: ReadonlySet<string> = new Set(["waitMs", "maxChannelToReceiveMs", "maxReceiveToPersistMs"]);
const ISO_NULL: ReadonlySet<string> = new Set(["firstMessageAt", "lastMessageAt", "lastReceivedAt", "lastPersistedAt", "eligibleAt", "claimedAt", "finishedAt"]);
const OPAQUE = /^[A-Za-z0-9:_-]{1,80}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export type TelemetryCheck = { ok: true; record: Readonly<CollectorTelemetryRecord> } | { ok: false; reason: "unknown_key" | "invalid_value" };

/** Valida por lista branca e congela. Qualquer chave fora do contrato (ex.: texto) ⇒ recusa. */
export function buildCollectorTelemetry(input: Record<string, unknown>): TelemetryCheck {
  if (!input || typeof input !== "object") return { ok: false, reason: "invalid_value" };
  for (const k of Object.keys(input)) if (!(KEYS as readonly string[]).includes(k)) return { ok: false, reason: "unknown_key" };
  for (const k of KEYS) {
    const v = input[k];
    if (k === "version" ? v !== COLLECTOR_TELEMETRY_VERSION : false) return { ok: false, reason: "invalid_value" };
    if (k === "channel" && !["web", "whatsapp", "airbnb"].includes(String(v))) return { ok: false, reason: "invalid_value" };
    if (k === "conversationId" && (typeof v !== "string" || !OPAQUE.test(v))) return { ok: false, reason: "invalid_value" };
    if (k === "batchId" && v !== null && (typeof v !== "string" || !OPAQUE.test(v))) return { ok: false, reason: "invalid_value" };
    if (NUM.has(k) && !(Number.isInteger(v) && (v as number) >= 0)) return { ok: false, reason: "invalid_value" };
    if (NUM_NULL.has(k) && v !== null && !(typeof v === "number" && Number.isFinite(v))) return { ok: false, reason: "invalid_value" };
    if (ISO_NULL.has(k) && v !== null && (typeof v !== "string" || !ISO.test(v))) return { ok: false, reason: "invalid_value" };
    if (k === "closureReason" && !(CLOSURE_REASONS as readonly string[]).includes(String(v))) return { ok: false, reason: "invalid_value" };
    if (k === "leaseResult" && !(LEASE_RESULTS as readonly string[]).includes(String(v))) return { ok: false, reason: "invalid_value" };
    if (k === "finalState" && !(FINAL_STATES as readonly string[]).includes(String(v))) return { ok: false, reason: "invalid_value" };
  }
  return { ok: true, record: Object.freeze({ ...(input as unknown as CollectorTelemetryRecord) }) };
}

export type TelemetrySink = (r: Readonly<CollectorTelemetryRecord>) => void;

/** Entrega ao coletor; falha do coletor nunca propaga (devolve só o status). */
export function emitCollectorTelemetry(input: Record<string, unknown>, sink: TelemetrySink | null | undefined): "emitted" | "rejected" | "sink_failed" | "no_sink" {
  const b = buildCollectorTelemetry(input);
  if (!b.ok) return "rejected";
  if (!sink) return "no_sink";
  try {
    sink(b.record);
    return "emitted";
  } catch {
    return "sink_failed";
  }
}

export interface CollectorTelemetrySummary {
  batches: number;
  byChannel: Partial<Record<BatchChannel, { batches: number; messages: number; meanMessages: number; fragmentationRate: number; lateArrivalRate: number; p95WaitMs: number | null; maxChannelToReceiveMs: number | null }>>;
  leaseRecoveries: number;
  concurrentClaimsRefused: number;
  duplicates: number;
  expired: number;
  cancelled: number;
  failed: number;
  sizeDistribution: Record<string, number>;
}

/**
 * Métricas para calibrar o debounce. Fragmentação: lote seguido, na MESMA conversa, por outro lote
 * cuja primeira mensagem chegou até `fragmentGapMs` depois da última deste (continuação perdida).
 */
export function summarizeCollectorTelemetry(records: ReadonlyArray<CollectorTelemetryRecord>, fragmentGapMs = 60_000): CollectorTelemetrySummary {
  const out: CollectorTelemetrySummary = { batches: records.length, byChannel: {}, leaseRecoveries: 0, concurrentClaimsRefused: 0, duplicates: 0, expired: 0, cancelled: 0, failed: 0, sizeDistribution: {} };
  const byConv = new Map<string, CollectorTelemetryRecord[]>();
  for (const r of records) {
    byConv.set(r.conversationId, [...(byConv.get(r.conversationId) ?? []), r]);
    if (r.leaseResult === "recovered_expired") out.leaseRecoveries++;
    if (r.leaseResult === "held_by_other" || r.leaseResult === "version_conflict") out.concurrentClaimsRefused++;
    out.duplicates += r.duplicatesRemoved;
    if (r.finalState === "expired") out.expired++;
    if (r.finalState === "cancelled") out.cancelled++;
    if (r.finalState === "failed") out.failed++;
    const bucket = r.messageCount >= 5 ? "5+" : String(r.messageCount);
    out.sizeDistribution[bucket] = (out.sizeDistribution[bucket] ?? 0) + 1;
  }
  const fragmented = new Set<CollectorTelemetryRecord>();
  for (const list of byConv.values()) {
    const sorted = [...list].filter((r) => r.lastMessageAt && r.firstMessageAt).sort((a, b) => Date.parse(a.firstMessageAt!) - Date.parse(b.firstMessageAt!));
    for (let k = 0; k + 1 < sorted.length; k++) {
      if (Date.parse(sorted[k + 1]!.firstMessageAt!) - Date.parse(sorted[k]!.lastMessageAt!) <= fragmentGapMs) fragmented.add(sorted[k]!);
    }
  }
  for (const ch of ["web", "whatsapp", "airbnb"] as const) {
    const rs = records.filter((r) => r.channel === ch);
    if (!rs.length) continue;
    const waits = rs.map((r) => r.waitMs).filter((x): x is number => x !== null).sort((a, b) => a - b);
    const msgs = rs.reduce((n, r) => n + r.messageCount, 0);
    const lags = rs.map((r) => r.maxChannelToReceiveMs).filter((x): x is number => x !== null);
    out.byChannel[ch] = {
      batches: rs.length,
      messages: msgs,
      meanMessages: msgs / rs.length,
      fragmentationRate: rs.filter((r) => fragmented.has(r)).length / rs.length,
      lateArrivalRate: msgs ? rs.reduce((n, r) => n + r.lateArrivals, 0) / msgs : 0,
      p95WaitMs: waits.length ? waits[Math.min(waits.length - 1, Math.ceil(waits.length * 0.95) - 1)]! : null,
      maxChannelToReceiveMs: lags.length ? Math.max(...lags) : null,
    };
  }
  return out;
}
