import { createFileRoute } from "@tanstack/react-router";

/**
 * Cron: avisa o dono da conta quando o gasto de IA do dia passa muito do normal.
 * Só avisa (push); nunca limita nem bloqueia. Protegido pelo segredo dos crons. Sugestão: a cada hora.
 */
export const Route = createFileRoute("/api/public/cron/ai-cost-alert")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyCronSecret, unauthorizedCronResponse } = await import("@/lib/cron-auth.server");
        if (!verifyCronSecret(request)) return unauthorizedCronResponse();

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runAiCostAlertScan } = await import("@/lib/ai/cost-alert.server");
        try {
          const result = await runAiCostAlertScan(supabaseAdmin);
          return Response.json({ ok: true, ...result });
        } catch (err) {
          console.error("[cron:ai-cost-alert]", err);
          return Response.json({ ok: false, error: "scan failed" }, { status: 500 });
        }
      },
    },
  },
});
