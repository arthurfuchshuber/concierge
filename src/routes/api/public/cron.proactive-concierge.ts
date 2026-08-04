import { createFileRoute } from "@tanstack/react-router";

/**
 * Cron público — Inteligência Proativa + rollup de métricas da IA.
 * Varre reservas/histórico de todos os tenants, gera ações antecipadas
 * respeitando o limite de autonomia e consolida as métricas do período.
 */
export const Route = createFileRoute("/api/public/cron/proactive-concierge")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("x-cron-secret") ?? "";
        const expected = process.env.CRON_SECRET ?? "";
        if (!expected) return new Response("Unauthorized", { status: 401 });
        const enc = new TextEncoder();
        const a = enc.encode(provided.padEnd(expected.length, "\0").slice(0, expected.length));
        const b = enc.encode(expected);
        let diff = provided.length !== expected.length ? 1 : 0;
        for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
        if (diff !== 0) return new Response("Unauthorized", { status: 401 });

        let propertyLimit = 50;
        try {
          const body = (await request.json()) as { propertyLimit?: number };
          if (typeof body?.propertyLimit === "number" && body.propertyLimit > 0) {
            propertyLimit = Math.min(body.propertyLimit, 200);
          }
        } catch {
          // body opcional
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { scanProactiveOpportunities } = await import("@/lib/ai/agents/proactive/engine.server");
          const { computeOperationalMetrics } = await import("@/lib/ai/observability/metrics.server");

          const scan = await scanProactiveOpportunities({ supabase: supabaseAdmin, propertyLimit });

          const { data: owners } = await supabaseAdmin
            .from("properties")
            .select("owner_id")
            .eq("published", true)
            .limit(500);
          const tenantIds = [...new Set((owners ?? []).map((o) => o.owner_id).filter(Boolean))] as string[];
          for (const tenantId of tenantIds.slice(0, 100)) {
            await computeOperationalMetrics({ supabase: supabaseAdmin, tenantId, days: 1 });
          }

          return Response.json({ ok: true, scan, tenantsMeasured: tenantIds.length });
        } catch (err) {
          console.error("[cron] proactive-concierge falhou", err);
          return Response.json({ ok: false, error: String(err) }, { status: 500 });
        }
      },
    },
  },
});
