import { createFileRoute } from "@tanstack/react-router";

/**
 * Cron: confirma automaticamente o checkout de um card pendente no dia da
 * saída, ao atingir o horário PREVISTO no card (equipe antecipa ou estende;
 * hóspede/IA só antecipam) ou, sem previsão, o horário limite OFICIAL do
 * imóvel (ou o late checkout formal, teto de qualquer previsão), no fuso
 * local do imóvel (titular, 08/11/2026). Ver `runAutoCheckoutScan`
 * em `src/lib/auto-checkout.server.ts`. Deve rodar a cada 5 minutos —
 * protegido por `x-cron-secret`.
 */
export const Route = createFileRoute("/api/public/cron/auto-checkout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyCronSecret, unauthorizedCronResponse } = await import("@/lib/cron-auth.server");
        if (!verifyCronSecret(request)) return unauthorizedCronResponse();
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runAutoCheckoutScan } = await import("@/lib/auto-checkout.server");
        try {
          const result = await runAutoCheckoutScan(supabaseAdmin);
          return Response.json({ ok: true, ...result });
        } catch (err) {
          console.error("[cron:auto-checkout]", err);
          return Response.json({ ok: false, error: "scan failed" }, { status: 500 });
        }
      },
    },
  },
});
