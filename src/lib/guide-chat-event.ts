/**
 * Evento global `open-guide-chat` do Guia Digital (contrato tipado; Pilar 4, 06/11/2026).
 *
 * Quem abre o chat a partir de um item da PÁGINA PRINCIPAL do guia (evento "O que rola na cidade") passa o
 * contexto do item: id, nome, tipo e categoria. Só `kind` + `id` vão ao servidor, que confere o item nos dados
 * reais do imóvel antes de gravar (`guide-context.server.ts`); nome/tipo/categoria aqui servem só à tela.
 * O Explorar NÃO abre o chat (auditoria do PR #10, 07/11/2026): tocar no card continua abrindo o Google Maps.
 */
export const GUIDE_CHAT_OPEN_EVENT = "open-guide-chat";

export type GuideChatItemContext = {
  kind: "city_event";
  /** `cityNewsItemId(item)`. */
  id: string;
  name: string;
  type: string | null;
  category: string | null;
};

export type GuideChatOpenDetail = {
  prompt?: string;
  source?: string;
  context?: GuideChatItemContext;
};

export function openGuideChat(detail: GuideChatOpenDetail = {}): void {
  window.dispatchEvent(new CustomEvent<GuideChatOpenDetail>(GUIDE_CHAT_OPEN_EVENT, { detail }));
}
