import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { SITE_ORIGIN } from "@/lib/site-url";
import { WHATSAPP_STANDBY_MESSAGE, WHATSAPP_STANDBY_RESULT, type WhatsappStandbyResult } from "@/lib/whatsapp-standby";

/**
 * WhatsApp — EM STANDBY desde 10/11/2026 (decisão do titular). A integração Sinch (credenciais, webhook, envio)
 * foi removida; o canal volta só pela Cloud API oficial da Meta, em etapa futura. As telas leem o estado aqui.
 */
export type WhatsappConfigPublic = {
  provider: "meta_cloud";
  status: "standby";
  message: string;
  /** Rota neutra já reservada para os eventos da Meta (hoje só responde que o canal está em standby). */
  webhookUrl: string;
};

export const getMyWhatsappConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ ownerId: z.string().uuid().nullish() }).parse(raw ?? {}))
  .handler(async (): Promise<WhatsappConfigPublic> => ({
    provider: "meta_cloud",
    status: "standby",
    message: WHATSAPP_STANDBY_MESSAGE,
    webhookUrl: `${SITE_ORIGIN}/api/public/whatsapp/webhook`,
  }));

const SEND_INPUT = z.object({
  conversationId: z.string().uuid(),
  text: z.string().trim().min(1).max(4000),
});

/** Envio pelo WhatsApp: resultado controlado de standby (nunca lança). */
export const sendWhatsappFromConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => SEND_INPUT.parse(raw))
  .handler(async (): Promise<WhatsappStandbyResult> => WHATSAPP_STANDBY_RESULT);
