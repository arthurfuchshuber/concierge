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
        const { isValidCronSecret } = await import("@/lib/cron-auth.server");
        if (!isValidCronSecret(request)) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        /* O IMÓVEL DE TESTE MORA NO DADO, NÃO NA VARIÁVEL (11/09/2026).
         *
         * A exigência de um imóvel dedicado continua de pé — rodar 21 cenários
         * contra um imóvel com hóspede geraria conversas de teste no painel de
         * alguém. O que mudou foi ONDE essa escolha vive: `properties.
         * ai_evaluation_target`, uma marca no próprio imóvel.
         *
         * Motivo: aquilo nunca foi segredo (é o id de um imóvel do cliente), e
         * como variável de ambiente só o dono do projeto conseguia configurar
         * — num SaaS, cada cliente precisaria abrir um chamado para ligar a
         * própria avaliação.
         *
         * A variável continua valendo e tem prioridade, para não quebrar quem
         * já a tiver configurado. */
        const doAmbiente = (process.env["AI_EVALUATION_PROPERTY_IDS"] ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

        let propertyIds = doAmbiente;
        if (!propertyIds.length) {
          const { data: marcados } = await supabaseAdmin
            .from("properties")
            .select("id")
            .eq("ai_evaluation_target", true)
            .limit(10);
          propertyIds = ((marcados ?? []) as Array<{ id: string }>).map((p) => p.id);
        }

        if (!propertyIds.length) {
          /* O SILÊNCIO ERA O PROBLEMA (11/09/2026).
           *
           * A decisão de exigir um imóvel dedicado continua certa: rodar os 21
           * cenários contra um imóvel real geraria conversas de teste, uso de
           * memória e ruído no painel de um anfitrião de verdade. Escolher "no
           * escuro" seria pior do que não rodar.
           *
           * O que estava errado era o jeito de não rodar: um `console.warn`
           * que ninguém lê e um `ok: true` que parece sucesso. Resultado — a
           * suíte ficou agendada e inerte, e ninguém soube. Agora a ausência
           * vira alerta no painel, uma vez por semana, com o texto do que
           * fazer. Um sistema que precisa de configuração tem que PEDIR. */
          try {
            const seteDiasAtras = new Date(Date.now() - 7 * 864e5).toISOString();
            const { data: jaAvisado } = await supabaseAdmin
              .from("ai_alerts")
              .select("id")
              .eq("kind", "evaluation_suite_off")
              .eq("status", "open")
              .gte("created_at", seteDiasAtras)
              .limit(1);

            if (!((jaAvisado ?? []) as unknown[]).length) {
              const { data: donos } = await supabaseAdmin
                .from("properties")
                .select("owner_id")
                .eq("published", true)
                .limit(200);
              const tenants = [
                ...new Set(
                  ((donos ?? []) as Array<{ owner_id: string | null }>)
                    .map((d) => d.owner_id)
                    .filter(Boolean),
                ),
              ] as string[];

              for (const tenantId of tenants.slice(0, 20)) {
                await supabaseAdmin.from("ai_alerts").insert({
                  tenant_id: tenantId,
                  kind: "evaluation_suite_off",
                  severity: "warning",
                  status: "open",
                  title: "A avaliação automática da IA está desligada",
                  detail:
                    "Os 21 cenários de regressão não rodam porque nenhum imóvel está marcado como imóvel " +
                    "de teste da IA. Marque um imóvel SEM hóspedes (um despublicado serve) e a avaliação " +
                    "passa a rodar toda semana. Sem isso, uma piora na qualidade da IA só aparece quando " +
                    "um hóspede reclama.",
                });
              }
            }
          } catch (e) {
            console.error("[cron:evaluation-suite] falha ao registrar alerta", e);
          }

          console.warn(
            "[cron:evaluation-suite] AI_EVALUATION_PROPERTY_IDS não configurada — nada para rodar. " +
              "Configure com o(s) UUID(s) de imóvel(is) dedicados a QA para ativar a regressão automática.",
          );
          return Response.json({
            ok: true,
            skipped: true,
            reason: "AI_EVALUATION_PROPERTY_IDS não configurada",
            alerta: "registrado no painel",
          });
        }

        const { runEvaluationSuite } = await import("@/lib/ai/evaluation/engine.server");

        const results: Array<{
          propertyId: string;
          ok: boolean;
          error?: string;
          summary?: unknown;
        }> = [];
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
              console.warn(
                `[cron:evaluation-suite] ${run.failed} cenário(s) reprovado(s) para o imóvel ${propertyId}`,
              );
            }
          } catch (err) {
            console.error(`[cron:evaluation-suite] falhou para o imóvel ${propertyId}`, err);
            results.push({
              propertyId,
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        return Response.json({ ok: true, ranProperties: propertyIds.length, results });
      },
    },
  },
});
