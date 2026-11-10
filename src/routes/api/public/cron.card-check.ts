import { createFileRoute } from "@tanstack/react-router";

/**
 * Verificação mensal do cartão (todo dia 20, pelo pg_cron). Confirma o cartão salvo de cada conta
 * sem cobrar e grava o resultado; falha vira aviso na tela da conta.
 */
export const Route = createFileRoute("/api/public/cron/card-check")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyCronSecret, unauthorizedCronResponse } = await import("@/lib/cron-auth.server");
        if (!verifyCronSecret(request)) return unauthorizedCronResponse();
        try {
          const { runMonthlyCardChecks } = await import("@/lib/billing/card-check.server");
          const r = await runMonthlyCardChecks(40_000);
          return Response.json({ ok: true, ...r });
        } catch (err) {
          console.error("[cron:card-check]", err);
          return Response.json({ ok: false }, { status: 500 });
        }
      },
    },
  },
});
