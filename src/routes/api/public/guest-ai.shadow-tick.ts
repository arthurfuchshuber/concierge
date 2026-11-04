import { createFileRoute } from "@tanstack/react-router";

/**
 * Shadow Mode do ConciergeIA Guest (F2-B · B3.3). DESLIGADO: com `GUEST_AI_SHADOW` diferente de `on`
 * responde 404 sem ler nada; com a chave ligada exige o segredo de cron e, nesta entrega, ainda
 * responde `not_released` (portão em código). Nunca envia mensagem, nunca devolve texto: só códigos e
 * contadores. Não é uma server function (fora do middleware que grava argumentos). Nenhum cron está
 * configurado para chamá-la. Ver `src/lib/guest-ai/shadow-exec/tick.server.ts`.
 */
export const Route = createFileRoute("/api/public/guest-ai/shadow-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { handleShadowTick } = await import("@/lib/guest-ai/shadow-exec/tick.server");
          return await handleShadowTick(request);
        } catch {
          return Response.json({ error: "tick_failed" }, { status: 500 });
        }
      },
    },
  },
});
