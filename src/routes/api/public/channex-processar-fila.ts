import { createFileRoute } from "@tanstack/react-router";

/**
 * Drena as filas da Channex (webhooks recebidos + outbox ARI com retries
 * pendentes). Protegido por chave: exige o header `user-api-key` igual à
 * chave Channex configurada no servidor.
 */
export const Route = createFileRoute("/api/public/channex-processar-fila")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env["CHANNEX_STAGING_API_KEY"];
        if (!key || request.headers.get("user-api-key") !== key) {
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
