import { createFileRoute } from "@tanstack/react-router";

/** Reconciliação fiscal: varre `sent` órfão, consome webhooks pendentes e consulta o provedor. Nunca reenvia. Protegido por `x-cron-secret`. */
export const Route = createFileRoute("/api/public/cron/fiscal-reconcile")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyCronSecret, unauthorizedCronResponse } = await import("@/lib/cron-auth.server");
        if (!verifyCronSecret(request)) return unauthorizedCronResponse();
        try {
          const { adminDb, runReconciliation } = await import("@/lib/fiscal/service.server");
          return Response.json({ ok: true, ...(await runReconciliation(await adminDb())) });
        } catch (err) {
          console.error("[cron:fiscal-reconcile]", err);
          return Response.json({ ok: false, error: "reconcile failed" }, { status: 500 });
        }
      },
    },
  },
});
