/**
 * F2-B · B2.5 — CONTRATO DE AGRUPAMENTO de mensagens em rajada (`GuestMessageBatch`). Puro.
 *
 * O hóspede costuma mandar várias mensagens curtas seguidas ("Oi" / "Tenho uma dúvida" / "O
 * estacionamento é coberto?" / "E cabe uma caminhonete?"). O conjunto consecutivo, ainda não
 * atendido, do MESMO interlocutor na MESMA conversa é UM turno lógico: uma análise, uma decisão e,
 * no máximo, uma resposta.
 *
 * Este módulo só VALIDA e NORMALIZA um lote que um chamador já fechou. Não há coletor, fila, timer,
 * debounce, worker nem webhook (B3). O lote precisa chegar declarado como fechado (`closed: true`):
 * a janela de silêncio é responsabilidade da B3 (`DebounceConfig`, abaixo, é só contrato).
 *
 * Regras (fail-closed — qualquer violação recusa o lote inteiro, nunca "aproveita" parte dele):
 *  - nunca mistura conversa, imóvel, tenant, canal ou remetente;
 *  - mensagem da equipe/IA/sistema nunca entra como se fosse do hóspede;
 *  - mensagem já atendida/processada nunca entra de novo;
 *  - duplicata exata (mesmo id e mesmo conteúdo) é removida e registrada; mesmo id com conteúdo
 *    diferente recusa o lote;
 *  - ordem por instante confiável + id como desempate estável; cada mensagem mantém id, texto
 *    original e posição (a fronteira entre mensagens nunca se perde);
 *  - limites de quantidade e tamanho.
 * Lotes válidos são emitidos por registro (WeakSet): a cadeia recusa lote forjado ou copiado.
 */
export const MESSAGE_BATCH_VERSION = "message-batch.2026-11-03.1";

/** Limites padrão (configuráveis pelo chamador, nunca acima dos tetos). */
export const BATCH_LIMITS = Object.freeze({ maxMessages: 20, maxMessageChars: 4_000, maxTotalChars: 12_000 });
const HARD_CAPS = Object.freeze({ maxMessages: 50, maxMessageChars: 8_000, maxTotalChars: 24_000 });

export type BatchChannel = "web" | "whatsapp" | "airbnb";
export type BatchSenderRole = "guest" | "team" | "ai" | "system" | "unknown";

export interface BatchMessageInput {
  id: string;
  conversationId: string;
  propertyId: string;
  tenantId: string;
  channel: BatchChannel;
  senderRole: BatchSenderRole;
  /** Identificador opaco do interlocutor (sessão do hóspede na conversa). */
  senderId: string;
  text: string;
  /** Instante confiável (ISO 8601, do banco). */
  createdAt: string;
  /** Estado de atendimento quando a fonte comprova; ausente = desconhecido (não "pendente"). */
  processing?: "pending" | "answered" | "processed" | null;
}

export interface GuestMessageBatch {
  version: string;
  batchId: string;
  conversationId: string;
  propertyId: string;
  tenantId: string;
  channel: BatchChannel;
  senderId: string;
  messages: ReadonlyArray<{ id: string; text: string; createdAt: string; position: number }>;
  size: number;
  totalChars: number;
  firstMessageId: string;
  latestMessageId: string;
  duplicatesRemoved: string[];
  completeness: "closed";
  closure: { reason: "caller_closed" };
}

export const BATCH_REJECTIONS = [
  "empty_batch",
  "batch_not_closed",
  "cross_conversation",
  "cross_property",
  "cross_tenant",
  "cross_channel",
  "other_sender",
  "non_guest_message",
  "already_processed",
  "duplicate_conflict",
  "invalid_timestamp",
  "invalid_message",
  "too_many_messages",
  "message_too_large",
  "batch_too_large",
] as const;
export type BatchRejection = (typeof BATCH_REJECTIONS)[number];

export interface BatchScope {
  conversationId: string;
  propertyId: string;
  tenantId: string;
  channel: BatchChannel;
  senderId: string;
}

export interface BuildBatchInput {
  scope: BatchScope;
  messages: readonly BatchMessageInput[];
  /** Ids já respondidos/processados (fonte confiável do chamador). */
  alreadyAnswered: readonly string[];
  /** O chamador declara que a janela de agrupamento foi encerrada. */
  closed: boolean;
  limits?: Partial<Record<keyof typeof BATCH_LIMITS, number>>;
}

export type BuildBatchResult = { ok: true; batch: GuestMessageBatch } | { ok: false; reason: BatchRejection };

const issued = new WeakSet<object>();
export const isIssuedBatch = (v: unknown): v is GuestMessageBatch => typeof v === "object" && v !== null && issued.has(v);

