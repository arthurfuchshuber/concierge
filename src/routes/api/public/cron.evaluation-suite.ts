import { createFileRoute } from "@tanstack/react-router";

/**
 * Cron: AI Agent Evaluation Engine (Regression Testing).
 *
 * O motor de avaliação (`evaluation/engine.server.ts`) já roda os cenários da
 * biblioteca (`evaluation/scenarios.ts`) contra o pipeline REAL de produção e
 * compara com o comportamento esperado — mas, até esta correção, nada nunca o
 * disparava sozinho: só existia um gatilho manual (`runAiEvaluation`, sem UI
 * conectada). Este cron fecha essa lacuna.
 *
 * IMPORTANTE — escolha da propriedade: o motor precisa rodar contra um imóvel
 * real (usa o guia, o RAG e a memória daquele imóvel de verdade). Não temos
 * como cron escolher automaticamente uma propriedade de um anfitrião real sem
 * risco de gerar ruído nos dados/dashboard dele (conversas de teste, uso de
 * memória, etc.), mesmo rodando com `surface: "evaluation"`. Por isso, este
 * cron só executa se `AI_EVALUATION_PROPERTY_IDS` estiver configurada (lista
 * separada por vírgula de UUIDs de imóveis dedicados a QA) — sem isso, ele
 * roda em modo no-op e avisa no log, em vez de escolher uma propriedade real
 * "no escuro".
 *
 * Protegido por segredo compartilhado no header `x-cron-secret`, mesmo padrão
 * dos demais crons deste projeto.
 */
export const Route = createFileRoute("/api/public/cron/evaluation-suite")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["CRON_SECRET"];
        if (!secret || request.headers.get("x-cron-secret") !== secret) {
          return new Response("Unauthorized", { status: 401 });
        }

        const propertyIds = (process.env["AI_EVALUATION_PROPERTY_IDS"] ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

        if (!propertyIds.length) {
          console.warn(
            "[cron:evaluation-suite] AI_EVALUATION_PROPERTY_IDS não configurada — nada para rodar. " +
              "Configure com o(s) UUID(s) de imóvel(is) dedicados a QA para ativar a regressão automática.",
          );
          return Response.json({ ok: true, skipped: true, reason: "AI_EVALUATION_PROPERTY_IDS não configurada" });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runEvaluationSuite } = await import("@/lib/ai/evaluation/engine.server");

        const results: Array<{ propertyId: string; ok: boolean; error?: string; summary?: unknown }> = [];
        for (const propertyId of propertyIds) {
          try {
            const run = await runEvaluationSuite({
              supabase: supabaseAdmin,
              propertyId,
              suite: "all",
              compareWithBaseline: true,
            });
            results.push({
              propertyId,
              ok: true,
              summary: {
                total: run.total,
                passed: run.passed,
                warning: run.warning,
                failed: run.failed,
                averageQuality: run.averageQuality,
              },
            });
            if (run.failed > 0) {
              console.warn(`[cron:evaluation-suite] ${run.failed} cenário(s) reprovado(s) para o imóvel ${propertyId}`);
            }
          } catch (err) {
            console.error(`[cron:evaluation-suite] falhou para o imóvel ${propertyId}`, err);
            results.push({ propertyId, ok: false, error: err instanceof Error ? err.message : String(err) });
          }
        }

        return Response.json({ ok: true, ranProperties: propertyIds.length, results });
      },
    },
  },
});
