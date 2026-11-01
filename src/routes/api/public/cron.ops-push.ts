import { createFileRoute } from "@tanstack/react-router";

/**
 * Cron operacional: dispara notificações push de check-in/check-out.
 * Deve rodar a cada 30 minutos. Protegido pelo segredo `x-cron-secret`.
 */
export const Route = createFileRoute("/api/public/cron/ops-push")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyCronSecret, unauthorizedCronResponse } = await import("@/lib/cron-auth.server");
        if (!verifyCronSecret(request)) return unauthorizedCronResponse();

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runOpsPushScan } = await import("@/lib/ops-push.server");
        try {
          const result = await runOpsPushScan(supabaseAdmin);
          return Response.json({ ok: true, ...result });
        } catch (err) {
          console.error("[cron:ops-push]", err);
          return Response.json({ ok: false, error: "scan failed" }, { status: 500 });
        }
      },
    },
  },
});
