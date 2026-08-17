import { createFileRoute } from "@tanstack/react-router";

/**
 * Cron: mensagens proativas — a IA fala primeiro com hóspedes hospedados
 * agora, quando há algo concreto que valha a interrupção (clima, assunto
 * que ficou em aberto, etc). Roda a cada poucas horas; a própria função
 * decide, por conversa, se já mandou algo recentemente (`last_proactive_at`)
 * — rodar o cron com mais frequência não gera duplicidade.
 *
 * IMPORTANTE: mais de uma pessoa pode estar conversando com a IA sobre a
 * MESMA reserva (ex.: casal, cada um pelo próprio celular) — cada uma cria
 * sua própria linha em `property_chat_conversations`. O CONTEXTO usado pra
 * decidir é o da RESERVA inteira (o que qualquer pessoa do grupo mencionou
 * entra nos sinais), mas a MENSAGEM final é sempre individual: decidida e
 * enviada pra UMA pessoa por vez, na conversa dela — nunca a mesma
 * mensagem disparada igual pra todo mundo do grupo. Só quando a mesma
 * PESSOA (mesmo nome normalizado) aparece em mais de um aparelho é que o
 * envio se repete nas duas conversas — porque aí é literalmente ela mesma
 * recebendo, não um broadcast pro grupo.
 *
 * Protegido por `x-cron-secret`, mesmo padrão dos outros crons.
 */
