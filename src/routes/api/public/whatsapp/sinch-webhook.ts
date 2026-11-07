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
            const { sendTenantWhatsappText } = await import("@/lib/whatsapp.server");
            await sendTenantWhatsappText({ tenantId: ownerId, toPhone: phoneDigits, text: askCodeText() });
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
          const { resolvePause } = await import("@/lib/chat/pause");
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

        const { data: guestMsg } = await supabaseAdmin
          .from("property_chat_messages")
          .insert({
            conversation_id: convId,
            role: "user",
            content: inbound,
            sender_type: "guest",
            channel: "whatsapp",
            external_id: messageId ?? null,
            delivery_status: "delivered",
          })
          .select("id")
          .single();

        await supabaseAdmin
          .from("property_chat_conversations")
          .update({ last_message_at: new Date().toISOString() })
          .eq("id", convId);

        // ─── Copiloto (05/11/2026): sugestão para a EQUIPE aprovar, em segundo plano (não bloqueia, não
        // responde ao hóspede, não altera o fluxo abaixo). Dono provado pela assinatura HMAC do webhook.
        if (guestMsg?.id) {
          try {
            const { triggerCopilotSuggestion } = await import("@/lib/guest-ai/copilot/trigger.server");
            await triggerCopilotSuggestion({ surface: "whatsapp", conversationId: convId as string, messageId: guestMsg.id as string, expectedOwnerId: ownerId });
          } catch (e) {
            console.error("[sinch-webhook] copiloto não disparado", e instanceof Error ? e.name : "");
          }
        }

        const { data: propRow } = await supabaseAdmin
          .from("properties")
          .select("name")
          .eq("id", log.property_id)
          .maybeSingle();
        const propertyName = (propRow as { name?: string | null } | null)?.name ?? null;

        // Se um humano já assumiu esta conversa (ai_paused), a mensagem fica
        // apenas registrada para o atendente ver no dock. Antes disto, nenhuma
        // mensagem seguinte do hóspede (depois da que disparou o handoff)
        // avisava o atendente — mesmo mensagens novas por WhatsApp,
        // silenciosamente sem push nenhum.
        if (aiPaused) {
          try {
            const { getPropertyNotifiableUsers, sendGuestReplyPush } =
              await import("@/lib/handoff.server");
            const assignedTo =
              (existingConv as { assigned_to?: string | null } | null)?.assigned_to ?? null;
            const userIds = assignedTo
              ? [assignedTo]
              : await getPropertyNotifiableUsers(supabaseAdmin, log.property_id as string);
            await sendGuestReplyPush(supabaseAdmin, {
              userIds,
              conversationId: convId as string,
              propertyName,
              guestName: (log.guest_name as string | null) ?? null,
              guestMessage: inbound,
            });
          } catch (e) {
            console.error("[sinch-webhook] guest reply push failed", e);
          }
          return new Response("ok");
        }

        // ─── IA de atendimento: ponto de extensão (sem implementação instalada).
        // Sem IA, a conversa vai para a fila humana e a equipe é avisada.
        try {
          const { requestGuestAiReply, NO_AI_HANDOFF_REASON } = await import("@/lib/guest-ai/slot.server");
          const ai = await requestGuestAiReply({
            surface: "whatsapp",
            conversationId: convId,
            messageId: guestMsg?.id ?? "",
            // Dono provado pela assinatura HMAC do webhook (segredo por conta).
            expectedOwnerId: ownerId,
          });

          const handoffTriggered = ai ? ai.handoff : true;
          const reason = ai?.handoffReason ?? NO_AI_HANDOFF_REASON;
          const urgency = ai?.handoffUrgency ?? null;
          const finalReply = (ai?.reply ?? "").trim();

          if (handoffTriggered) {
            await supabaseAdmin
              .from("property_chat_conversations")
              .update({
                status: "needs_human",
                ai_paused: false,
                handoff_reason: reason,
                handoff_urgency: urgency,
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
                propertyName: propertyName ?? "",
                guestName: (log.guest_name as string | null) ?? null,
                guestMessage: inbound,
                checkinDate: (log.checkin_date as string | null) ?? null,
                reason,
                urgency,
              });
            } catch (e) {
              console.error("[sinch-webhook] push de handoff falhou", e);
            }
          }

          if (finalReply) {
            let externalId: string | null = null;
            try {
              const { sendTenantWhatsappText } = await import("@/lib/whatsapp.server");
              const sent = await sendTenantWhatsappText({ tenantId: ownerId, toPhone: phoneDigits, text: finalReply });
              externalId = sent.messageId ?? null;
            } catch (e) {
              console.error("[sinch-webhook] envio ao WhatsApp falhou", e);
              const { reportDeliveryFailure } = await import("@/lib/delivery-failure.server");
              await reportDeliveryFailure(supabaseAdmin, {
                conversationId: convId,
                propertyId: log.property_id as string,
                channel: "whatsapp",
                propertyName,
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
          }
        } catch (err) {
          console.error("[sinch-webhook] encaminhamento falhou", err);
        }

        return new Response("ok");
      },
    },
  },
});
