import { createFileRoute } from "@tanstack/react-router";

// Revisão 4x ao dia (03h, 09h, 15h e 21h UTC), custo zero (sem Firecrawl, sem IA):
// 1) releitura completa da Channex (08/11/2026): horários de check-in/out, taxas,
//    hóspedes incluídos e reserva instantânea chegam ao dossiê mesmo sem nenhum
//    webhook — a Channex não avisa quando o anfitrião edita o anúncio no Airbnb;
// 2) foto de capa e 3) releitura da página pública do anúncio.
export const Route = createFileRoute("/api/public/cron/refresh-airbnb-listings")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyCronSecret, unauthorizedCronResponse } = await import("@/lib/cron-auth.server");
        if (!verifyCronSecret(request)) return unauthorizedCronResponse();
        // Falha na Channex nunca impede capa/página pública (e vice-versa).
        let channex: { listingsUpdated: number; changed: number } | null = null;
        try {
          const { syncChannexEntities } = await import("@/lib/channex-entity-sync.server");
          const r = await syncChannexEntities({ force: true, source: "cron:4x-dia" });
          channex = { listingsUpdated: r.listingsUpdated, changed: r.changed };
        } catch (err) {
          console.error("[cron:refresh-airbnb-listings] releitura da Channex", err);
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
          return Response.json({ ok: true, ...covers, listingsChanged, channex });
        } catch (err) {
          console.error("[cron:refresh-airbnb-listings]", err);
          return Response.json({ ok: false }, { status: 500 });
        }
      },
    },
  },
});
