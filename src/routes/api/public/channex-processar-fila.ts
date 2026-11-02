import { createFileRoute } from "@tanstack/react-router";
import { safeEqual, verifyCronSecret } from "@/lib/cron-auth.server";

/**
 * Drena as filas da Channex (webhooks recebidos + outbox ARI com retries
 * pendentes). Protegido por chave: exige o header `user-api-key` igual à
 * chave Channex configurada no servidor.
 */
export const Route = createFileRoute("/api/public/channex-processar-fila")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = (process.env["CHANNEX_API_KEY"] ?? process.env["CHANNEX_STAGING_API_KEY"]);
        // Comparação em TEMPO CONSTANTE (sem canal lateral por tempo); aceita a chave Channex (histórico)
        // ou o segredo padrão dos crons (Authorization: Bearer / x-cron-secret).
        const provided = request.headers.get("user-api-key") ?? "";
        const okChannex = !!key && !!provided && safeEqual(provided, key);
        if (!okChannex && !verifyCronSecret(request)) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { processarFilaChannex } = await import("@/lib/channex-webhook.server");
        const { flushAriOutbox } = await import("@/lib/channex-ari.server");
        const webhooks = await processarFilaChannex(50);
        const ari = await flushAriOutbox();
        return Response.json({ webhooks, ari });
      },
    },
  },
});
