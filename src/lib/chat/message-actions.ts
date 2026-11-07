/**
 * AÇÕES DE MENSAGEM POR CANAL DE DESTINO (diretiva de 07/11/2026).
 *
 * As opções do menu da mensagem no Atendimento (`ConversationView`) e as guardas do servidor
 * (`editHandoffMessage` / `deleteHandoffMessage`) seguem as capacidades REAIS do canal de destino,
 * para a interface nunca oferecer uma ação que não chega ao hóspede:
 *  - Airbnb: só "Copiar" (a plataforma não permite apagar nem editar depois do envio);
 *  - WhatsApp: "Copiar" e "Apagar" (sem "Editar");
 *  - Guia Digital: "Copiar", "Editar" e "Apagar";
 *  - Nota interna (nunca sai do painel): "Copiar", "Editar" e "Apagar", em qualquer canal;
 *  - Mensagem do hóspede: só "Copiar", em qualquer canal.
 * Qualquer atendente com permissão de responder pode editar/apagar mensagens da equipe ou da IA
 * (não só quem enviou). Fonte única: cliente e servidor usam esta mesma função.
 */
export type MessageDestination = "airbnb" | "whatsapp" | "guide";

/** Canal de destino: o da mensagem; sem ele, o prefixo da sessão da conversa (`airbnb:`, `wa:`). */
export function messageDestination(
  channel: string | null | undefined,
  sessionId?: string | null,
): MessageDestination {
  const c = (channel ?? "").trim().toLowerCase();
  if (c === "airbnb") return "airbnb";
  if (c === "whatsapp") return "whatsapp";
  if (c) return "guide";
  const s = String(sessionId ?? "");
  if (s.startsWith("airbnb:")) return "airbnb";
  if (s.startsWith("wa:") || s.startsWith("whatsapp")) return "whatsapp";
  return "guide";
}

export interface MessageActionInput {
  channel: string | null | undefined;
  sessionId?: string | null;
  isNote: boolean;
  isGuest: boolean;
}

export interface MessageActions {
  copy: true;
  edit: boolean;
  delete: boolean;
  destination: MessageDestination;
}

export function messageActions(m: MessageActionInput): MessageActions {
  const destination = messageDestination(m.channel, m.sessionId);
  if (m.isNote) return { copy: true, edit: true, delete: true, destination };
  if (m.isGuest) return { copy: true, edit: false, delete: false, destination };
  if (destination === "airbnb") return { copy: true, edit: false, delete: false, destination };
  if (destination === "whatsapp") return { copy: true, edit: false, delete: true, destination };
  return { copy: true, edit: true, delete: true, destination };
}

export const AIRBNB_IMMUTABLE_ERROR =
  "Mensagens enviadas ao Airbnb não podem ser excluídas ou editadas.";
export const WHATSAPP_NO_EDIT_ERROR = "Mensagens enviadas pelo WhatsApp não podem ser editadas.";
