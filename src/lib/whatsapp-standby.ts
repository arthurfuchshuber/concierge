/**
 * WHATSAPP EM STANDBY (10/11/2026, decisão do titular): a integração de terceiros (Sinch) foi removida e o canal
 * volta só pela Cloud API oficial da Meta, em etapa futura. Até lá, todo envio devolve este resultado controlado
 * (nunca lança, nunca falha em silêncio) e a tela mostra o aviso abaixo. Tabelas de chat (canal `whatsapp`) e o
 * mapeamento de sessões ficam intactos.
 */
export const WHATSAPP_STANDBY_REASON = "whatsapp_channel_standby_for_meta" as const;
export const WHATSAPP_STANDBY_MESSAGE = "Canal WhatsApp em Standby (Migração para API Oficial Cloud da Meta)";

export interface WhatsappStandbyResult {
  ok: false;
  reason: typeof WHATSAPP_STANDBY_REASON;
}

export const WHATSAPP_STANDBY_RESULT: WhatsappStandbyResult = Object.freeze({ ok: false, reason: WHATSAPP_STANDBY_REASON });
