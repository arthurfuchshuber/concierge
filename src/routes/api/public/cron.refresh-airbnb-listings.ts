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
          return Response.json({ ok: true, ...(await refreshAllListingCovers()) });
        } catch (err) {
          console.error("[cron:refresh-airbnb-listings]", err);
          return Response.json({ ok: false }, { status: 500 });
        }
      },
    },
  },
});
