import { createFileRoute } from "@tanstack/react-router";

/**
 * Registro mensal do corte de cobrança (todo dia 25, pelo pg_cron). Guarda, para cada conta (isenta ou não),
 * os anúncios ativos e o valor do mês, para o extrato nunca depender do plano de hoje.
 */
export const Route = createFileRoute("/api/public/cron/billing-snapshot")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyCronSecret, unauthorizedCronResponse } = await import("@/lib/cron-auth.server");
        if (!verifyCronSecret(request)) return unauthorizedCronResponse();
        try {
          const { runBillingSnapshots } = await import("@/lib/billing/billing-snapshot.server");
          const r = await runBillingSnapshots(40_000);
          return Response.json({ ok: true, ...r });
        } catch (err) {
          console.error("[cron:billing-snapshot]", err);
          return Response.json({ ok: false }, { status: 500 });
        }
      },
    },
  },
});
