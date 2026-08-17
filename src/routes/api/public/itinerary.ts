import { createFileRoute } from "@tanstack/react-router";

/**
 * Leitura pública do roteiro do hóspede — usado pela tela "Meu roteiro" no
 * guia. Identificação pelo mesmo padrão de guestKey usado no resto da
 * memória (nome do hóspede, quando disponível) — sem exigir login, já que é
 * um link público de guia, mas restrito à propriedade certa via slug.
 */
export const Route = createFileRoute("/api/public/itinerary")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const slug = url.searchParams.get("slug") ?? "";
        const guestName = url.searchParams.get("guestName") ?? "";
        if (!/^[a-z0-9-]{1,64}$/.test(slug) || !guestName.trim()) {
          return new Response(JSON.stringify({ error: "invalid" }), { status: 400, headers: { "Content-Type": "application/json" } });
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
          return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "Content-Type": "application/json" } });
        }

        const guestKey = guestKeyOf("", guestName);
        const days = await getItinerary({ supabase: supabaseAdmin, propertyId: prop.id as string, guestKey });

        return new Response(JSON.stringify({ days }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    },
  },
});
