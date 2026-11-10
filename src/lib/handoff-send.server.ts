/**
 * NÚCLEO ÚNICO de envio humano (chat do guia e Airbnb) — o corpo de `sendHandoffMessage`, só servidor.
 * Fica fora de `handoff.functions.ts` porque aquele arquivo também é importado pelo cliente (stubs das server
 * functions): uma função exportada lá carregaria `client.server`/`channex-messages.server` para o bundle do
 * navegador. `sendHandoffMessage` o carrega por import dinâmico.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { pausePatch } from "@/lib/chat/pause";
import { requireChatRespondForConversation } from "@/lib/handoff.functions";

export interface HumanSendInput {
  conversationId: string;
  content: string;
  internalNote: boolean;
}

export interface HumanSendOptions {
  /** Copiloto (05/11/2026): remetente estrito no Airbnb (sem fallback silencioso de conta). */
  strictSender?: { expectedChannelId: string };
}

export interface HumanSendResult {
  ok: true;
  /** Id da linha gravada no Airbnb (a entrega já o lê); no chat do guia é nulo (gravação original, sem leitura). */
  messageId: string | null;
  channel: "web" | "airbnb";
  /** Id da mensagem no provedor (Airbnb/Channex), quando houver. */
  externalId: string | null;
}

/**
 * ROTINA ÚNICA de envio humano (chat do guia e Airbnb). É o corpo de `sendHandoffMessage`, extraído para que
 * (historicamente) o envio da sugestão do Copiloto usasse a mesma rotina — permissão, bloqueio por
 * responsável, expansão de tags, entrega, pausa da IA e push — sem nenhum mecanismo paralelo de envio.
 * Autoria: `userId` vem SEMPRE da sessão autenticada do chamador.
 */
