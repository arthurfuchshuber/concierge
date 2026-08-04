import { createFileRoute } from "@tanstack/react-router";

/**
 * Cron: Continuous Learning Loop.
 * Analisa conversas encerradas, extrai conhecimento (pendente de aprovação
 * humana), consolida lacunas, atualiza pesos de memória, mede impacto e
 * propõe melhorias de prompt.
 * Protegido por segredo compartilhado no header `x-cron-secret`.
 */
export const Route = createFileRoute("/api/public/cron/learning-loop")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["CRON_SECRET"];
        if (!secret || request.headers.get("x-cron-secret") !== secret) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { sweepLearningLoop } = await import("@/lib/ai/learning/loop.server");
        const { refreshAgentLearningMetrics } = await import("@/lib/ai/learning/agent-performance.server");
        const { measureLearningImpact } = await import("@/lib/ai/learning/impact.server");
        const { quarantineFailingMemories } = await import("@/lib/ai/learning/memory-intelligence.server");
        const { proposePromptImprovement } = await import("@/lib/ai/learning/prompt-optimizer.server");

        try {
          const sweep = await sweepLearningLoop({ supabase: supabaseAdmin, hours: 24, limit: 25 });

          // Tenants ativos nas últimas 24h recebem métricas, impacto e higiene de memória.
          const since = new Date(Date.now() - 86_400_000).toISOString();
          const { data } = await supabaseAdmin
            .from("ai_agent_logs")
            .select("tenant_id, owner_id")
            .gte("created_at", since)
            .limit(2000);

          const tenants = new Map<string, string>();
          for (const row of (data ?? []) as Array<Record<string, unknown>>) {
            const tenantId = String(row.tenant_id ?? row.owner_id ?? "");
            if (tenantId) tenants.set(tenantId, String(row.owner_id ?? tenantId));
          }

          let quarantined = 0;
          for (const [tenantId, ownerId] of tenants) {
            await refreshAgentLearningMetrics({ supabase: supabaseAdmin, tenantId, ownerId, days: 7 }).catch(
              () => undefined,
            );
            await measureLearningImpact({ supabase: supabaseAdmin, tenantId }).catch(() => undefined);
            quarantined += await quarantineFailingMemories({ supabase: supabaseAdmin, tenantId }).catch(() => 0);
            await proposePromptImprovement({ supabase: supabaseAdmin, tenantId }).catch(() => null);
          }

          return Response.json({ ok: true, ...sweep, tenants: tenants.size, quarantined });
        } catch (err) {
          console.error("[cron:learning-loop]", err);
          return Response.json({ ok: false, error: "learning loop failed" }, { status: 500 });
        }
      },
    },
  },
});
