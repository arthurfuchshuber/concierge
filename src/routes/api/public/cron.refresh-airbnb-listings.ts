import { createFileRoute } from "@tanstack/react-router";

// DESLIGADO (27/09/2026) a pedido do cliente: a atualização do anúncio do
// Airbnb consome créditos do Firecrawl e passa a acontecer SOMENTE quando o
// usuário clica em Importar/Sincronizar no editor do imóvel. O agendamento
// no banco também foi desativado. Este endpoint não executa mais nada.
export const Route = createFileRoute("/api/public/cron/refresh-airbnb-listings")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { isValidCronSecret } = await import("@/lib/cron-auth.server");
        if (!isValidCronSecret(request)) {
          return new Response("Unauthorized", { status: 401 });
        }
        return Response.json({ ok: true, disabled: true, reason: "sincronização apenas manual" });
      },
    },
  },
});
