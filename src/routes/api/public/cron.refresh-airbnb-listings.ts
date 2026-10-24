import { createFileRoute } from "@tanstack/react-router";

// Revisão diária (reativada 22/10/2026): só a FOTO DE CAPA do anúncio, lida
// nativamente da página pública (sem Firecrawl, sem IA — custo zero). Cada
// imóvel fica com uma única foto. Demais dados seguem sincronização manual.
export const Route = createFileRoute("/api/public/cron/refresh-airbnb-listings")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { isValidCronSecret } = await import("@/lib/cron-auth.server");
        if (!isValidCronSecret(request)) {
          return new Response("Unauthorized", { status: 401 });
        }
        try {
          const { refreshAllListingCovers } = await import("@/lib/airbnb-cover.server");
          const covers = await refreshAllListingCovers();
          // Releitura diária do anúncio público (custo zero): capacidade, cômodos, regras,
          // segurança, descrição e comodidades. Só regrava/reindexa quando algo mudou.
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { scrapePublicListingForProperty } = await import("@/lib/channex-listing.server");
          const { data } = await supabaseAdmin
            .from("property_listing_raw_data" as never)
            .select("property_id, airbnb_listing_id")
            .not("airbnb_listing_id", "is", null)
            .is("sync_paused_at", null);
          let listingsChanged = 0;
          for (const r of (data ?? []) as Array<{ property_id: string }>) {
            const res = await scrapePublicListingForProperty(r.property_id, { onlyIfChanged: true }).catch(() => null);
            if (res?.changed) listingsChanged++;
          }
          return Response.json({ ok: true, ...covers, listingsChanged });
        } catch (err) {
          console.error("[cron:refresh-airbnb-listings]", err);
          return Response.json({ ok: false }, { status: 500 });
        }
      },
    },
  },
});
