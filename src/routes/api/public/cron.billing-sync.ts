import { createFileRoute } from "@tanstack/react-router";

/**
 * Processa a fila `billing_sync_queue` (cobrança por anúncio na Stripe). Chamado na hora pelo
 * gatilho do banco quando um anúncio entra/sai e, como reserva, pelo pg_cron só quando há item
 * vencido na fila. Só sincroniza contas enfileiradas; nunca varre todas as assinaturas.
 */
export const Route = createFileRoute("/api/public/cron/billing-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyCronSecret, unauthorizedCronResponse } = await import("@/lib/cron-auth.server");
        if (!verifyCronSecret(request)) return unauthorizedCronResponse();
        try {
          const { processBillingQueue } = await import("@/lib/billing/billing-sync.server");
          const r = await processBillingQueue(20_000);
          return Response.json({ ok: true, ...r });
        } catch (err) {
          console.error("[cron:billing-sync]", err);
          return Response.json({ ok: false }, { status: 500 });
        }
      },
    },
  },
});
