import { createFileRoute } from "@tanstack/react-router";

/**
 * Cron: varredura de alertas inteligentes da plataforma.
 * Protegido por segredo compartilhado no header `x-cron-secret`.
 */
export const Route = createFileRoute("/api/public/cron/saas-alerts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyCronSecret, unauthorizedCronResponse } = await import("@/lib/cron-auth.server");
        if (!verifyCronSecret(request)) return unauthorizedCronResponse();
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { generateAlerts } = await import("@/lib/ai/alerts/engine.server");
        try {
          const result = await generateAlerts(supabaseAdmin);
          return Response.json({ ok: true, ...result });
        } catch (err) {
          console.error("[cron:saas-alerts]", err);
          return Response.json({ ok: false, error: "scan failed" }, { status: 500 });
        }
      },
    },
  },
});
