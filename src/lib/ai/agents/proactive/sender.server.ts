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
 * CANAL (revisto em 11/09/2026 — "a IA vai conseguir também chamar o hóspede
 * em outro horário?"): a entrega passa a tentar PRIMEIRO o chat do guia, que
 * é o canal que está de pé hoje — a mensagem entra na conversa como fala da
 * IA e o celular do hóspede toca pelo push. O WhatsApp continua como segunda
 * via, para quando não existir conversa no guia e o anfitrião tiver o número
 * conectado (`host_whatsapp_config` está vazio hoje, e era por isso que
 * `ai_proactive_actions` nunca saía do "aprovado").
 *
 * E o texto não é mais um molde: quem escreve é o próprio agente, olhando a
 * conversa e a base de conhecimento do imóvel — é a mesma voz que o hóspede
 * já conhece. O molde fica só como rede de segurança se o agente falhar.
 *
 * Silêncio noturno e "não falar duas vezes seguidas" vivem em
 * `speak.server.ts` e valem aqui também: quando a trava barra o envio, a ação
 * NÃO é marcada como executada — ela volta na próxima varredura (de hora em
 * hora), já dentro do horário civilizado.
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
import { guideUrl } from "@/lib/site-url";

/** Só regras cuja ação recomendada é, de fato, uma mensagem ao hóspede. */
const GUEST_MESSAGE_RULES = new Set([
  "welcome_pre_checkin",
  "checkout_instructions",
  "silent_guest_checkin",
]);

type ActionRow = {
  id: string;
  tenant_id: string;
  property_id: string;
  reservation_id: string | null;
  conversation_id: string | null;
  guest_name: string | null;
  rule_key: string;
};

/**
 * Qual conversa do guia é a desta reserva?
 *
 * A conversa do hóspede nasce da sessão dele no guia e não carrega o id da
 * reserva — o vínculo possível é o TEMPO: a conversa daquele imóvel aberta na
 * janela da estadia. É seguro porque um imóvel só tem uma estadia por vez.
 * Se houver mais de uma candidata e o nome não desempatar, não envia: falar
 * com o hóspede errado é pior do que não falar.
 */
async function resolveConversationId(
  supabase: SupabaseClient,
  action: ActionRow,
): Promise<string | null> {
  if (action.conversation_id) return action.conversation_id;
  if (!action.reservation_id) return null;

  const { data: res } = await supabase
    .from("property_reservations")
    .select("checkin_date, checkout_date")
    .eq("id", action.reservation_id)
    .maybeSingle();
  const r = res as { checkin_date: string | null; checkout_date: string | null } | null;
  if (!r?.checkin_date) return null;

  const DIA = 24 * 60 * 60 * 1000;
  const inicio = new Date(
    new Date(`${r.checkin_date}T00:00:00Z`).getTime() - 7 * DIA,
  ).toISOString();
  const fim = new Date(
    new Date(`${r.checkout_date ?? r.checkin_date}T00:00:00Z`).getTime() + 2 * DIA,
  ).toISOString();

  const { data: convs } = await supabase
    .from("property_chat_conversations")
    .select("id, guest_name, created_at")
    .eq("property_id", action.property_id)
    .gte("created_at", inicio)
    .lte("created_at", fim)
    .order("created_at", { ascending: false })
    .limit(5);

  const lista = (convs ?? []) as Array<{ id: string; guest_name: string | null }>;
  if (lista.length === 1) return lista[0].id;
  if (lista.length === 0) return null;

  const primeiro = (action.guest_name ?? "").trim().split(" ")[0]?.toLowerCase();
  if (!primeiro) return null;
  const porNome = lista.filter((c) => (c.guest_name ?? "").toLowerCase().includes(primeiro));
  return porNome.length === 1 ? porNome[0].id : null;
}

/** O que a IA deve fazer — em instrução interna, não em texto pronto. */
function instructionFor(ruleKey: string, guestName: string | null): string | null {
  const quem = guestName ? guestName.split(" ")[0] : null;
  const alvo = quem ? `O hóspede se chama ${quem}. ` : "";
  switch (ruleKey) {
    case "welcome_pre_checkin":
      return (
        `${alvo}Esta é uma mensagem de BOAS-VINDAS que você está iniciando — o hóspede não escreveu nada. ` +
        "O check-in dele está chegando. Dê as boas-vindas em duas ou três frases, diga o horário de check-in e " +
        "como será o acesso, e ofereça ajuda. Use SÓ o que está na base de conhecimento do imóvel; " +
        "se algum dado não existir, simplesmente não mencione aquele ponto."
      );
    case "checkout_instructions":
      return (
        `${alvo}Esta é uma mensagem que você está iniciando — o hóspede não escreveu nada. ` +
        "O check-out está próximo. Lembre o horário de saída e o que ele precisa fazer antes de ir " +
        "(chaves, lixo, o que estiver nas instruções de saída do imóvel), em duas ou três frases, " +
        "com gentileza e sem parecer cobrança. Só o que está na base de conhecimento."
      );
    case "silent_guest_checkin":
      return (
        `${alvo}Esta é uma mensagem que você está iniciando — o hóspede está hospedado e não falou nada até agora. ` +
        "Em uma ou duas frases, pergunte se está tudo certo na estadia e coloque-se à disposição. " +
        "Nada de instruções longas nem de perguntas em série."
      );
    default:
      return null;
  }
}

const PUSH_TITLE: Record<string, string> = {
  welcome_pre_checkin: "Sua chegada está próxima",
  checkout_instructions: "Sobre a sua saída",
  silent_guest_checkin: "Tudo certo por aí?",
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
  property: {
    name: string;
    slug: string;
    checkin_time: string | null;
    checkout_time: string | null;
  },
): string | null {
  const who = guestName ? guestName.split(" ")[0] : null;
  const greeting = who ? `Olá, ${who}!` : "Olá!";
  const linkDoGuia = guideUrl(property.slug);
  switch (ruleKey) {
    case "welcome_pre_checkin":
      return (
        `${greeting} Seu check-in em ${property.name} está chegando` +
        (property.checkin_time ? ` (a partir das ${property.checkin_time})` : "") +
        `. Preparamos um guia com todas as instruções de chegada e acesso: ${linkDoGuia}\n` +
        `Qualquer dúvida, é só responder por aqui.`
      );
    case "checkout_instructions":
      return (
        `${greeting} Só um lembrete: o check-out em ${property.name} é` +
        (property.checkout_time ? ` até as ${property.checkout_time}` : " hoje") +
        `. As instruções de saída estão no guia: ${linkDoGuia}\n` +
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
  /** Quantas ficaram para a próxima varredura (madrugada, conversa recente). */
  adiadas: number;
  porCanal: { guia: number; whatsapp: number };
};

/** Processa o lote de ações de baixa autonomia já aprovadas e ainda não executadas. */
export async function sendApprovedProactiveActions(params: {
  supabase: SupabaseClient;
  limit?: number;
}): Promise<SendProactiveResult> {
  const { supabase } = params;
  const result: SendProactiveResult = {
    processed: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    adiadas: 0,
    porCanal: { guia: 0, whatsapp: 0 },
  };

  const { data: actions, error } = await supabase
    .from("ai_proactive_actions")
    .select("id, tenant_id, property_id, reservation_id, conversation_id, guest_name, rule_key")
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

      const molde = messageFor(
        action.rule_key,
        action.guest_name,
        property as {
          name: string;
          slug: string;
          checkin_time: string | null;
          checkout_time: string | null;
        },
      );
      if (!molde) {
        result.skipped += 1;
        continue;
      }

      /* 1ª via — o chat do guia. É onde a conversa já acontece: a mensagem
       * entra como fala da IA e o push toca o celular do hóspede. */
      const conversationId = await resolveConversationId(supabase, action);
      if (conversationId) {
        const { speakWithAgent, speakToGuest } = await import("@/lib/ai/outbound/speak.server");
        const instruction = instructionFor(action.rule_key, action.guest_name);
        const pushTitle = PUSH_TITLE[action.rule_key] ?? "Mensagem do anfitrião";

        let fala: { sent: boolean; skipped?: string; text?: string } = instruction
          ? await speakWithAgent({
              supabase,
              conversationId,
              instruction,
              reason: "proactive",
              pushTitle,
            })
          : { sent: false, skipped: "empty" };

        // O agente falhou (chave fora do ar, resposta vazia): o molde entra
        // como rede de segurança — é pouco, mas é correto e chega.
        if (!fala.sent && fala.skipped === "empty") {
          fala = await speakToGuest({
            supabase,
            conversationId,
            text: molde,
            reason: "proactive",
            pushTitle,
          });
        }

        if (fala.sent) {
          await markActionExecuted({
            supabase,
            tenantId: action.tenant_id,
            actionId: action.id,
            executedAction: fala.text ?? molde,
          });
          result.sent += 1;
          result.porCanal.guia += 1;
          continue;
        }

        // Madrugada, humano no comando ou conversa aquecida agora: NÃO marca
        // nada — volta na varredura da hora seguinte, ainda dentro da janela.
        if (
          fala.skipped === "quiet_hours" ||
          fala.skipped === "double_message" ||
          fala.skipped === "ai_paused"
        ) {
          result.adiadas += 1;
          continue;
        }
      }

      /* 2ª via — WhatsApp, quando o anfitrião tem número conectado. */
      const phone = await resolveGuestPhone(supabase, action.property_id, action.reservation_id);
      if (!phone) {
        result.skipped += 1;
        await markActionExecuted({
          supabase,
          tenantId: action.tenant_id,
          actionId: action.id,
          executedAction: "",
          error: conversationId
            ? "Conversa do guia não aceitou a mensagem e não há telefone do hóspede para a segunda via."
            : "Sem conversa no guia para este hóspede e sem telefone (reserva sem check-in preenchido no guia).",
        });
        continue;
      }

      const { sendWhatsappText } = await import("@/lib/ai/channels/whatsapp/provider.server");
      await sendWhatsappText({ supabase, tenantId: action.tenant_id, toPhone: phone, text: molde });
      await markActionExecuted({
        supabase,
        tenantId: action.tenant_id,
        actionId: action.id,
        executedAction: molde,
      });
      result.sent += 1;
      result.porCanal.whatsapp += 1;
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
