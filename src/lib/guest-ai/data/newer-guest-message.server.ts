/**
 * RAJADA DE MENSAGENS — o hóspede mandou outra mensagem depois desta? (somente leitura, projeção mínima)
 *
 * Usado pelo Copiloto depois da janela de respiro (Pilar 4 do refinamento de hospitalidade, 06/11/2026): se já
 * existe mensagem do hóspede mais nova na MESMA conversa, a geração desta mensagem é dispensada — a da mais nova
 * vê o conjunto inteiro (as mensagens em sequência viram um único turno no prompt) e produz UMA resposta.
 * Falha de leitura ⇒ `unknown` (o chamador segue gerando: nunca perder a resposta por um erro de leitura).
 */
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import { assertIssued } from "@/lib/guest-ai/trust";
import { GuestAiAbortedError, abortableDb, getGuestAiDb, throwIfAborted, type GuestAiDb } from "./client.server";

export type NewerGuestMessage = "newer" | "none" | "unknown";

export async function hasNewerGuestMessage(
  turn: ValidatedTurn,
  deps: { db?: GuestAiDb; signal?: AbortSignal } = {},
): Promise<NewerGuestMessage> {
  assertIssued("turn", turn, "data_requires_validated_turn");
  throwIfAborted(deps.signal);
  if (!turn.messageCreatedAt) return "unknown";
  const db = abortableDb(deps.db ?? (await getGuestAiDb()), deps.signal);
  try {
    const r = await db
      .from("property_chat_messages")
      .select("id")
      .eq("conversation_id", turn.conversationId)
      .eq("role", "user")
      .eq("sender_type", "guest")
      .eq("is_internal_note", false)
      .gt("created_at", turn.messageCreatedAt)
      .neq("id", turn.messageId)
      .limit(1);
    throwIfAborted(deps.signal);
    if (r.error || !Array.isArray(r.data)) return "unknown";
    return r.data.length > 0 ? "newer" : "none";
  } catch (e) {
    if (e instanceof GuestAiAbortedError || deps.signal?.aborted) throw new GuestAiAbortedError();
    return "unknown";
  }
}
