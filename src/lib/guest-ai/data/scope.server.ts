/**
 * VALIDAÇÃO DO TURNO — porta de entrada de toda a camada de dados do Guest.
 *
 * O canal (rota do guia, webhook Sinch, fila Channex) já autenticou a requisição
 * (passe assinado, HMAC, anúncio resolvido com certeza). Aqui o BACKEND confirma,
 * a partir do banco, tudo o que o canal afirma, sem confiar em nenhum
 * identificador vindo do cliente:
 *   - a mensagem existe, pertence A ESTA conversa e é do hóspede (não nota interna,
 *     não resposta da equipe/IA);
 *   - o canal informado confere com a conversa (prefixo da sessão) e com a mensagem;
 *   - a conversa aponta para um imóvel que existe e tem dono (conta);
 *   - se o canal informou o dono esperado, ele confere com o dono REAL do imóvel.
 * Qualquer divergência lança `GuestAiScopeError` e o chamador cai no fallback humano.
 */
import { GUEST_SURFACES, type GuestSurface, type ValidatedTurn } from "@/lib/guest-ai/types";
import { issue } from "@/lib/guest-ai/trust";
import type { GuestAiDb } from "./client.server";
import { getGuestAiDb } from "./client.server";
import { CONVERSATION_COLUMNS, MESSAGE_COLUMNS, PROPERTY_SCOPE_COLUMNS, cols } from "./projections";

export type ScopeErrorCode =
  | "invalid_input"
  | "conversation_not_found"
  | "message_not_found"
  | "message_conversation_mismatch"
  | "message_not_from_guest"
  | "surface_mismatch"
  | "property_unresolved"
  | "tenant_mismatch"
  | "lookup_failed";

export class GuestAiScopeError extends Error {
  constructor(public readonly code: ScopeErrorCode) {
    super(code);
    this.name = "GuestAiScopeError";
  }
}

export interface TurnInput {
  surface: GuestSurface;
  conversationId: string;
  messageId: string;
  /** Dono (conta) que o canal já provou (assinatura do webhook, anúncio resolvido). Opcional; se vier, tem de conferir. */
  expectedOwnerId?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Canal gravado em `property_chat_messages.channel` por superfície (default da coluna: 'web'). */
const CHANNEL_BY_SURFACE: Record<GuestSurface, string> = {
  guide_chat: "web",
  whatsapp: "whatsapp",
  airbnb: "airbnb",
};

/** O prefixo de `guest_session_id` identifica o canal: `wa:<fone>`, `airbnb:<thread>`, o resto é o guia. */
function surfaceOfSession(sessionId: string): GuestSurface {
  if (sessionId.startsWith("wa:")) return "whatsapp";
  if (sessionId.startsWith("airbnb:")) return "airbnb";
  return "guide_chat";
}

type Row = Record<string, unknown>;

async function one(db: GuestAiDb, table: string, columns: string, id: string): Promise<Row | null> {
  const { data, error } = await db.from(table).select(columns).eq("id", id).maybeSingle();
  if (error) throw new GuestAiScopeError("lookup_failed");
  return (data as Row | null) ?? null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

export async function validateTurnScope(input: TurnInput, deps?: { db?: GuestAiDb }): Promise<ValidatedTurn> {
  if (
    !input ||
    !GUEST_SURFACES.includes(input.surface) ||
    typeof input.conversationId !== "string" ||
    !UUID_RE.test(input.conversationId) ||
    typeof input.messageId !== "string" ||
    !UUID_RE.test(input.messageId) ||
    (input.expectedOwnerId != null && (typeof input.expectedOwnerId !== "string" || !UUID_RE.test(input.expectedOwnerId)))
  ) {
    throw new GuestAiScopeError("invalid_input");
  }
  const db = deps?.db ?? (await getGuestAiDb());

  const conv = await one(db, "property_chat_conversations", cols(CONVERSATION_COLUMNS), input.conversationId);
  if (!conv) throw new GuestAiScopeError("conversation_not_found");

  const msg = await one(db, "property_chat_messages", cols(MESSAGE_COLUMNS), input.messageId);
  if (!msg) throw new GuestAiScopeError("message_not_found");
  if (msg["conversation_id"] !== conv["id"]) throw new GuestAiScopeError("message_conversation_mismatch");
  // Só a mensagem do HÓSPEDE dispara um turno: resposta da equipe/IA e nota interna nunca.
  if (msg["sender_type"] !== "guest" || msg["role"] !== "user" || msg["is_internal_note"] === true) {
    throw new GuestAiScopeError("message_not_from_guest");
  }

  const sessionId = str(conv["guest_session_id"]);
  if (!sessionId) throw new GuestAiScopeError("surface_mismatch");
  if (surfaceOfSession(sessionId) !== input.surface) throw new GuestAiScopeError("surface_mismatch");
  if (msg["channel"] !== CHANNEL_BY_SURFACE[input.surface]) throw new GuestAiScopeError("surface_mismatch");

  const propertyId = str(conv["property_id"]);
  if (!propertyId) throw new GuestAiScopeError("property_unresolved");
  const prop = await one(db, "properties", cols(PROPERTY_SCOPE_COLUMNS), propertyId);
  const tenantId = prop ? str(prop["owner_id"]) : null;
  if (!prop || !tenantId) throw new GuestAiScopeError("property_unresolved");
  if (input.expectedOwnerId != null && input.expectedOwnerId !== tenantId) {
    throw new GuestAiScopeError("tenant_mismatch");
  }

  return issue("turn", {
    surface: input.surface,
    conversationId: input.conversationId,
    messageId: input.messageId,
    propertyId,
    tenantId,
    guestSessionId: sessionId,
    conversationStatus: str(conv["status"]),
    reservationId: str(conv["reservation_id"]),
    messageCreatedAt: str(msg["created_at"]),
  } satisfies ValidatedTurn);
}
