/**
 * PONTO DE EXTENSÃO DA IA DE ATENDIMENTO AO HÓSPEDE.
 *
 * Os canais de entrada (chat do guia, WhatsApp/Sinch, Airbnb/Channex) chamam este
 * ponto único quando a IA está LIGADA para a conversa (chave do anúncio, pausa
 * humana expirada etc.).
 *
 * F0 (fronteira de dados): o slot NÃO recebe mais nenhum cliente de banco. Ele
 * recebe só identificadores — superfície, conversa e mensagem (+ o dono esperado,
 * quando o canal já o provou) — e tudo o mais (imóvel, conta, reserva, hóspede) é
 * RE-DERIVADO e validado no backend por `guest-ai/data/scope.server.ts`. Nenhum
 * identificador vindo do cliente é aceito sem essa validação.
 *
 * F0/F1 NÃO ligam nada: sem LLM, sem resposta automática. `requestGuestAiReply`
 * continua devolvendo `null` e cada canal segue o FALLBACK existente (conversa vai
 * para `needs_human` + push à equipe). O Context Engine (`context/builder.server.ts`)
 * e o Policy Engine (`policy/`) já existem e são testados, mas ainda NÃO são
 * chamados daqui: isso será decidido na fase seguinte, para não somar consultas ao
 * caminho de cada mensagem sem que haja um consumidor.
 */
import type { GuestSurface } from "@/lib/guest-ai/types";

export type GuestAiSurface = GuestSurface;

export type GuestAiRequest = {
  surface: GuestAiSurface;
  conversationId: string;
  /** Mensagem do HÓSPEDE que disparou o turno (já gravada pelo canal). */
  messageId: string;
  /** Dono (conta) que o canal já provou; se vier, o backend confere com o dono real do imóvel. */
  expectedOwnerId?: string | null;
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
