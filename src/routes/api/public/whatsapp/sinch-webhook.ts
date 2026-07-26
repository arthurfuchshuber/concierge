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
        const { data: existingConv } = await supabaseAdmin
          .from("property_chat_conversations")
          .select("id")
          .eq("property_id", log.property_id)
          .eq("guest_session_id", guestSessionId)
          .maybeSingle();

        if (existingConv?.id) {
          convId = existingConv.id as string;
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

        await supabaseAdmin
          .from("property_chat_conversations")
          .update({ last_message_at: new Date().toISOString() })
          .eq("id", convId);

        return new Response("ok");
      },
    },
  },
});
