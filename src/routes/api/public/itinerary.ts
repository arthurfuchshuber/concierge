import { createFileRoute } from "@tanstack/react-router";
import { tooManyRequests, rateLimitedResponse } from "@/lib/public-rate-limit.server";

/**
 * Leitura pública do roteiro do hóspede — usado pela tela "Meu roteiro" no
 * guia. O roteiro contém dados pessoais (planos da estadia), então NÃO basta
 * o nome: exigimos a sessão do hóspede (sessionId) e conferimos que ela
 * pertence a esta propriedade. O nome usado na chave vem do servidor
 * (conversa/registro de acesso), nunca do parâmetro enviado pelo navegador —
 * caso contrário qualquer pessoa leria o roteiro de outro hóspede apenas
 * adivinhando o nome.
 */
export const Route = createFileRoute("/api/public/itinerary")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (tooManyRequests(request, "itinerary", 30, 60_000)) return rateLimitedResponse();
        const url = new URL(request.url);
        const slug = url.searchParams.get("slug") ?? "";
        const sessionId = (url.searchParams.get("sessionId") ?? "").trim();
        if (!/^[a-z0-9-]{1,64}$/.test(slug) || sessionId.length < 8 || sessionId.length > 200) {
          return new Response(JSON.stringify({ error: "invalid" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { guestKeyOf } = await import("@/lib/ai/memory.server");
        const { getItinerary } = await import("@/lib/ai/itinerary.server");

        const { data: prop } = await supabaseAdmin
          .from("properties")
          .select("id")
          .eq("slug", slug)
          .maybeSingle();
        if (!prop) {
          return new Response(JSON.stringify({ error: "not_found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }

        const propertyId = (prop as { id: string }).id;

        // A sessão precisa existir nesta propriedade.
        const { data: conv } = await supabaseAdmin
          .from("property_chat_conversations")
          .select("guest_name")
          .eq("property_id", propertyId)
          .eq("guest_session_id", sessionId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!conv) {
          return new Response(JSON.stringify({ days: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        const serverName = (conv as { guest_name?: string | null } | null)?.guest_name ?? "";

        const guestKey = guestKeyOf(sessionId, serverName);
        const days = await getItinerary({ supabase: supabaseAdmin, propertyId, guestKey });

        return new Response(JSON.stringify({ days }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
