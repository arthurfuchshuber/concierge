/**
 * Channel Gateway — contratos.
 *
 * O Agent Core NUNCA sabe de onde veio a mensagem. Todo canal converte sua
 * carga própria em `InboundMessage` e recebe de volta `OutboundMessage`.
 */

export type ChannelType =
  | "guide_chat"
  | "whatsapp"
  | "airbnb"
  | "booking"
  | "email"
  | "app"
  | "api"
  | "proactive"
  | "evaluation";

export const CHANNEL_TYPES: ChannelType[] = [
  "guide_chat",
  "whatsapp",
  "airbnb",
  "booking",
  "email",
  "app",
  "api",
  "proactive",
  "evaluation",
];

/** Mensagem normalizada — formato único consumido pelo orquestrador. */
export type InboundMessage = {
  channel: ChannelType;
  /** Identificador da conversa no sistema externo (telefone, thread, e-mail). */
  externalReference: string | null;
  externalThreadId: string | null;
  propertyId: string;
  conversationId: string | null;
  sessionId: string;
  guestName: string | null;
  text: string;
  locale: string | null;
  attachments: Array<{ url: string; kind: string; name?: string }>;
  receivedAt: string;
  metadata: Record<string, unknown>;
};

export type OutboundMessage = {
  channel: ChannelType;
  conversationId: string;
  externalReference: string | null;
  text: string;
  handoff: boolean;
  metadata: Record<string, unknown>;
};

/** Adaptador de canal: só ele conhece o formato do provedor. */
export type ChannelAdapter<TRaw = unknown> = {
  type: ChannelType;
  /** Converte a carga bruta do provedor em mensagem normalizada. */
  parse: (raw: TRaw) => InboundMessage | null;
  /** Entrega a resposta de volta ao canal (opcional em canais só de leitura). */
  deliver?: (message: OutboundMessage) => Promise<void>;
};