export async function sendHumanMessageToConversation(
  supabase: SupabaseClient,
  userId: string,
  data: HumanSendInput,
  opts: HumanSendOptions = {},
): Promise<HumanSendResult> {
  // Antes: até 3 consultas separadas buscavam a MESMA conversa+imóvel em
  // momentos diferentes (permissão, checagem de assigned_to, expansão de
  // tags) — cada uma é uma ida e volta de rede ao banco, em série. Isso
  // sozinho já explicava vários segundos de demora sentidos ao enviar.
  // Agora é uma consulta só, com todos os campos que qualquer uma das
  // etapas abaixo precisa.
  const { data: cur } = await supabase
    .from("property_chat_conversations")
    .select(
      "assigned_to, handoff_reason, property_id, guest_session_id, properties:property_id(owner_id, name, slug, checkin_time, checkin_time_max, checkout_time, checkout_time_min, wifi_ssid, wifi_password, gate_code, lock_code, pin_code, address, host_name, host_phone, house_rules, checkin_instructions, checkout_instructions, gate_instructions, lock_instructions, marketplace_links)",
    )
    .eq("id", data.conversationId)
    .maybeSingle();
  const joinedProperties = cur?.properties as
    Record<string, unknown> | Record<string, unknown>[] | null;
  const propRow = Array.isArray(joinedProperties)
    ? (joinedProperties[0] ?? null)
    : joinedProperties;
  const ownerId = (propRow?.owner_id as string | undefined) ?? null;

  await requireChatRespondForConversation(supabase, userId, data.conversationId, ownerId);

  if (cur?.assigned_to && cur.assigned_to !== userId) {
    throw new Error(
      "Esta conversa está sendo atendida por outro membro. Solicite acesso ou peça uma transferência.",
    );
  }

  // Expande [[info:...]] com valores da propriedade e [[tag:...]] em links do guia.
  let content = data.content;
  try {
    const slug = (propRow?.slug as string | undefined) ?? null;
    const { expandInfoTags, expandTagsAsMarkdown } = await import("@/lib/guide-tags");
    content = expandInfoTags(content, propRow as never, { markdownLinks: true });
    if (slug) content = expandTagsAsMarkdown(content, { slug });
  } catch {
    // Se algo falhar, envia o texto original.
  }
  const session = String(
    (cur as { guest_session_id?: string | null } | null)?.guest_session_id ?? "",
  );
  let sentMessageId: string | null = null;
  let sentExternalId: string | null = null;
  let sentChannel: "web" | "airbnb" = "web";
  if (!data.internalNote && session.startsWith("airbnb:")) {
    // Hóspede do Airbnb: a resposta sai pela Channex para o chat dele.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { deliverToAirbnbThread, purgePendingChatForThread } =
      await import("@/lib/channex-messages.server");
    await purgePendingChatForThread(supabaseAdmin, session.slice("airbnb:".length));
    const r = await deliverToAirbnbThread(supabaseAdmin, {
      conversationId: data.conversationId,
      threadId: session.slice("airbnb:".length),
      propertyId: String(cur?.property_id ?? ""),
      text: content,
      senderType: "human",
      senderUserId: userId,
      strictSender: opts.strictSender,
    });
    if (!r.ok) {
      if (r.failure === "preferred_sender_failed" || r.failure === "sender_mismatch") {
        throw new Error(
          "A conta remetente configurada para este anúncio não pôde enviar. Nada foi enviado por outra conta.",
        );
      }
      throw new Error("O Airbnb recusou a mensagem. A equipe foi avisada.");
    }
    sentMessageId = r.messageId ?? null;
    sentExternalId = r.externalId;
    sentChannel = "airbnb";
  } else {
    // gravação idêntica à original (sem ler a linha de volta); o Copiloto reconcilia o id pelo autor e instante
    const { error } = await supabase.from("property_chat_messages").insert({
      conversation_id: data.conversationId,
      role: "assistant",
      content,
      sender_type: "human",
      sender_user_id: userId,
      is_internal_note: data.internalNote,
    });
    if (error) throw new Error(error.message);
  }
  // Ensure conversation status stays assigned + ai paused when agent replies
  if (!data.internalNote) {
    await supabase
      .from("property_chat_conversations")
      .update({
        // FALAR DIRETO é o que silencia a IA — e agora com prazo: 10 minutos,
        // renovados a cada nova mensagem do atendente. Ver `lib/chat/pause.ts`.
        ...pausePatch(),
        status: "assigned",
        assigned_to: userId,
        last_message_at: new Date().toISOString(),
      })
      .eq("id", data.conversationId);

    // Dispara push para o hóspede (se ele tiver ativado notificações).
    // Fire-and-forget: isto inclui uma consulta extra e uma chamada de rede
    // externa ao serviço de push — não faz sentido nenhum o envio da
    // mensagem esperar por isso.
    void (async () => {
      try {
        const { data: conv } = await supabase
          .from("property_chat_conversations")
          .select("id, properties:property_id(name, slug, city)")
          .eq("id", data.conversationId)
          .maybeSingle();
        const p = (conv?.properties ?? null) as { name?: string; slug?: string; city?: string | null } | null;
        const propName = p?.name?.trim() || "Anfitrião";
        const slug = p?.slug ?? "";
        const { sendPushToGuest } = await import("@/lib/guest-push.server");
        const { guestPushBody } = await import("@/lib/push-format");
        // Mockup aprovado (07/11/2026): título = imóvel (o celular corta em 1
        // linha); corpo = "📍 cidade" + a mensagem em até ~2 linhas.
        const city = (p?.city ?? "").split(",")[0]?.trim() ?? "";
        await sendPushToGuest(data.conversationId, {
          title: propName,
          body: guestPushBody(city, data.content),
          data: {
            url: slug ? `/g/${slug}?chat=1` : "/",
            conversationId: data.conversationId,
            tag: `guest-reply-${data.conversationId}`,
          },
        });
      } catch (e) {
        console.error("[handoff] falha ao enviar push para o hóspede", e);
      }
    })();
  }
  return { ok: true, messageId: sentMessageId, channel: sentChannel, externalId: sentExternalId };
}
