/**
 * Baixa automática quando um ATENDENTE HUMANO envia a despedida padrão de
 * entrada/saída (ex.: "Maravilha! ... Excelente estadia!"). Sem isso, só as
 * falas da IA davam baixa e o card ficava pendente. Reaproveita
 * `findStayForEvent`/`applyStayEvent` (idempotente, respeita no-show/futuro).
 */
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export function detectHumanClosing(text: string): "checkin" | "checkout" | null {
  const t = norm(text);
  if (/(boa\s+viagem|obrigad[oa]\s+pela\s+estadia|agradecemos\s+(a|pela)\s+(sua\s+)?(estadia|hospedagem)|volte\s+sempre)/.test(t)
    && !/excelente\s+estadia/.test(t)) return "checkout";
  if (/excelente\s+estadia|otima\s+estadia|boa\s+estadia/.test(t)) return "checkin";
  return null;
}

export async function completeStayFromHumanMessage(conversationId: string, text: string): Promise<void> {
  try {
    const kind = detectHumanClosing(text);
    if (!kind) return;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: conv } = await supabaseAdmin
      .from("property_chat_conversations")
      .select("property_id")
      .eq("id", conversationId)
      .maybeSingle();
    const propertyId = (conv as { property_id?: string | null } | null)?.property_id;
    if (!propertyId) return;
    const { findStayForEvent, applyStayEvent } = await import("./stay-events.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabaseAdmin as any;
    const stay = await findStayForEvent(sb, { propertyId, checkinDate: null, checkoutDate: null, conversationId });
    if (stay) await applyStayEvent(sb, stay, kind);
  } catch (e) {
    console.error("[human-closing] baixa automática falhou", e);
  }
}
