import { createFileRoute } from "@tanstack/react-router";

/**
 * Cron: sobe para `ai_system_docs` o conhecimento que o extrator gerou no
 * build. É o passo que faz o Assistente do Painel conhecer o que entrou na
 * última entrega — sem ele, a base fica congelada na data da primeira
 * indexação (pedido explícito, 07/09/2026).
 *
 * Barato de repetir: só reprocessa o trecho cujo `content_hash` mudou, então
 * uma execução sem novidades não gasta embedding nenhum. Rodar uma vez por
 * dia basta; o ideal é chamar também logo após cada deploy.
 *
 * Protegido por `x-cron-secret`, igual aos outros crons.
 */
export const Route = createFileRoute("/api/public/cron/reindex-system-knowledge")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { isValidCronSecret } = await import("@/lib/cron-auth.server");
        if (!isValidCronSecret(request)) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { reindexSystemKnowledge } = await import("@/lib/ai/system-knowledge.server");
        try {
          const result = await reindexSystemKnowledge(supabaseAdmin);
          return Response.json({ ok: true, ...result });
        } catch (err) {
          console.error("[cron:reindex-system-knowledge]", err);
          return Response.json({ ok: false, error: "reindex failed" }, { status: 500 });
        }
      },
    },
  },
});
