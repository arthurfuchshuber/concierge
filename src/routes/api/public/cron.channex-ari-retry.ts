import { createFileRoute } from "@tanstack/react-router";

/**
 * Retentativa automática da outbox ARI da Channex (a cada 1 min via pg_cron).
 * Só processa itens `pending` com `next_attempt_at` vencido; nunca faz full
 * sync nem reenvia itens já enviados. O limitador 20/min continua valendo.
 */
export const Route = createFileRoute("/api/public/cron/channex-ari-retry")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { isValidCronSecret } = await import("@/lib/cron-auth.server");
        if (!isValidCronSecret(request)) return new Response("Unauthorized", { status: 401 });
        const { flushAriOutbox } = await import("@/lib/channex-ari.server");
        try {
          const ari = await flushAriOutbox();
          // Mesma batida de 1 min: sincroniza entidades/anúncios Channex (throttle de 5 min no banco).
          const { syncChannexEntities } = await import("@/lib/channex-entity-sync.server");
          await syncChannexEntities({ source: "cron" }).catch((e) => console.error("[cron:channex-entity-sync]", e));
          return Response.json({ ok: true, batches: ari.batches.length });
        } catch (err) {
          console.error("[cron:channex-ari-retry]", err);
          return Response.json({ ok: false }, { status: 500 });
        }
      },
    },
  },
});
