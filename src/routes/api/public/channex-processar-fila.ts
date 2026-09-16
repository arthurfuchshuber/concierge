import { createFileRoute } from "@tanstack/react-router";

/**
 * Drena a fila de webhooks do Channex (rede de segurança para itens que
 * ficaram pendentes). Protegido por chave: exige o header `user-api-key`
 * com o mesmo valor da chave do Channex configurada no servidor.
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
        const result = await processarFilaChannex(50);
        return Response.json(result);
      },
    },
  },
});
