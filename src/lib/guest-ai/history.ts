/**
 * F2-B · B2.1 — HISTÓRICO DA CONVERSA (normalização PURA).
 *
 * Transforma as linhas de `property_chat_messages` (já lidas por `data/history.server.ts`, com
 * projeção própria e sem notas internas) num histórico cronológico, integral e tipado. Nada aqui
 * acessa banco, rede ou relógio.
 *
 * Regras (diretriz B2.1 §6 e decisão D3/D7 do Gate B2.0):
 *  - ordem cronológica determinística: instante (com microssegundos) e, no empate, o id;
 *  - nenhum truncamento: ou o histórico vem inteiro até a mensagem atual, ou vem um estado
 *    `unavailable` explícito (nunca uma lista cortada em silêncio);
 *  - mensagens POSTERIORES à mensagem atual não são histórico deste turno: saem e são CONTADAS;
 *  - falante: hóspede, equipe, sistema, IA legada (`legacy_ai`) ou desconhecido (`unknown`). Toda
 *    mensagem de IA existente no banco é da IA antiga (removida em 01/11/2026): não tem autoridade;
 *    combinações ambíguas (ex.: `role=user` + `sender_type=ai`, 48 linhas legadas) são `unknown`;
 *  - nota interna da equipe nunca entra (filtrada na consulta e de novo aqui, por defesa);
 *  - duplicata (mesmo id) entra uma vez só, e é contada.
 * O histórico é CONTEXTO, não autorização: nada aqui concede permissão a ninguém.
 */

export const HISTORY_SPEAKERS = ["guest", "team", "legacy_ai", "system", "unknown"] as const;
export type HistorySpeaker = (typeof HISTORY_SPEAKERS)[number];

export type HistoryChannel = "guide_chat" | "whatsapp" | "airbnb" | "unknown";
/** `failed` = o hóspede não recebeu; `sent`/`delivered` = canal confirmou; `recorded` = sem status de entrega (chat do guia). */
export type HistoryDelivery = "failed" | "sent" | "delivered" | "recorded";

/** Linha lida do banco (subconjunto exato de `HISTORY_MESSAGE_COLUMNS`). */
export interface HistoryRow {
  id: string;
  conversation_id: string;
  role: string | null;
  sender_type: string | null;
  channel: string | null;
  content: string | null;
  created_at: string | null;
  is_internal_note: boolean | null;
  delivery_status: string | null;
  attachment_type: string | null;
  attachment_duration_ms: number | null;
  attachment_transcript: string | null;
  /** Item do Guia Digital que abriu o chat (conferido pelo servidor do guia antes de gravar). Opcional. */
  guide_context?: unknown;
}

/** Item da página principal do guia (evento da cidade) que o hóspede tocou para abrir o chat. */
export interface GuideItemContext {
  kind: "city_event";
  id: string;
  name: string;
  type: string | null;
  category: string | null;
}

/** Lê `guide_context` com forma fechada; qualquer outra coisa ⇒ null (nunca texto livre arbitrário). */
export function parseGuideContext(v: unknown): GuideItemContext | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const s = (x: unknown, max: number) =>
    typeof x === "string" && x.trim() ? x.trim().slice(0, max) : null;
  const kind = o["kind"] === "city_event" ? "city_event" : null;
  const id = s(o["id"], 80);
  const name = s(o["name"], 200);
  if (!kind || !id || !name || !/^[a-z0-9:_-]+$/i.test(id)) return null;
  return { kind, id, name, type: s(o["type"], 40), category: s(o["category"], 80) };
}

export interface HistoryMedia {
  kind: "audio" | "image" | "file" | "unknown";
  durationMs: number | null;
  /** Texto derivado da mídia (transcrição/descrição), quando existe. Nunca é gerado aqui. */
  derivedText: { status: "available"; text: string } | { status: "missing" };
}

export interface HistoryEntry {
  /**
   * Id citável no prompt, estável dentro do turno: `hist:<falante>:h<posição>` (ex.: `hist:guest:h3`,
   * `hist:team:h2`). O falante no id permite ao Validator exigir que um marco de hospitalidade seja
   * provado por mensagem do HÓSPEDE (e pela atual, a de maior posição entre as do hóspede).
   */
  ref: string;
  messageId: string;
  speaker: HistorySpeaker;
  channel: HistoryChannel;
  at: string;
  text: string;
  media: HistoryMedia | null;
  delivery: HistoryDelivery;
  /** A mensagem que o turno responde (sempre a última entrada). */
  current: boolean;
  /** Item do guia que abriu o chat (só em mensagem do hóspede). */
  guideContext?: GuideItemContext | null;
}

export type HistoryUnavailableReason =
  | "not_loaded"
  | "lookup_failed"
  | "over_limit"
  | "scope_mismatch"
  | "current_message_missing"
  | "chronology_unprovable";

export interface HistoryCounts {
  /** Linhas recebidas da consulta. */
  loaded: number;
  /** Entradas entregues (até a mensagem atual, inclusive). */
  included: number;
  internalNotesExcluded: number;
  afterCurrentExcluded: number;
  duplicatesRemoved: number;
}

