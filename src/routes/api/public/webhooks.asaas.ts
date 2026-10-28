import { createFileRoute } from "@tanstack/react-router";

/**
 * Webhook do Asaas (envio sequencial). Valida o token `asaas-access-token` e, a cada aviso,
 * puxa só o extrato recente (incremental, idempotente). Substitui a busca periódica.
 */
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export const Route = createFileRoute("/api/public/webhooks/asaas")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["ASAAS_WEBHOOK_SECRET"];
        const token = request.headers.get("asaas-access-token") ?? "";
        if (!secret || !safeEqual(token, secret)) return new Response("Unauthorized", { status: 401 });
        try {
          const { syncAsaas } = await import("@/lib/asaas.server");
          await syncAsaas();
          return Response.json({ received: true });
        } catch (err) {
          console.error("[webhook:asaas]", err);
          // 500 faz o Asaas reenviar (fila sequencial), sem perder o aviso.
          return Response.json({ received: false }, { status: 500 });
        }
      },
    },
  },
});