/** Hash FNV-1a (determinístico, não criptográfico) — só para identificar o lote. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function deepFreeze<T>(v: T): T {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v as object)) deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
}

export function buildGuestMessageBatch(input: BuildBatchInput): BuildBatchResult {
  const no = (reason: BatchRejection): BuildBatchResult => ({ ok: false, reason });
  if (!input || !Array.isArray(input.messages) || input.messages.length === 0) return no("empty_batch");
  if (input.closed !== true) return no("batch_not_closed");
  const lim = {
    maxMessages: Math.min(HARD_CAPS.maxMessages, input.limits?.maxMessages ?? BATCH_LIMITS.maxMessages),
    maxMessageChars: Math.min(HARD_CAPS.maxMessageChars, input.limits?.maxMessageChars ?? BATCH_LIMITS.maxMessageChars),
    maxTotalChars: Math.min(HARD_CAPS.maxTotalChars, input.limits?.maxTotalChars ?? BATCH_LIMITS.maxTotalChars),
  };
  const s = input.scope;
  const answered = new Set(input.alreadyAnswered ?? []);
  const byId = new Map<string, BatchMessageInput>();
  const duplicates: string[] = [];
  for (const m of input.messages) {
    if (!m || typeof m.id !== "string" || !m.id || typeof m.text !== "string") return no("invalid_message");
    if (m.conversationId !== s.conversationId) return no("cross_conversation");
    if (m.propertyId !== s.propertyId) return no("cross_property");
    if (m.tenantId !== s.tenantId) return no("cross_tenant");
    if (m.channel !== s.channel) return no("cross_channel");
    if (m.senderRole !== "guest") return no("non_guest_message");
    if (m.senderId !== s.senderId) return no("other_sender");
    if (answered.has(m.id) || m.processing === "answered" || m.processing === "processed") return no("already_processed");
    if (!Number.isFinite(Date.parse(m.createdAt))) return no("invalid_timestamp");
    if (m.text.length > lim.maxMessageChars) return no("message_too_large");
    const prior = byId.get(m.id);
    if (prior) {
      if (prior.text !== m.text || prior.createdAt !== m.createdAt) return no("duplicate_conflict");
      duplicates.push(m.id);
      continue;
    }
    byId.set(m.id, m);
  }
  const unique = [...byId.values()];
  if (unique.length > lim.maxMessages) return no("too_many_messages");
  const total = unique.reduce((n, m) => n + m.text.length, 0);
  if (total > lim.maxTotalChars) return no("batch_too_large");
  // Ordem por instante confiável; desempate estável pelo id (eventos atrasados/fora de ordem).
  unique.sort((a, b) => {
    const d = Date.parse(a.createdAt) - Date.parse(b.createdAt);
    if (d !== 0) return d;
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const messages = unique.map((m, position) => ({ id: m.id, text: m.text, createdAt: m.createdAt, position }));
  const batch: GuestMessageBatch = {
    version: MESSAGE_BATCH_VERSION,
    batchId: `batch:${fnv1a(`${s.conversationId}|${messages.map((m) => m.id).join(",")}`)}`,
    conversationId: s.conversationId,
    propertyId: s.propertyId,
    tenantId: s.tenantId,
    channel: s.channel,
    senderId: s.senderId,
    messages,
    size: messages.length,
    totalChars: total,
    firstMessageId: messages[0]!.id,
    latestMessageId: messages[messages.length - 1]!.id,
    duplicatesRemoved: duplicates,
    completeness: "closed",
    closure: { reason: "caller_closed" },
  };
  deepFreeze(batch);
  issued.add(batch);
  return { ok: true, batch };
}

// ─────────────────────────── Preparação da B3 (SÓ contrato; nada é executado aqui) ───────────────────────────

/**
 * Política de agrupamento. Referência (refinamento de hospitalidade, 06/11/2026): respiro de ~6 s dentro de
 * 5–8 s — o Copiloto já a aplica no disparo (`COPILOT_BURST_QUIET_MS`, `copilot/trigger.server.ts`).
 */
export interface DebounceConfig {
  /** Silêncio que encerra o lote (ms). Nova mensagem válida reinicia a contagem. */
  quietWindowMs: number;
  /** Espera máxima desde a 1ª mensagem (ms), contra inanição em rajadas longas. */
  maxWaitMs: number;
  maxMessages: number;
  maxTotalChars: number;
  perChannel?: Partial<Record<BatchChannel, { quietWindowMs?: number; maxWaitMs?: number }>>;
}
export const DEBOUNCE_REFERENCE = Object.freeze({ quietWindowMs: 6_000, minQuietWindowMs: 5_000, maxQuietWindowMs: 8_000 });

/** Valida uma configuração proposta (faixas de sanidade); não agenda nada. */
export function checkDebounceConfig(c: DebounceConfig): "ok" | "quiet_window_out_of_range" | "max_wait_below_quiet_window" | "limits_invalid" {
  const windows = [c.quietWindowMs, ...Object.values(c.perChannel ?? {}).map((p) => p?.quietWindowMs).filter((x): x is number => typeof x === "number")];
  if (windows.some((w) => !Number.isFinite(w) || w < DEBOUNCE_REFERENCE.minQuietWindowMs || w > DEBOUNCE_REFERENCE.maxQuietWindowMs)) return "quiet_window_out_of_range";
  if (!Number.isFinite(c.maxWaitMs) || c.maxWaitMs < c.quietWindowMs) return "max_wait_below_quiet_window";
  if (!(c.maxMessages >= 1 && c.maxMessages <= HARD_CAPS.maxMessages) || !(c.maxTotalChars >= 1 && c.maxTotalChars <= HARD_CAPS.maxTotalChars)) return "limits_invalid";
  return "ok";
}
