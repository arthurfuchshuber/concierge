/**
 * F2-B · B2.1 — LEITURA do histórico da conversa (somente leitura, projeção própria).
 *
 * - Só depois de um `ValidatedTurn` emitido por `scope.server.ts` (conversa, mensagem, imóvel e
 *   conta já conferidos): a consulta é filtrada pelo `conversation_id` DO TURNO.
 * - Projeção explícita e mínima (`HISTORY_MESSAGE_COLUMNS`): fica FORA quem enviou (uuid), número
 *   de WhatsApp de envio, caminho do anexo no storage, id externo do canal, custos e modelos de IA.
 * - Notas internas da equipe são filtradas NA CONSULTA (`is_internal_note = false`; 0 nulos em
 *   produção em 03/11/2026) e de novo na normalização.
 * - Sem truncamento: lê até `HISTORY_MAX_ROWS + 1` linhas; se passar do teto, devolve
 *   `over_limit` (nunca uma lista cortada). Maior conversa em produção: 100 mensagens.
 * - Cancelamento: toda consulta passa por `abortableDb(db, signal)`; cancelamento interrompe o turno
 *   (`GuestAiAbortedError`), não vira "histórico indisponível".
 *
 * O TEXTO das mensagens é livre e pode conter segredo digitado (21 mensagens em produção casam com
 * padrão de código de acesso): quem compõe o prompt é obrigado a passá-lo por um guard de texto
 * livre (secret-scrub, B2.2). Ver `composer.ts`.
 */
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import { assertIssued } from "@/lib/guest-ai/trust";
import { normalizeHistory, type HistoryResult, type HistoryRow } from "@/lib/guest-ai/history";
import { GuestAiAbortedError, abortableDb, getGuestAiDb, throwIfAborted, type GuestAiDb } from "./client.server";
import { cols } from "./projections";

/** Colunas lidas do histórico. Nenhuma de identidade de quem atende, telefone, storage ou custo. */
export const HISTORY_MESSAGE_COLUMNS = [
  "id",
  "conversation_id",
  "role",
  "sender_type",
  "channel",
  "content",
  "created_at",
  "is_internal_note",
  "delivery_status",
  "attachment_type",
  "attachment_duration_ms",
  "attachment_transcript",
] as const;

/** Teto de linhas por conversa. Acima disso: `over_limit` explícito (sem corte). */
export const HISTORY_MAX_ROWS = 500;

export async function fetchConversationHistory(
  turn: ValidatedTurn,
  deps: { db?: GuestAiDb; signal?: AbortSignal } = {},
): Promise<HistoryResult> {
  assertIssued("turn", turn, "data_requires_validated_turn");
  throwIfAborted(deps.signal);
  const db = abortableDb(deps.db ?? (await getGuestAiDb()), deps.signal);

  let data: unknown;
  try {
    const res = await db
      .from("property_chat_messages")
      .select(cols(HISTORY_MESSAGE_COLUMNS))
      .eq("conversation_id", turn.conversationId)
      .eq("is_internal_note", false)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(HISTORY_MAX_ROWS + 1);
    if (res.error) {
      throwIfAborted(deps.signal);
      return { status: "unavailable", reason: "lookup_failed" };
    }
    data = res.data;
  } catch (e) {
    if (e instanceof GuestAiAbortedError || deps.signal?.aborted) throw new GuestAiAbortedError();
    return { status: "unavailable", reason: "lookup_failed" };
  }
  throwIfAborted(deps.signal);

  const rows = Array.isArray(data) ? (data as HistoryRow[]) : null;
  if (!rows) return { status: "unavailable", reason: "lookup_failed" };
  if (rows.length > HISTORY_MAX_ROWS) return { status: "unavailable", reason: "over_limit" };
  return normalizeHistory(rows, { conversationId: turn.conversationId, currentMessageId: turn.messageId });
}
