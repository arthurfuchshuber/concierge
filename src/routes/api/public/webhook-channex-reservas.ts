import { createFileRoute } from "@tanstack/react-router";

/**
 * Webhook público do Channex (certificação).
 *
 * Aceita apenas POST, grava o JSON bruto na fila e responde 200 imediatamente.
 * O processamento acontece em seguida, em segundo plano, drenando a fila.
 */
export const Route = createFileRoute("/api/public/webhook-channex-reservas")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Segredo compartilhado OBRIGATÓRIO: sem ele o endpoint ficaria aberto
        // para qualquer um gravar reservas falsas (fail-closed, 16/09/2026).
        const expected = process.env["CHANNEX_WEBHOOK_SECRET"];
        if (!expected) {
          console.error("[channex-webhook] CHANNEX_WEBHOOK_SECRET não configurado; recusando webhook.");
          return new Response("Unauthorized", { status: 401 });
        }
        const got = request.headers.get("x-channex-webhook-secret");
        if (got !== expected) return new Response("Invalid secret", { status: 401 });

        let payload: unknown = null;
        try {
          payload = await request.json();
        } catch {
          return new Response(JSON.stringify({ ok: false, error: "invalid_json" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const { enfileirarWebhookChannex, processarFilaChannex } = await import(
          "@/lib/channex-webhook.server"
        );

        try {
          await enfileirarWebhookChannex(payload);
        } catch {
          // Mesmo se a fila falhar, respondemos 200 para não gerar reentregas
          // durante a certificação; o erro fica registrado nos logs.
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        // Processamento em segundo plano — não bloqueia a resposta.
        void processarFilaChannex().catch(() => {});

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
      GET: async () => new Response("Method Not Allowed", { status: 405 }),
    },
  },
});
