import { createFileRoute } from "@tanstack/react-router";

/**
 * Cron operacional: dispara notificações push de check-in/check-out.
 * Deve rodar a cada 30 minutos. Protegido por `x-cron-secret` OU pela
 * chave pública (`apikey`) do projeto.
 */
export const Route = createFileRoute("/api/public/cron/ops-push")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const cronSecret = process.env["CRON_SECRET"];
        const anonKey = process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
        const headerSecret = request.headers.get("x-cron-secret");
        const headerApiKey = request.headers.get("apikey");
        const ok =
          (!!cronSecret && headerSecret === cronSecret) || (!!anonKey && headerApiKey === anonKey);
        if (!ok) return new Response("Unauthorized", { status: 401 });

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
