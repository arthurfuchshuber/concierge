/**
 * Execução real das ações proativas de baixa autonomia (FASE — envio real).
 *
 * `engine.server.ts` já grava, em `ai_proactive_actions`, ações de autonomia
 * "low" já como `status: "approved"` (aprovação automática — é a própria
 * regra que decide que dispensa humano, ver `approvalFor` em `./rules`).
 * `markActionExecuted` já existia para marcar uma ação como executada, mas
 * nada nunca chamava nem essa função nem disparava a mensagem em si — as
 * ações ficavam para sempre "aprovadas" e nunca chegavam ao hóspede. Este
 * módulo fecha esse último passo, só para as regras que são, de fato,
 * mensagens ao hóspede (não para "reservation_briefing"/"returning_guest_
 * recognition", que são anotações internas, não texto a enviar).
 *
 * Canal: reaproveita o WhatsApp já conectado pelo anfitrião
 * (`sendWhatsappText`, mesma credencial usada no atendimento humano/IA).
 * Sem WhatsApp conectado, ou sem telefone do hóspede localizado, a ação é
 * marcada como falha com o motivo — nunca fica reprocessando para sempre,
 * mas também nunca finge ter enviado algo que não foi.
 *
 * Telefone do hóspede: reservas sincronizadas do Airbnb (`property_reservations`,
 * fonte do gatilho checkin/checkout) não trazem telefone — o iCal do Airbnb
 * não expõe isso. O telefone só existe quando o hóspede preencheu o
 * formulário de chegada no próprio guia (`guide_access_logs`). Por isso
 * cruzamos pela MESMA janela de datas (check-in/check-out) do mesmo imóvel —
 * como um imóvel só tem uma estadia ativa por vez, esse cruzamento é seguro.
 * Sem log correspondente com telefone, não há para quem enviar.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { markActionExecuted } from "./engine.server";

/** Só regras cuja ação recomendada é, de fato, uma mensagem ao hóspede. */
const GUEST_MESSAGE_RULES = new Set(["welcome_pre_checkin", "checkout_instructions", "silent_guest_checkin"]);

function siteOrigin(): string {
  return (
    process.env.SITE_URL ||
    process.env.VITE_APP_URL ||
    "https://project--c6a061b9-4ae8-4241-9a99-3375bda32242.lovable.app"
  );
}

type ActionRow = {
  id: string;
  tenant_id: string;
  property_id: string;
  reservation_id: string | null;
  guest_name: string | null;
  rule_key: string;
};

async function resolveGuestPhone(
  supabase: SupabaseClient,
  propertyId: string,
  reservationId: string | null,
): Promise<string | null> {
  if (!reservationId) return null;
  const { data: res } = await supabase
    .from("property_reservations")
    .select("checkin_date, checkout_date")
    .eq("id", reservationId)
    .maybeSingle();
  if (!res?.checkin_date) return null;
  const { data: logs } = await supabase
    .from("guide_access_logs")
    .select("guest_phone, guest_phone_country")
    .eq("property_id", propertyId)
    .eq("checkin_date", res.checkin_date)
    .eq("checkout_date", res.checkout_date ?? res.checkin_date)
    .not("guest_phone", "is", null)
    .limit(2);
  // Ambíguo (mais de um hóspede com a mesma janela) ou nenhum → não envia.
  if (!logs || logs.length !== 1) return null;
  const phone = String(logs[0].guest_phone ?? "").trim();
  return phone.length > 0 ? phone : null;
}

function messageFor(
  ruleKey: string,
  guestName: string | null,
  property: { name: string; slug: string; checkin_time: string | null; checkout_time: string | null },
): string | null {
  const who = guestName ? guestName.split(" ")[0] : null;
  const greeting = who ? `Olá, ${who}!` : "Olá!";
  const guideUrl = `${siteOrigin()}/g/${property.slug}`;
  switch (ruleKey) {
    case "welcome_pre_checkin":
      return (
        `${greeting} Seu check-in em ${property.name} está chegando` +
        (property.checkin_time ? ` (a partir das ${property.checkin_time})` : "") +
        `. Preparamos um guia com todas as instruções de chegada e acesso: ${guideUrl}\n` +
        `Qualquer dúvida, é só responder por aqui.`
      );
    case "checkout_instructions":
      return (
        `${greeting} Só um lembrete: o check-out em ${property.name} é` +
        (property.checkout_time ? ` até as ${property.checkout_time}` : " hoje") +
        `. As instruções de saída estão no guia: ${guideUrl}\n` +
        `Precisando de algo antes de ir, é só chamar.`
      );
    case "silent_guest_checkin":
      return `${greeting} Passando para saber se está tudo certo na sua estadia em ${property.name}. Qualquer coisa, estou por aqui.`;
    default:
      return null;
  }
}

export type SendProactiveResult = {
  processed: number;
  sent: number;
  skipped: number;
  failed: number;
};

/** Processa o lote de ações de baixa autonomia já aprovadas e ainda não executadas. */
export async function sendApprovedProactiveActions(params: {
  supabase: SupabaseClient;
  limit?: number;
}): Promise<SendProactiveResult> {
  const { supabase } = params;
  const result: SendProactiveResult = { processed: 0, sent: 0, skipped: 0, failed: 0 };

  const { data: actions, error } = await supabase
    .from("ai_proactive_actions")
    .select("id, tenant_id, property_id, reservation_id, guest_name, rule_key")
    .eq("status", "approved")
    .eq("autonomy_level", "low")
    .in("rule_key", Array.from(GUEST_MESSAGE_RULES))
    .order("created_at", { ascending: true })
    .limit(params.limit ?? 100);
  if (error) throw new Error(error.message);

  for (const action of (actions ?? []) as ActionRow[]) {
    result.processed += 1;
    try {
      const { data: property } = await supabase
        .from("properties")
        .select("name, slug, published, checkin_time, checkout_time")
        .eq("id", action.property_id)
        .maybeSingle();
      if (!property?.published) {
        result.skipped += 1;
        await markActionExecuted({
          supabase,
          tenantId: action.tenant_id,
          actionId: action.id,
          executedAction: "",
          error: "Guia não está publicado — sem link válido para enviar ao hóspede.",
        });
        continue;
      }

      const phone = await resolveGuestPhone(supabase, action.property_id, action.reservation_id);
      if (!phone) {
        result.skipped += 1;
        await markActionExecuted({
          supabase,
          tenantId: action.tenant_id,
          actionId: action.id,
          executedAction: "",
          error: "Telefone do hóspede não localizado (reserva sem check-in preenchido no guia).",
        });
        continue;
      }

      const text = messageFor(action.rule_key, action.guest_name, property as {
        name: string;
        slug: string;
        checkin_time: string | null;
        checkout_time: string | null;
      });
      if (!text) {
        result.skipped += 1;
        continue;
      }

      const { sendWhatsappText } = await import("@/lib/ai/channels/whatsapp/provider.server");
      await sendWhatsappText({ supabase, tenantId: action.tenant_id, toPhone: phone, text });
      await markActionExecuted({ supabase, tenantId: action.tenant_id, actionId: action.id, executedAction: text });
      result.sent += 1;
    } catch (e) {
      result.failed += 1;
      const message = e instanceof Error ? e.message : String(e);
      await markActionExecuted({
        supabase,
        tenantId: action.tenant_id,
        actionId: action.id,
        executedAction: "",
        error: message,
      }).catch(() => {});
      console.error(`[proactive-sender] falhou para ação ${action.id}`, e);
    }
  }

  return result;
}
