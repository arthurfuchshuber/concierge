import { createFileRoute } from "@tanstack/react-router";

/**
 * Cron: confirma automaticamente o checkout de um card assim que o horário
 * PREVISTO (definido pelo anfitrião, ou informado pelo hóspede) chega, no
 * fuso horário local do imóvel. Pedido explícito (06/09/2026). Ver
 * `runAutoCheckoutScan` em `src/lib/auto-checkout.server.ts` pra lógica
 * completa. Deve rodar a cada 5 minutos — protegido por `x-cron-secret`.
 */
export const Route = createFileRoute("/api/public/cron/auto-checkout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { isValidCronSecret } = await import("@/lib/cron-auth.server");
        if (!isValidCronSecret(request)) {
          return new Response("Unauthorized", { status: 401 });
        }
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
