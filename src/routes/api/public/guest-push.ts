// Rota pública para o hóspede (anônimo) gerenciar sua inscrição de push.
// Usa supabaseAdmin porque não há sessão autenticada; a validação verifica
// que o conversationId (quando informado) pertence à property/slug indicada.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const SubscribeSchema = z.object({
  action: z.literal("subscribe"),
  slug: z.string().min(1).max(200),
  sessionId: z.string().min(1).max(200),
  conversationId: z.string().uuid().nullable().optional(),
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(500),
    auth: z.string().min(1).max(500),
  }),
  userAgent: z.string().max(500).nullable().optional(),
});

const UnsubscribeSchema = z.object({
  action: z.literal("unsubscribe"),
  endpoint: z.string().url().max(2000),
});

const BodySchema = z.discriminatedUnion("action", [SubscribeSchema, UnsubscribeSchema]);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/guest-push")({
  server: {
    handlers: {
      GET: async () => {
        const publicKey = process.env.VAPID_PUBLIC_KEY;
        if (!publicKey) return jsonResponse({ error: "VAPID não configurado" }, 500);
        return jsonResponse({ publicKey });
      },
      POST: async ({ request }) => {
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return jsonResponse({ error: "JSON inválido" }, 400);
        }
        const parsed = BodySchema.safeParse(raw);
        if (!parsed.success) return jsonResponse({ error: "Payload inválido" }, 400);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        if (parsed.data.action === "unsubscribe") {
          await supabaseAdmin
            .from("guest_push_subscriptions")
            .delete()
            .eq("endpoint", parsed.data.endpoint);
          return jsonResponse({ ok: true });
        }

        const b = parsed.data;

        // Resolve o property_id pelo slug
        const { data: prop } = await supabaseAdmin
          .from("properties")
          .select("id")
          .eq("slug", b.slug)
          .maybeSingle();
        if (!prop) return jsonResponse({ error: "Imóvel não encontrado" }, 404);

        // Se conversationId informado, valida que pertence a esta property + sessão
        let conversationId: string | null = null;
        if (b.conversationId) {
          const { data: conv } = await supabaseAdmin
            .from("property_chat_conversations")
            .select("id, property_id, guest_session_id")
            .eq("id", b.conversationId)
            .maybeSingle();
          if (
            conv &&
            (conv as { property_id: string }).property_id === (prop as { id: string }).id &&
            (conv as { guest_session_id: string }).guest_session_id === b.sessionId
          ) {
            conversationId = b.conversationId;
          }
        }

        const { error } = await supabaseAdmin
          .from("guest_push_subscriptions")
          .upsert(
            {
              guest_session_id: b.sessionId,
              property_id: (prop as { id: string }).id,
              conversation_id: conversationId,
              endpoint: b.endpoint,
              p256dh: b.keys.p256dh,
              auth: b.keys.auth,
              user_agent: b.userAgent ?? null,
              enabled: true,
              last_used_at: new Date().toISOString(),
            },
            { onConflict: "endpoint" },
          );

        if (error) return jsonResponse({ error: error.message }, 500);
        return jsonResponse({ ok: true });
      },
    },
  },
});
