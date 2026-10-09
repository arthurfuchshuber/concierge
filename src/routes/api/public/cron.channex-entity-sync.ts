import { createFileRoute } from "@tanstack/react-router";

/**
 * Sincronização contínua (a cada 5 min via pg_cron) de todas as entidades da
 * Channex e do catálogo de anúncios dos canais. Somente leitura + renomear
 * quartos para o título do anúncio; nunca envia preço/disponibilidade.
 */
export const Route = createFileRoute("/api/public/cron/channex-entity-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { isValidCronSecret } = await import("@/lib/cron-auth.server");
        if (!isValidCronSecret(request)) return new Response("Unauthorized", { status: 401 });
        try {
          const { syncChannexEntities } = await import("@/lib/channex-entity-sync.server");
          return Response.json({ ok: true, ...(await syncChannexEntities({ source: "cron" })) });
        } catch (err) {
          console.error("[cron:channex-entity-sync]", err);
          return Response.json({ ok: false }, { status: 500 });
        }
      },
    },
  },
});
