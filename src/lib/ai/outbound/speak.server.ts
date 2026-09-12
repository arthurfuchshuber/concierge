/**
 * VOZ ATIVA — a IA falando sem o hóspede ter falado.
 *
 * Pedido explícito (11/09/2026): "a IA vai conseguir também chamar o hóspede
 * em outro horário quando não for acionado pelo hóspede?". E, antes disso, o
 * pedido maior: a IA não sai da conversa — quem responde ao hóspede é sempre
 * ela, mesmo quando a informação veio de uma pessoa.
 *
 * Até aqui o sistema só sabia REAGIR: todo caminho que gerava mensagem
 * começava numa mensagem do hóspede. As consequências apareceram na auditoria
 * dos 5 dias:
 *
 *  · a resposta que o atendente deu à IA ficava guardada esperando o hóspede
 *    escrever de novo para ser entregue — e quando ele não escrevia, não era
 *    entregue nunca (Studio 103, 08/09: hóspede sem resposta até hoje);
 *  · um caso aberto ("o técnico vai entre 14h e 16h") nunca era acompanhado —
 *    ninguém voltava para saber se tinha resolvido;
 *  · o motor proativo (boas-vindas, instruções de saída, hóspede silencioso)
 *    aprovava as ações e não tinha por onde entregar: só sabia WhatsApp, e não
 *    há número conectado. `ai_proactive_actions` estava com ZERO linhas.
 *
 * Este módulo é a peça que faltava, e é UMA só para os três casos: grava a
 * mensagem na conversa como se a IA tivesse falado e toca o celular do hóspede
 * pelo push do guia. Um caminho, um lugar para auditar.
 *
 * REGRAS DE CONVIVÊNCIA (o que impede isto de virar spam):
 *  · Nunca fala por cima de gente: conversa com humano no comando
 *    (`ai_paused`) não recebe voz ativa.
 *  · Nunca fala duas vezes seguidas sem resposta: se a última mensagem da
 *    conversa já é da IA e veio de voz ativa, a próxima é bloqueada (exceto a
 *    entrega de resposta do atendente, que é informação pedida pelo hóspede).
 *  · Silêncio noturno: nada entre 22h e 8h, salvo urgência real.
 *  · Tudo fica registrado como mensagem normal da conversa — o que a IA falou
 *    sozinha aparece no mesmo lugar que o resto, para o anfitrião auditar.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** O client de serviço — mesmo tipo usado no envio proativo. */
type Admin = SupabaseClient;

export type SpeakReason =
  | "human_answer" // o atendente respondeu à IA; ela leva ao hóspede
  | "follow_up" // acompanhamento de um caso que ficou aberto
  | "proactive"; // regra de agenda (boas-vindas, saída, hóspede silencioso)

export type SpeakResult = {
  sent: boolean;
  skipped?:
    | "ai_paused"
    | "quiet_hours"
    | "double_message"
    | "no_conversation"
    | "empty"
    | "nada_a_dizer";
  messageId?: string;
  pushed?: number;
  /** O texto que foi realmente dito — para registrar em quem chamou. */
  text?: string;
};

/** 22h–8h no fuso do imóvel (Brasil). Urgência real ignora. */
function isQuietHours(now = new Date()): boolean {
  const h = Number(
    new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      hour12: false,
      timeZone: "America/Sao_Paulo",
    }).format(now),
  );
  return h >= 22 || h < 8;
}

/**
 * Entrega uma mensagem da IA numa conversa existente.
 *
 * `text` já vem pronto: quem chama decide se o texto nasce de um turno do
 * agente (com toda a base de conhecimento) ou de um molde curto. Aqui o
 * trabalho é entregar com as travas certas.
 */