export type HistoryResult =
  | {
      status: "available";
      conversationId: string;
      currentMessageId: string;
      entries: HistoryEntry[];
      counts: HistoryCounts;
    }
  | { status: "unavailable"; reason: HistoryUnavailableReason };

const SPEAKER_BY_ROLE: Readonly<Record<string, HistorySpeaker>> = Object.freeze({
  "user|guest": "guest",
  "assistant|human": "team",
  "assistant|ai": "legacy_ai",
  "assistant|system": "system",
});

/** Consulta só chaves PRÓPRIAS da tabela (nunca `constructor`, `toString`… do protótipo). */
function own<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

/** Falante a partir do par (role, sender_type). Qualquer combinação fora da tabela é `unknown`. */
export function classifySpeaker(role: string | null, senderType: string | null): HistorySpeaker {
  return own(SPEAKER_BY_ROLE, `${role ?? ""}|${senderType ?? ""}`) ?? "unknown";
}

const CHANNEL_BY_DB: Readonly<Record<string, HistoryChannel>> = Object.freeze({
  web: "guide_chat",
  whatsapp: "whatsapp",
  airbnb: "airbnb",
});

export function classifyChannel(channel: string | null): HistoryChannel {
  return own(CHANNEL_BY_DB, channel ?? "") ?? "unknown";
}

export function classifyDelivery(status: string | null): HistoryDelivery {
  if (status === "failed") return "failed";
  if (status === "sent") return "sent";
  if (status === "delivered") return "delivered";
  return "recorded";
}

function mediaOf(row: HistoryRow): HistoryMedia | null {
  const type = row.attachment_type;
  if (!type) return null;
  const kind: HistoryMedia["kind"] =
    type === "audio" || type === "image" || type === "file" ? type : "unknown";
  const derived =
    typeof row.attachment_transcript === "string" && row.attachment_transcript.trim()
      ? row.attachment_transcript
      : null;
  return {
    kind,
    durationMs:
      typeof row.attachment_duration_ms === "number" && Number.isFinite(row.attachment_duration_ms)
        ? row.attachment_duration_ms
        : null,
    derivedText: derived ? { status: "available", text: derived } : { status: "missing" },
  };
}

/**
 * Chave de ordenação em MICROSSEGUNDOS (o Postgres grava µs; `Date.parse` só vê ms — sem isto,
 * duas mensagens no mesmo milissegundo ficariam na ordem do id, não na do tempo).
 * `null` = instante não comprovável.
 */
export function instantKey(value: string | null): number | null {
  if (typeof value !== "string" || !value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  const frac = /T\d{2}:\d{2}:\d{2}\.(\d+)/.exec(value)?.[1] ?? "";
  const micros = Number((frac + "000000").slice(0, 6));
  return ms * 1000 + (micros % 1000);
}

/**
 * Normaliza as linhas do histórico de UMA conversa até a mensagem atual (inclusive).
 * Qualquer linha de outra conversa invalida o resultado inteiro (nunca se mistura conversa).
 */
export function normalizeHistory(
  rows: readonly HistoryRow[],
  scope: { conversationId: string; currentMessageId: string },
): HistoryResult {
  if (!Array.isArray(rows)) return { status: "unavailable", reason: "lookup_failed" };
  if (rows.some((r) => !r || r.conversation_id !== scope.conversationId))
    return { status: "unavailable", reason: "scope_mismatch" };

  let internalNotesExcluded = 0;
  let duplicatesRemoved = 0;
  const seen = new Set<string>();
  const kept: Array<{ row: HistoryRow; key: number }> = [];
  for (const row of rows) {
    if (row.is_internal_note !== false) {
      // `true` = nota interna; `null` = não comprovado como mensagem ao hóspede. Nenhum dos dois entra.
      internalNotesExcluded += 1;
      continue;
    }
    if (seen.has(row.id)) {
      duplicatesRemoved += 1;
      continue;
    }
    seen.add(row.id);
    const key = instantKey(row.created_at);
    if (key === null) return { status: "unavailable", reason: "chronology_unprovable" };
    kept.push({ row, key });
  }
  kept.sort((a, b) =>
    a.key !== b.key ? a.key - b.key : a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0,
  );

  const idx = kept.findIndex((k) => k.row.id === scope.currentMessageId);
  if (idx < 0) return { status: "unavailable", reason: "current_message_missing" };
  const upTo = kept.slice(0, idx + 1);

  const entries: HistoryEntry[] = upTo.map(({ row }, i) => {
    const speaker = classifySpeaker(row.role, row.sender_type);
    return {
      ref: `hist:${speaker}:h${i + 1}`,
      messageId: row.id,
      speaker,
      channel: classifyChannel(row.channel),
      at: String(row.created_at),
      text: typeof row.content === "string" ? row.content : "",
      media: mediaOf(row),
      delivery: classifyDelivery(row.delivery_status),
      current: i === idx,
      ...(speaker === "guest" && row.guide_context != null
        ? { guideContext: parseGuideContext(row.guide_context) }
        : {}),
    };
  });

  return {
    status: "available",
    conversationId: scope.conversationId,
    currentMessageId: scope.currentMessageId,
    entries,
    counts: {
      loaded: rows.length,
      included: entries.length,
      internalNotesExcluded,
      afterCurrentExcluded: kept.length - upTo.length,
      duplicatesRemoved,
    },
  };
}
