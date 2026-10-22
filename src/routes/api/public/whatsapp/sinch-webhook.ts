import { createFileRoute } from "@tanstack/react-router";

// Sinch Conversations webhook — receives inbound WhatsApp messages + delivery events.
// URL is per-owner: /api/public/whatsapp/sinch-webhook?owner=<uuid>
export const Route = createFileRoute("/api/public/whatsapp/sinch-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const ownerId = url.searchParams.get("owner");
        if (!ownerId) return new Response("Missing owner", { status: 400 });

        const raw = await request.text();
        const signature = request.headers.get("x-sinch-webhook-signature");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { verifySinchSignature } = await import("@/lib/whatsapp.server");

        const { data: cfg } = await supabaseAdmin
          .from("host_whatsapp_config")
          .select("webhook_secret, sender_number")
          .eq("owner_id", ownerId)
          .maybeSingle();
        if (!cfg?.webhook_secret) return new Response("Unknown owner", { status: 404 });
        if (!verifySinchSignature(raw, signature, cfg.webhook_secret as string)) {
          return new Response("Invalid signature", { status: 401 });
        }

        let event: any;
        try {
          event = JSON.parse(raw);
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }

        // Delivery report (message we sent)
        const eventType: string = event?.event_type || event?.trigger || "";
        const messageId: string | undefined =
          event?.message?.id || event?.message_id || event?.message_delivery_report?.message_id;

        if (eventType.includes("DELIVERY") && messageId) {
          const status = String(
            event?.message_delivery_report?.status || event?.status || "",
          ).toLowerCase();
          const mapped = status.includes("delivered")
            ? "delivered"
            : status.includes("read")
              ? "read"
              : status.includes("failed") || status.includes("rejected")
                ? "failed"
                : status.includes("dispatched") || status.includes("sent")
                  ? "sent"
                  : null;
          if (mapped) {
            await supabaseAdmin
              .from("property_chat_messages")
              .update({ delivery_status: mapped })
              .eq("external_id", messageId);
          }
          if (mapped === "failed") {
            // Rejeição pela plataforma depois do envio: alerta equipe e admins.
            const { data: msg } = await supabaseAdmin
              .from("property_chat_messages")
              .select("conversation_id, property_chat_conversations(property_id, guest_name)")
              .eq("external_id", messageId)
              .maybeSingle();
            const conv = (msg as any)?.property_chat_conversations;
            if (msg?.conversation_id && conv?.property_id) {
              const { reportDeliveryFailure } = await import("@/lib/delivery-failure.server");
              await reportDeliveryFailure(supabaseAdmin, {
                conversationId: msg.conversation_id as string,
                propertyId: conv.property_id,
                channel: "whatsapp",
                guestName: conv.guest_name ?? null,
                detail: status || "rejeitada",
              });
            }
          }
          return new Response("ok");
        }

        // Inbound message
        const inbound =
          event?.message?.contact_message?.text_message?.text ||
          event?.message?.text_message?.text ||
          event?.text_message?.text;
        const fromIdentity: string | undefined =
          event?.message?.channel_identity?.identity ||
          event?.channel_identity?.identity ||
          event?.message?.sender?.identity;

        if (!inbound || !fromIdentity) return new Response("ok"); // ignore other events

        const phoneDigits = String(fromIdentity).replace(/[^\d]/g, "");
        const guestSessionId = `wa:${phoneDigits}`;

        // Identificação SOMENTE pelos dados da API Channex (telefone cadastrado
        // ou código da reserva) — nunca pelo acesso ao guia, nunca por nome.
        const { data: props } = await supabaseAdmin
          .from("properties")
          .select("id")
          .eq("owner_id", ownerId);
        const propertyIds = (props ?? []).map((p) => p.id as string);
        if (propertyIds.length === 0) return new Response("no properties", { status: 200 });

        const { pickReservation, askCodeText } = await import("@/lib/whatsapp-guest-match");
        const today = new Date().toISOString().slice(0, 10);
        const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
        const { data: resRows } = await supabaseAdmin
          .from("property_reservations")
          .select("id, property_id, checkin_date, checkout_date, status, guest_contacts")
          .in("property_id", propertyIds)
          .eq("source", "channex")
          .gte("checkout_date", from)
          .order("checkin_date", { ascending: true })
          .limit(1000);
        const rows = (resRows ?? []) as any[];
        let picked = pickReservation(rows, { phone: phoneDigits, text: inbound, today });

        // Conversa já vinculada antes (ex.: o hóspede mandou o código numa mensagem anterior).
        if (!picked) {
          const { data: linked } = await supabaseAdmin
            .from("property_chat_conversations")
            .select("reservation_id")
            .in("property_id", propertyIds)
            .eq("guest_session_id", guestSessionId)
            .not("reservation_id", "is", null)
            .order("last_message_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          const r = linked?.reservation_id ? rows.find((x) => x.id === linked.reservation_id) : null;
          if (r) picked = { row: r, by: "telefone" };
        }

        // Código citado no texto, mas fora do lote em memória: busca direta.
        if (!picked) {
          const { extractReservationCodes } = await import("@/lib/whatsapp-guest-match");
          const codes = extractReservationCodes(inbound);
          for (const code of codes) {
            const { data: hits } = await supabaseAdmin
              .from("property_reservations")
              .select("id, property_id, checkin_date, checkout_date, status, guest_contacts")
              .in("property_id", propertyIds)
              .eq("source", "channex")
              .neq("status", "cancelled")
              .ilike("guest_contacts->>code", code)
              .limit(2);
            if (hits && hits.length === 1) {
              picked = { row: hits[0] as any, by: "codigo" };
              break;
            }
          }
        }

        if (!picked) {
          // Não descarta: pede o código da reserva (sem pedir nome).
          try {
            const { sendWhatsappText } = await import("@/lib/ai/channels/whatsapp/provider.server");
            await sendWhatsappText({ supabase: supabaseAdmin, tenantId: ownerId, toPhone: phoneDigits, text: askCodeText() });
          } catch (e) {
            console.error("[sinch-webhook] pedido de código falhou", e);
          }
          return new Response("ask code", { status: 200 });
        }

        const contacts = (picked.row.guest_contacts ?? {}) as { code?: string | null; names?: string[] };
        const log = {
          property_id: picked.row.property_id as string,
          guest_name: (contacts.names?.[0] as string | undefined) ?? null,
          checkin_date: picked.row.checkin_date as string,
          checkout_date: picked.row.checkout_date as string,
          reservation_code: contacts.code ?? null,
          reservation_id: picked.row.id as string,
        };

        let convId: string | null = null;
        let aiPaused = false;
        const { data: existingConv } = await supabaseAdmin
          .from("property_chat_conversations")
          .select("id, ai_paused, paused_until, assigned_to, reservation_id")
          .eq("property_id", log.property_id)
          .eq("guest_session_id", guestSessionId)
          .maybeSingle();

        if (existingConv?.id) {
          convId = existingConv.id as string;
          if (existingConv.reservation_id !== log.reservation_id) {
            await supabaseAdmin
              .from("property_chat_conversations")
              .update({ reservation_id: log.reservation_id })
              .eq("id", convId);
          }
          const { resolvePause } = await import("@/lib/ai/pause");
          aiPaused = await resolvePause(supabaseAdmin, String(existingConv.id), existingConv);
        } else {
          const { data: newConv, error: convErr } = await supabaseAdmin
            .from("property_chat_conversations")
            .insert({
              property_id: log.property_id,
              guest_session_id: guestSessionId,
              guest_name: log.guest_name,
              status: "ai",
              ai_paused: false,
              reservation_id: log.reservation_id,
            })
            .select("id")
            .single();
          if (convErr || !newConv) return new Response("conv create failed", { status: 500 });
          convId = newConv.id as string;
        }

        await supabaseAdmin.from("property_chat_messages").insert({
          conversation_id: convId,
          role: "user",
          content: inbound,
          sender_type: "guest",
          channel: "whatsapp",
          external_id: messageId ?? null,
          delivery_status: "delivered",
        });

        try {
          const { applyStayCompletionOnIngest } = await import("@/lib/ai/conversation-link.server");
          await applyStayCompletionOnIngest(supabaseAdmin as never, { conversationId: convId, propertyId: log.property_id as string, message: inbound });
        } catch (e) {
          console.error("[sinch] baixa de estadia falhou", e);
        }

        // Espelho no Conversation Core: mesma entidade de conversa do chat web.
        try {
          const { resolveCoreConversation, appendCoreMessage } =
            await import("@/lib/ai/conversation/core.server");
          const { markChannelSeen } = await import("@/lib/ai/channels/whatsapp/provider.server");
          const coreConv = await resolveCoreConversation({
            supabase: supabaseAdmin,
            tenantId: ownerId,
            propertyId: log.property_id as string,
            legacyConversationId: convId,
            channel: "whatsapp",
            guestName: (log.guest_name as string | null) ?? null,
            guestPhone: phoneDigits,
          });
          if (coreConv) {
            await appendCoreMessage({
              supabase: supabaseAdmin,
              conversationId: coreConv.id,
              tenantId: coreConv.tenantId,
              propertyId: log.property_id as string,
              senderType: "guest",
              channel: "whatsapp",
              content: inbound,
              externalId: messageId ?? null,
              deliveryStatus: "delivered",
            });
          }
          await markChannelSeen(supabaseAdmin, ownerId, "whatsapp");
        } catch (err) {
          console.error("[sinch-webhook] espelho core falhou", err);
        }

        await supabaseAdmin
          .from("property_chat_conversations")
          .update({ last_message_at: new Date().toISOString() })
          .eq("id", convId);

        // Se um humano já assumiu esta conversa (ai_paused), a mensagem fica
        // apenas registrada para o atendente ver no dock — a IA não responde.
        // Antes disto, nenhuma mensagem seguinte do hóspede (depois da que
        // disparou o handoff) avisava o atendente — mesmo mensagens novas
        // por WhatsApp, silenciosamente sem push nenhum.
        if (aiPaused) {
          try {
            const { getPropertyNotifiableUsers, sendGuestReplyPush } =
              await import("@/lib/handoff.server");
            const assignedTo =
              (existingConv as { assigned_to?: string | null } | null)?.assigned_to ?? null;
            const userIds = assignedTo
              ? [assignedTo]
              : await getPropertyNotifiableUsers(supabaseAdmin, log.property_id as string);
            const { data: propRow } = await supabaseAdmin
              .from("properties")
              .select("name")
              .eq("id", log.property_id)
              .maybeSingle();
            await sendGuestReplyPush(supabaseAdmin, {
              userIds,
              conversationId: convId as string,
              propertyName: propRow?.name ?? null,
              guestName: (log.guest_name as string | null) ?? null,
              guestMessage: inbound,
            });
          } catch (e) {
            console.error("[sinch-webhook] guest reply push failed", e);
          }
          return new Response("ok");
        }

        // ─── Agente de Hospitalidade — mesma pipeline do chat do guia,
        // incluindo o guardrail determinístico de segurança (guest-safety.server).
        // Antes desta correção, o webhook só gravava a mensagem e nunca chamava
        // o orquestrador: o hóspede no WhatsApp nunca recebia resposta nenhuma.
        try {
          const apiKey = process.env.LOVABLE_API_KEY;
          if (!apiKey) {
            console.error("[sinch-webhook] LOVABLE_API_KEY ausente — IA não configurada");
            return new Response("ok");
          }

          const { data: prop } = await supabaseAdmin
            .from("properties")
            .select("*")
            .eq("id", log.property_id)
            .maybeSingle();
          if (!prop) return new Response("ok");

          // Histórico COM as transcrições de áudio. Antes este caminho lia só
          // `content` — e mensagem de áudio grava `content` vazio, então todo
          // áudio do WhatsApp era um buraco no contexto da IA, mesmo depois de
          // a transcrição existir. Ver `loadAgentHistory`.
          const { loadAgentHistory } = await import("@/lib/chat-audio.server");
          const prior = await loadAgentHistory(supabaseAdmin, convId, 20);

          const { runHospitalityAgent } = await import("@/lib/ai/orchestrator.server");
          const { loadReservationDossier } = await import("@/lib/ai/reservation-dossier.server");
          const dossier = await loadReservationDossier(supabaseAdmin, {
            propertyId: String(log.property_id),
            code: log.reservation_code,
          }).catch(() => null);
          const result = await runHospitalityAgent({
            supabase: supabaseAdmin,
            property: prop as unknown as Record<string, unknown>,
            conversationId: convId,
            sessionId: guestSessionId,
            guestName: (log.guest_name as string | null) ?? null,
            message: inbound,
            history: prior,
            surface: "whatsapp",
            channel: "whatsapp",
            channelReference: phoneDigits,
            checkinDate: dossier?.checkin ?? null,
            checkoutDate: dossier?.checkout ?? null,
            reservationDossier: dossier?.text ?? null,
          });

          const handoffTriggered = result.handoff;
          const finalReply = result.reply.trim();

          if (handoffTriggered) {
            await supabaseAdmin
              .from("property_chat_conversations")
              .update({
                status: "needs_human",
                // Escalar não cala a IA — ver o comentário longo no
                // equivalente em `guide-chat.ts`.
                ai_paused: false,
                handoff_reason: result.handoffReason ?? "Hóspede pediu atendimento humano.",
                handoff_urgency: result.handoffUrgency,
                handoff_at: new Date().toISOString(),
              })
              .eq("id", convId);
            try {
              const { getPropertyNotifiableUsers, sendHandoffPush } =
                await import("@/lib/handoff.server");
              const userIds = await getPropertyNotifiableUsers(
                supabaseAdmin,
                log.property_id as string,
              );
              await sendHandoffPush(supabaseAdmin, {
                userIds,
                conversationId: convId,
                propertyName: (prop as { name?: string }).name ?? "",
                guestName: (log.guest_name as string | null) ?? null,
                guestMessage: inbound,
                checkinDate: (log.checkin_date as string | null) ?? null,
                reason: result.handoffReason ?? "Hóspede pediu atendimento humano.",
                urgency: result.handoffUrgency,
              });
            } catch (e) {
              console.error("[sinch-webhook] push de handoff falhou", e);
            }
          }

          if (finalReply) {
            // Entrega de verdade pro WhatsApp do hóspede — antes desta correção,
            // sendWhatsappText existia mas nunca era chamada em lugar nenhum.
            let externalId: string | null = null;
            try {
              const { sendWhatsappText } =
                await import("@/lib/ai/channels/whatsapp/provider.server");
              const sent = await sendWhatsappText({
                supabase: supabaseAdmin,
                tenantId: ownerId,
                toPhone: phoneDigits,
                text: finalReply,
              });
              externalId = sent.messageId ?? null;
            } catch (e) {
              console.error("[sinch-webhook] envio ao WhatsApp falhou", e);
              const { reportDeliveryFailure } = await import("@/lib/delivery-failure.server");
              await reportDeliveryFailure(supabaseAdmin, {
                conversationId: convId,
                propertyId: log.property_id as string,
                channel: "whatsapp",
                propertyName: (prop as { name?: string }).name ?? null,
                guestName: (log.guest_name as string | null) ?? null,
                guestMessage: inbound,
                detail: (e instanceof Error ? e.message : String(e)).slice(0, 120),
              });
            }

            await supabaseAdmin.from("property_chat_messages").insert({
              conversation_id: convId,
              role: "assistant",
              content: finalReply,
              sender_type: "ai",
              channel: "whatsapp",
              external_id: externalId,
              delivery_status: externalId ? "sent" : null,
            });

            try {
              const { resolveCoreConversation, appendCoreMessage } =
                await import("@/lib/ai/conversation/core.server");
              const coreConv = await resolveCoreConversation({
                supabase: supabaseAdmin,
                tenantId: ownerId,
                propertyId: log.property_id as string,
                legacyConversationId: convId,
                channel: "whatsapp",
                guestName: (log.guest_name as string | null) ?? null,
                guestPhone: phoneDigits,
              });
              if (coreConv) {
                await appendCoreMessage({
                  supabase: supabaseAdmin,
                  conversationId: coreConv.id,
                  tenantId: coreConv.tenantId,
                  propertyId: log.property_id as string,
                  senderType: "agent",
                  channel: "whatsapp",
                  content: finalReply,
                  externalId,
                  deliveryStatus: externalId ? "sent" : null,
                });
              }
            } catch (err) {
              console.error("[sinch-webhook] espelho core (resposta) falhou", err);
            }
          }
        } catch (err) {
          console.error("[sinch-webhook] pipeline de IA falhou", err);
        }

        return new Response("ok");
      },
    },
  },
});
