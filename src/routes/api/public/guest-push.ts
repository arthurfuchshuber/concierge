// Rota pública para o hóspede (anônimo) gerenciar sua inscrição de push.
// Usa supabaseAdmin porque não há sessão autenticada; a validação verifica
// que o conversationId (quando informado) pertence à property/slug indicada.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { tooManyRequests, rateLimitedResponse } from "@/lib/public-rate-limit.server";

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
  sessionId: z.string().min(1).max(200),
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
        if (tooManyRequests(request, "guest-push", 30, 60_000)) return rateLimitedResponse();
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
          // Só a própria sessão pode remover sua inscrição (evita que
          // qualquer um derrube o push de outro hóspede com o endpoint).
          await supabaseAdmin
            .from("guest_push_subscriptions")
            .delete()
            .eq("endpoint", parsed.data.endpoint)
            .eq("guest_session_id", parsed.data.sessionId);
          return jsonResponse({ ok: true });
        }

        const b = parsed.data;

        // 1) O endereço de entrega precisa ser de um serviço de push real —
        // sem isso a rota vira um encaminhador para destino escolhido por quem chama.
        if (!isPushServiceEndpoint(b.endpoint)) {
          return jsonResponse({ error: "Endereço de notificação inválido" }, 400);
        }

        // 2) A sessão do hóspede é o segredo que amarra a inscrição; sessões
        // curtas (adivinháveis) não são aceitas.
        if (b.sessionId.replace(/^preview-/, "").length < 16) {
          return jsonResponse({ error: "Sessão inválida" }, 400);
        }

        // Resolve o property_id pelo slug
        const { data: prop } = await supabaseAdmin
          .from("properties")
          .select("id")
          .eq("slug", b.slug)
          .eq("published", true)
          .maybeSingle();
        if (!prop) return jsonResponse({ error: "Imóvel não encontrado" }, 404);
        const propertyId = (prop as { id: string }).id;

        // 3) Se a sessão já é conhecida, ela pertence a UM imóvel. Tentar
        // registrar a mesma sessão em outro guia é sinal de sequestro de
        // notificação, não de uso legítimo.
        const { data: donos } = await supabaseAdmin
          .from("guest_push_subscriptions")
          .select("property_id, endpoint")
          .eq("guest_session_id", b.sessionId)
          .limit(10);
        const existentes = (donos ?? []) as Array<{ property_id: string; endpoint: string }>;
        if (existentes.some((r) => r.property_id !== propertyId)) {
          return jsonResponse({ error: "Sessão inválida" }, 403);
        }
        // 4) Teto de aparelhos por sessão (um hóspede não tem 20 celulares).
        const novosEndpoints = existentes.filter((r) => r.endpoint !== b.endpoint).length;
        if (novosEndpoints >= 5) {
          return jsonResponse({ error: "Limite de aparelhos atingido" }, 429);
        }

        // Se conversationId informado, valida que pertence a esta property + sessão.
        // Se NÃO informado (o caso comum: o hóspede autoriza a notificação antes
        // de abrir o chat), tenta achar a conversa daquela sessão — sem isso a
        // inscrição nasce solta e o envio precisa procurá-la depois.
        let conversationId: string | null = null;
        if (!b.conversationId) {
          const { data: existente } = await supabaseAdmin
            .from("property_chat_conversations")
            .select("id")
            .eq("property_id", propertyId)
            .eq("guest_session_id", b.sessionId)
            .order("last_message_at", { ascending: false })
            .limit(1);
          conversationId = ((existente ?? []) as Array<{ id: string }>)[0]?.id ?? null;
        }
        if (b.conversationId) {
          const { data: conv } = await supabaseAdmin
            .from("property_chat_conversations")
            .select("id, property_id, guest_session_id")
            .eq("id", b.conversationId)
            .maybeSingle();
          if (
            conv &&
            (conv as { property_id: string }).property_id === propertyId &&
            (conv as { guest_session_id: string }).guest_session_id === b.sessionId
          ) {
            conversationId = b.conversationId;
          }
        }

        const { error } = await supabaseAdmin.from("guest_push_subscriptions").upsert(
          {
            guest_session_id: b.sessionId,
            property_id: propertyId,
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

        if (error) {
          // Detalhe do banco fica no log do servidor; o visitante recebe só
          // uma mensagem genérica (22/09/2026).
          console.error("[guest-push] falha ao salvar inscrição:", error.message);
          return jsonResponse({ error: "Não foi possível salvar a inscrição." }, 500);
        }
        return jsonResponse({ ok: true });

      },
    },
  },
});
