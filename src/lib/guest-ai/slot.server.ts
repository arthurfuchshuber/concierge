/**
 * PONTO DE EXTENSÃO DA IA DE ATENDIMENTO AO HÓSPEDE (01/11/2026).
 *
 * A implementação antiga de IA foi removida por completo. Os canais de entrada
 * (chat do guia, WhatsApp/Sinch, Airbnb/Channex) continuam funcionando e
 * chamam este ponto único quando a IA está LIGADA para a conversa (chave do
 * anúncio, pausa humana expirada etc.).
 *
 * Enquanto não existe uma nova implementação, `requestGuestAiReply` devolve
 * `null`, e cada canal segue o caminho de FALLBACK já existente: a mensagem é
 * persistida, a conversa vai para a fila humana (`needs_human`) e a equipe é
 * avisada por push. Nenhum hóspede fica sem atendimento.
 *
 * A nova arquitetura (LLM-first) deve ser plugada aqui, sem reaproveitar a
 * arquitetura antiga. Este arquivo NÃO contém prompts, modelos, memória ou
 * qualquer lógica de IA.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type GuestAiSurface = "guide_chat" | "whatsapp" | "airbnb";

export type GuestAiRequest = {
  supabase: SupabaseClient;
  surface: GuestAiSurface;
  propertyId: string;
  ownerId: string | null;
  conversationId: string;
  guestName: string | null;
  message: string;
  /** Código da reserva ligada à conversa, quando conhecido. */
  reservationCode?: string | null;
};

export type GuestAiReply = {
  /** Texto a enviar ao hóspede (vazio = nada a dizer). */
  reply: string;
  /** Pedir que a equipe assuma a conversa. */
  handoff: boolean;
  handoffReason?: string | null;
  handoffUrgency?: string | null;
};

/** Motivo padrão registrado na conversa quando não há IA instalada. */
export const NO_AI_HANDOFF_REASON = "Atendimento automático indisponível — responder ao hóspede.";

/**
 * Devolve `null` enquanto nenhuma implementação de IA estiver instalada.
 * Os canais tratam `null` como "encaminhar à equipe".
 */
export async function requestGuestAiReply(_req: GuestAiRequest): Promise<GuestAiReply | null> {
  return null;
}
