import { createFileRoute } from "@tanstack/react-router";

/**
 * ACOMPANHAMENTO DE CASO ABERTO — a IA voltando por conta própria.
 *
 * Pedido explícito (11/09/2026): "a IA vai conseguir também chamar o hóspede
 * em outro horário quando não for acionado pelo hóspede?".
 *
 * Este cron é a resposta para o caso que mais pesa na percepção de
 * atendimento: o problema que ficou em aberto e ninguém mais tocou. Na
 * auditoria dos 5 dias, o hóspede que relatou a campainha às 11h53 recebeu a
 * última palavra do atendente às 12h05 ("já estamos verificando um técnico") e
 * NINGUÉM voltou nele — nem para dizer que resolveu, nem para perguntar.
 *
 * Regras do ritmo (o que impede isto de virar chateação):
 *  · só conversa com caso realmente aberto (`needs_human`/`assigned`, sem
 *    `resolved_at`);
 *  · só se o último a falar NÃO foi o hóspede — se ele falou por último, a
 *    bola está com a gente, não com ele;
 *  · só depois de 4h de silêncio, no máximo UMA vez por dia (a coluna
 *    `last_guest_followup_at`);
 *  · nada de madrugada — a trava de horário vive no motor de voz ativa;
 *  · o texto sai do próprio agente, olhando a conversa: ele sabe o que ficou
 *    pendente e pergunta sobre AQUILO, em vez de mandar um "tudo bem?" solto.
 */
export const Route = createFileRoute("/api/public/cron/guest-followup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("x-cron-secret") ?? "";
        const expected = process.env.CRON_SECRET ?? "";
        if (!expected) return new Response("Unauthorized", { status: 401 });
        const enc = new TextEncoder();
        const a = enc.encode(provided.padEnd(expected.length, "\0").slice(0, expected.length));
        const b = enc.encode(expected);
        let diff = provided.length !== expected.length ? 1 : 0;
        for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
        if (diff !== 0) return new Response("Unauthorized", { status: 401 });

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { speakWithAgent } = await import("@/lib/ai/outbound/speak.server");

          const agora = Date.now();
          const quatroHorasAtras = new Date(agora - 4 * 60 * 60 * 1000).toISOString();
          const umDiaAtras = new Date(agora - 24 * 60 * 60 * 1000).toISOString();

          const { data: abertas } = await supabaseAdmin
            .from("property_chat_conversations")
            .select("id, guest_name, last_message_at, last_guest_followup_at, ai_paused")
            .in("status", ["needs_human", "assigned"])
            .is("resolved_at", null)
            .lt("last_message_at", quatroHorasAtras)
            .order("last_message_at", { ascending: true })
            .limit(50);

          const candidatas = (
            (abertas ?? []) as Array<{
              id: string;
              last_guest_followup_at: string | null;
            }>
          ).filter((c) => !c.last_guest_followup_at || c.last_guest_followup_at < umDiaAtras);

          let enviados = 0;
          const pulados: Record<string, number> = {};

          for (const conv of candidatas.slice(0, 20)) {
            // Quem falou por último? Se foi o hóspede, a dívida é nossa: quem
            // tem que voltar é o atendimento com uma resposta, não com uma
            // pergunta. O lembrete do time cuida disso.
            const { data: ultima } = await supabaseAdmin
              .from("property_chat_messages")
              .select("sender_type")
              .eq("conversation_id", conv.id)
              .order("created_at", { ascending: false })
              .limit(1);
            const quem = ((ultima ?? []) as Array<{ sender_type: string | null }>)[0]?.sender_type;
            if (quem === "guest") {
              pulados.bola_com_a_casa = (pulados.bola_com_a_casa ?? 0) + 1;
              continue;
            }

            const r = await speakWithAgent({
              supabase: supabaseAdmin as never,
              conversationId: conv.id,
              reason: "follow_up",
              pushTitle: "Passando para saber de você",
              instruction:
                "Este é um ACOMPANHAMENTO, não uma resposta: o hóspede não escreveu nada novo. " +
                "Olhe a conversa, identifique o que ficou pendente na última interação e volte SÓ sobre aquilo — " +
                "em uma ou duas frases, perguntando se resolveu e oferecendo o próximo passo concreto. " +
                "Se nada estiver pendente de fato, não invente assunto: responda apenas com a palavra PULAR.",
            });

            if (r.sent) {
              enviados += 1;
              await supabaseAdmin
                .from("property_chat_conversations")
                .update({ last_guest_followup_at: new Date().toISOString() })
                .eq("id", conv.id);
            } else if (r.skipped) {
              pulados[r.skipped] = (pulados[r.skipped] ?? 0) + 1;
            }
          }

          return Response.json({
            ok: true,
            candidatas: candidatas.length,
            enviados,
            pulados,
          });
        } catch (e) {
          console.error("[cron guest-followup]", e);
          return Response.json(
            { ok: false, error: (e as Error)?.message ?? "erro" },
            { status: 500 },
          );
        }
      },
    },
  },
});
