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
        try { event = JSON.parse(raw); } catch { return new Response("Bad JSON", { status: 400 }); }

        // Delivery report (message we sent)
        const eventType: string = event?.event_type || event?.trigger || "";
        const messageId: string | undefined =
          event?.message?.id || event?.message_id || event?.message_delivery_report?.message_id;

        if (eventType.includes("DELIVERY") && messageId) {
          const status = String(event?.message_delivery_report?.status || event?.status || "").toLowerCase();
          const mapped =
            status.includes("delivered") ? "delivered" :
            status.includes("read") ? "read" :
            status.includes("failed") || status.includes("rejected") ? "failed" :
            status.includes("dispatched") || status.includes("sent") ? "sent" : null;
          if (mapped) {
            await supabaseAdmin
              .from("property_chat_messages")
              .update({ delivery_status: mapped })
              .eq("external_id", messageId);
          }
          return new Response("ok");
        }

        // Inbound message
        const inbound = event?.message?.contact_message?.text_message?.text
          || event?.message?.text_message?.text
          || event?.text_message?.text;
        const fromIdentity: string | undefined =
          event?.message?.channel_identity?.identity ||
          event?.channel_identity?.identity ||
          event?.message?.sender?.identity;

        if (!inbound || !fromIdentity) return new Response("ok"); // ignore other events

        const phoneDigits = String(fromIdentity).replace(/[^\d]/g, "");
        const last8 = phoneDigits.slice(-8);

        // Find the latest guide_access_log matching this phone across owner's properties
        const { data: props } = await supabaseAdmin
          .from("properties")
          .select("id")
          .eq("owner_id", ownerId);
        const propertyIds = (props ?? []).map((p) => p.id as string);
        if (propertyIds.length === 0) return new Response("no properties", { status: 200 });

        const { data: log } = await supabaseAdmin
          .from("guide_access_logs")
          .select("property_id, guest_name, guest_phone, checkin_date, checkout_date")
          .in("property_id", propertyIds)
          .like("guest_phone", `%${last8}`)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!log) return new Response("no guest match", { status: 200 });

        // Find (or create) an active conversation for this guest.
        const guestSessionId = `wa:${phoneDigits}`;
        let convId: string | null = null;
        let aiPaused = false;
        const { data: existingConv } = await supabaseAdmin
          .from("property_chat_conversations")
          .select("id, ai_paused")
          .eq("property_id", log.property_id)
          .eq("guest_session_id", guestSessionId)
          .maybeSingle();

        if (existingConv?.id) {
          convId = existingConv.id as string;
          aiPaused = existingConv.ai_paused === true;
        } else {
          const { data: newConv, error: convErr } = await supabaseAdmin
            .from("property_chat_conversations")
            .insert({
              property_id: log.property_id,
              guest_session_id: guestSessionId,
              guest_name: log.guest_name,
              status: "ai",
              ai_paused: false,
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

        // Espelho no Conversation Core: mesma entidade de conversa do chat web.
        try {
          const { resolveCoreConversation, appendCoreMessage } = await import("@/lib/ai/conversation/core.server");
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
        if (aiPaused) {
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

          const { data: priorRaw } = await supabaseAdmin
            .from("property_chat_messages")
            .select("role, content")
            .eq("conversation_id", convId)
            .order("created_at", { ascending: false })
            .limit(20);
          const prior = (priorRaw ?? [])
            .filter((m) => m.role === "user" || m.role === "assistant")
            .reverse();

          const { runHospitalityAgent } = await import("@/lib/ai/orchestrator.server");
          const result = await runHospitalityAgent({
            supabase: supabaseAdmin,
            property: prop as unknown as Record<string, unknown>,
            conversationId: convId,
            sessionId: guestSessionId,
            guestName: (log.guest_name as string | null) ?? null,
            message: inbound,
            history: prior.map((m) => ({ role: m.role as string, content: m.content ?? "" })),
            surface: "whatsapp",
            channel: "whatsapp",
            channelReference: phoneDigits,
          });

          const handoffTriggered = result.handoff;
          const finalReply = result.reply.trim();

          if (handoffTriggered) {
            await supabaseAdmin
              .from("property_chat_conversations")
              .update({
                status: "needs_human",
                ai_paused: !finalReply,
                handoff_reason: result.handoffReason ?? "Hóspede pediu atendimento humano.",
                handoff_urgency: result.handoffUrgency,
                handoff_at: new Date().toISOString(),
              })
              .eq("id", convId);
            try {
              const { getPropertyNotifiableUsers, sendHandoffPush } = await import("@/lib/handoff.server");
              const userIds = await getPropertyNotifiableUsers(supabaseAdmin, log.property_id as string);
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
              const { sendWhatsappText } = await import("@/lib/ai/channels/whatsapp/provider.server");
              const sent = await sendWhatsappText({
                supabase: supabaseAdmin,
                tenantId: ownerId,
                toPhone: phoneDigits,
                text: finalReply,
              });
              externalId = sent.messageId ?? null;
            } catch (e) {
              console.error("[sinch-webhook] envio ao WhatsApp falhou", e);
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
              const { resolveCoreConversation, appendCoreMessage } = await import("@/lib/ai/conversation/core.server");
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