export const Route = createFileRoute("/api/public/cron/proactive-nudges")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const cronSecret = process.env["CRON_SECRET"];
        if (!cronSecret || request.headers.get("x-cron-secret") !== cronSecret) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { evaluateProactiveNudge } = await import("@/lib/ai/proactive.server");
        const { sendPushToGuest } = await import("@/lib/guest-push.server");

        const todayIso = new Date().toISOString().slice(0, 10);
        const minGapIso = new Date(Date.now() - 18 * 60 * 60 * 1000).toISOString();

        const normName = (s: string) =>
          s
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/\s+/g, " ")
            .trim();

        try {
          // Conversas de reservas ativas hoje, sem mensagem proativa nas
          // últimas ~18h (nunca mandada, ou mandada ontem).
          const { data: conversations, error } = await supabaseAdmin
            .from("property_chat_conversations")
            .select("id, property_id, guest_name, checkin_date, checkout_date, last_proactive_at")
            .lte("checkin_date", todayIso)
            .gte("checkout_date", todayIso)
            .or(`last_proactive_at.is.null,last_proactive_at.lt.${minGapIso}`)
            .limit(400);

          if (error) throw error;
          if (!conversations?.length) {
            return Response.json({ ok: true, scanned: 0, reservations: 0, sent: 0 });
          }

          const propertyIds = [...new Set(conversations.map((c) => c.property_id as string))];
          const { data: properties } = await supabaseAdmin
            .from("properties")
            .select("id, owner_id, name, lat, lng, default_language")
            .in("id", propertyIds);
          const propById = new Map((properties ?? []).map((p) => [p.id as string, p]));

          // Nível 1 — agrupa por RESERVA (imóvel + datas), sem considerar
          // nome: é o universo de sinais compartilhados por quem está
          // viajando junto.
          type Row = (typeof conversations)[number];
          const reservations = new Map<string, Row[]>();
          for (const conv of conversations) {
            if (!conv.guest_name) continue;
            const resKey = `${conv.property_id}::${conv.checkin_date}::${conv.checkout_date}`;
            const arr = reservations.get(resKey) ?? [];
            arr.push(conv);
            reservations.set(resKey, arr);
          }

          let sent = 0;
          const results: Array<{ recipient: string; conversationIds: string[]; sent: boolean; reason?: string }> = [];

          for (const [resKey, resConvs] of reservations) {
            const prop = propById.get(resConvs[0].property_id as string);
            if (!prop) continue;

            // Todos os nomes distintos desta reserva — vira o contexto
            // compartilhado (sinais), não o destinatário.
            const allGuestNamesInReservation = [...new Set(resConvs.map((c) => c.guest_name as string))];

            // Só combina sinais do grupo inteiro se TODOS já consentiram
            // (mesma regra de consenso do roteiro) — sem isso, cada pessoa
            // continua vendo só os próprios sinais, nunca os de outra.
            let groupModeConfirmed = false;
            if (allGuestNamesInReservation.length > 1) {
              try {
                const { getReservationMode } = await import("@/lib/ai/reservation-mode.server");
                const modeInfo = await getReservationMode({
                  supabase: supabaseAdmin,
                  propertyId: prop.id as string,
                  checkinDate: resConvs[0].checkin_date as string,
                  checkoutDate: resConvs[0].checkout_date as string,
                  currentGuestName: allGuestNamesInReservation[0],
                });
                groupModeConfirmed = modeInfo.mode === "group";
              } catch (e) {
                console.error("[cron:proactive] getReservationMode falhou", e);
              }
            }

            // Nível 2 — dentro da reserva, agrupa por PESSOA (nome
            // normalizado), pra decidir e enviar uma vez por pessoa. Se essa
            // pessoa está em 2+ aparelhos, as duas conversas recebem a MESMA
            // mensagem (é ela mesma, não é broadcast pro grupo) — mas se são
            // pessoas diferentes da mesma reserva, cada uma tem sua própria
            // decisão e sua própria mensagem, endereçada só a ela.
            const byPerson = new Map<string, { name: string; convs: Row[] }>();
            for (const conv of resConvs) {
              const name = conv.guest_name as string;
              const key = normName(name);
              const entry = byPerson.get(key) ?? { name, convs: [] };
              entry.convs.push(conv);
              byPerson.set(key, entry);
            }

            for (const { name: recipientName, convs: personConvs } of byPerson.values()) {
              const conversationIds = personConvs.map((c) => c.id as string);
              // Sem consenso de grupo, cada pessoa só enxerga os próprios
              // sinais — nunca os de outra pessoa da mesma reserva.
              const groupGuestNames = groupModeConfirmed ? allGuestNamesInReservation : [recipientName];
              try {
                const { nudge } = await evaluateProactiveNudge({
                  supabase: supabaseAdmin,
                  ownerId: prop.owner_id as string,
                  propertyId: prop.id as string,
                  propertyName: (prop.name as string) ?? "",
                  propertyLat: prop.lat != null ? Number(prop.lat) : null,
                  propertyLng: prop.lng != null ? Number(prop.lng) : null,
                  recipientName,
                  groupGuestNames,
                  checkinDate: resConvs[0].checkin_date as string,
                  checkoutDate: resConvs[0].checkout_date as string,
                  language: (prop.default_language as string) ?? "pt",
                });

                // Marca que avaliamos agora, mande ou não — só nas conversas
                // DESTA pessoa, não na reserva inteira (as outras pessoas do
                // grupo continuam sendo avaliadas na próxima iteração deste
                // mesmo loop, cada uma com sua própria decisão).
                await supabaseAdmin
                  .from("property_chat_conversations")
                  .update({ last_proactive_at: new Date().toISOString() })
                  .in("id", conversationIds);

                if (!nudge) {
                  results.push({ recipient: `${resKey}::${recipientName}`, conversationIds, sent: false });
                  continue;
                }

                for (const convId of conversationIds) {
                  await supabaseAdmin.from("property_chat_messages").insert({
                    conversation_id: convId,
                    role: "assistant",
                    content: nudge.message,
                    sender_type: "ai",
                  });
                  await supabaseAdmin
                    .from("property_chat_conversations")
                    .update({ last_message_at: new Date().toISOString() })
                    .eq("id", convId);
                  await sendPushToGuest(convId, {
                    title: (prop.name as string) || "Novidade do seu concierge",
                    body: nudge.message.slice(0, 140),
                    data: { conversationId: convId, tag: "proactive-nudge" },
                  }).catch((e) => console.error("[cron:proactive] push falhou", e));
                }

                sent += 1;
                results.push({ recipient: `${resKey}::${recipientName}`, conversationIds, sent: true, reason: nudge.reason });
              } catch (e) {
                console.error(`[cron:proactive] falhou para ${resKey}::${recipientName}`, e);
                results.push({ recipient: `${resKey}::${recipientName}`, conversationIds, sent: false, reason: "erro" });
              }
            }
          }

          return Response.json({ ok: true, scanned: conversations.length, reservations: reservations.size, sent, results });
        } catch (err) {
          console.error("[cron:proactive-nudges]", err);
          return Response.json({ ok: false, error: "scan failed" }, { status: 500 });
        }
      },
    },
  },
});
