import { createFileRoute } from "@tanstack/react-router";

/**
 * ROTINA DESLIGADA (pedido explícito, 24/09/2026).
 *
 * Regenerava toda semana recomendações "da cidade" sem dono, que nenhum guia
 * mostra — só gastava consultas pagas ao Google. O job do banco
 * (`refresh-city-references-weekly`) foi desativado e esta rota não faz mais
 * nada: se alguém ainda chamar, recebe 410 (Gone). A geração que vale é a de
 * cada imóvel (botão "Gerar" / link do Maps), com o raio de 30 km da
 * residência. Pode ser apagada no Lovable.
 */
export const Route = createFileRoute("/api/public/cron/refresh-city-references")({
  server: {
    handlers: {
      POST: async () =>
        Response.json({ ok: false, error: "rotina desativada em 24/09/2026" }, { status: 410 }),
    },
  },
});