export async function speakToGuest(params: {
  supabase: Admin;
  conversationId: string;
  text: string;
  reason: SpeakReason;
  /** Pula a trava de horário — só para o que não pode esperar. */
  urgent?: boolean;
  /** Título do push; o corpo é o começo da mensagem. */
  pushTitle?: string;
}): Promise<SpeakResult> {
  const text = (params.text ?? "").trim();
  if (!text) return { sent: false, skipped: "empty" };

  const { data: conv } = await params.supabase
    .from("property_chat_conversations")
    .select("id, ai_paused, paused_until, property_id")
    .eq("id", params.conversationId)
    .maybeSingle();
  if (!conv) return { sent: false, skipped: "no_conversation" };

  // Humano no comando: a IA não fala por cima. A exceção é a entrega da
  // resposta que o próprio atendente acabou de dar — ali ele PEDIU que ela
  // falasse.
  // A pausa expira sozinha: uma conversa silenciada às 14h volta a receber voz
  // ativa às 14h30, sem ninguém clicar. Ver `lib/ai/pause.ts`.
  const { resolvePause } = await import("@/lib/ai/pause");
  const humanoNoComando = await resolvePause(
    params.supabase,
    params.conversationId,
    conv as { ai_paused?: boolean | null; paused_until?: string | null },
  );
  if (humanoNoComando && params.reason !== "human_answer") {
    return { sent: false, skipped: "ai_paused" };
  }

  if (!params.urgent && params.reason !== "human_answer" && isQuietHours()) {
    return { sent: false, skipped: "quiet_hours" };
  }

  /* Não falar duas vezes seguidas — mas com janela de tempo.
   *
   * A trava existe contra insistência ("oi? alô? tudo bem?"), não contra
   * ACOMPANHAMENTO: voltar horas depois para saber se o técnico chegou é
   * exatamente o comportamento que se quer. Então o bloqueio vale só enquanto
   * a última fala não-hóspede for recente. */
  const JANELA_SILENCIO_MS = 4 * 60 * 60 * 1000;
  if (params.reason !== "human_answer") {
    const { data: last } = await params.supabase
      .from("property_chat_messages")
      .select("sender_type, created_at")
      .eq("conversation_id", params.conversationId)
      .order("created_at", { ascending: false })
      .limit(1);
    const ultima = ((last ?? []) as Array<{ sender_type: string | null; created_at: string }>)[0];
    if (ultima && ultima.sender_type !== "guest") {
      const idadeMs = Date.now() - new Date(ultima.created_at).getTime();
      if (idadeMs < JANELA_SILENCIO_MS) return { sent: false, skipped: "double_message" };
    }
  }

  const { data: inserted, error } = await params.supabase
    .from("property_chat_messages")
    .insert({
      conversation_id: params.conversationId,
      role: "assistant",
      content: text,
      sender_type: "ai",
    })
    .select("id")
    .single();
  if (error || !inserted) return { sent: false, skipped: "empty" };

  await params.supabase
    .from("property_chat_conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", params.conversationId);

  // O push é o que faz a mensagem existir para quem está com o guia fechado.
  let pushed = 0;
  try {
    const { sendPushToGuest } = await import("@/lib/guest-push.server");
    const r = await sendPushToGuest(params.conversationId, {
      title: params.pushTitle ?? "Mensagem do anfitrião",
      body: text.length > 120 ? `${text.slice(0, 117)}…` : text,
      data: { conversationId: params.conversationId, tag: `speak-${params.reason}` },
    });
    pushed = r.sent;
  } catch (e) {
    console.error("[speak] push falhou", (e as Error)?.message);
  }

  return { sent: true, messageId: String((inserted as { id: string }).id), pushed, text };
}

/**
 * Gera o texto COM a cabeça da IA (base de conhecimento, tom, regras) e
 * entrega. É assim que a resposta do atendente sai "pela boca da IA" em vez de
 * ser colada crua na conversa.
 *
 * `instruction` não é uma mensagem do hóspede: é uma instrução interna, e o
 * agente já sabe tratar resposta humana como verdade absoluta (ver
 * human-loop/escalations.server.ts).
 */
export async function speakWithAgent(params: {
  supabase: Admin;
  conversationId: string;
  instruction: string;
  reason: SpeakReason;
  urgent?: boolean;
  pushTitle?: string;
}): Promise<SpeakResult> {
  const { data: conv } = await params.supabase
    .from("property_chat_conversations")
    .select("id, property_id, guest_session_id, guest_name")
    .eq("id", params.conversationId)
    .maybeSingle();
  if (!conv) return { sent: false, skipped: "no_conversation" };
  const c = conv as {
    property_id: string;
    guest_session_id: string | null;
    guest_name: string | null;
  };

  const { data: prop } = await params.supabase
    .from("properties")
    .select("*")
    .eq("id", c.property_id)
    .maybeSingle();
  if (!prop) return { sent: false, skipped: "no_conversation" };

  // Mesmo histórico que o guia e o WhatsApp leem — inclusive as transcrições
  // de áudio. Um jeito só de montar (ver `loadAgentHistory`).
  const { loadAgentHistory } = await import("@/lib/chat-audio.server");
  const history = await loadAgentHistory(params.supabase, params.conversationId, 20);

  let text = "";
  try {
    const { runHospitalityAgent } = await import("@/lib/ai/orchestrator.server");
    const result = await runHospitalityAgent({
      supabase: params.supabase as never,
      property: prop as unknown as Record<string, unknown>,
      conversationId: params.conversationId,
      sessionId: c.guest_session_id ?? params.conversationId,
      guestName: c.guest_name ?? null,
      message: params.instruction,
      history,
      surface: "guide_chat",
      proactiveTrigger: params.reason,
    });
    text = (result.reply ?? "").trim();
  } catch (e) {
    console.error("[speak] agente falhou", (e as Error)?.message);
    return { sent: false, skipped: "empty" };
  }

  return speakToGuest({
    supabase: params.supabase,
    conversationId: params.conversationId,
    text,
    reason: params.reason,
    urgent: params.urgent,
    pushTitle: params.pushTitle,
  });
}
