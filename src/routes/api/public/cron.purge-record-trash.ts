import { createFileRoute } from "@tanstack/react-router";

/**
 * Cron diário: apaga de vez os registros que ficaram 30 dias na lixeira
 * oculta (pedido explícito, 04/10/2026). Protegido por `x-cron-secret`.
 */
export const Route = createFileRoute("/api/public/cron/purge-record-trash")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { isValidCronSecret } = await import("@/lib/cron-auth.server");
        if (!isValidCronSecret(request)) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { purgeExpiredRecordTrash } = await import("@/lib/record-trash.server");
        try {
          const result = await purgeExpiredRecordTrash(supabaseAdmin as never);
          return Response.json({ ok: true, ...result });
        } catch (err) {
          console.error("[cron:purge-record-trash]", err);
          return Response.json({ ok: false, error: "purge failed" }, { status: 500 });
        }
      },
    },
  },
});
