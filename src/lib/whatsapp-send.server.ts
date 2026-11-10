/**
 * Envio pelo WhatsApp — EM STANDBY desde 10/11/2026 (ver `whatsapp-standby.ts`). A integração Sinch foi removida;
 * o envio devolve um resultado controlado, sem lançar e sem gravar nada, até a Cloud API oficial da Meta entrar.
 * Fora de `whatsapp.functions.ts` porque aquele arquivo também vai ao cliente.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { WHATSAPP_STANDBY_RESULT, type WhatsappStandbyResult } from "@/lib/whatsapp-standby";

export type WhatsappSendResult = WhatsappStandbyResult;

export async function sendWhatsappMessageToConversation(
  _supabase: SupabaseClient<Database>,
  _userId: string,
  _data: { conversationId: string; text: string },
): Promise<WhatsappSendResult> {
  return WHATSAPP_STANDBY_RESULT;
}
