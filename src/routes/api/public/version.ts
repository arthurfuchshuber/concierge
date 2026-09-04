import { createFileRoute } from "@tanstack/react-router";

/**
 * Versão da build em execução no servidor. O navegador de cada usuário
 * compara este valor com o da build que ele carregou; se mudar, a página
 * é recarregada automaticamente.
 */
export const Route = createFileRoute("/api/public/version")({
  server: {
    handlers: {
      GET: async () => {
        return new Response(
          JSON.stringify({ buildId: __APP_BUILD_ID__ }),
          {
            headers: {
              "content-type": "application/json",
              "cache-control": "no-store, no-cache, must-revalidate",
            },
          },
        );
      },
    },
  },
});
