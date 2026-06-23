import { createFileRoute } from "@tanstack/react-router";
import { runCityGeneration } from "@/lib/city-references.functions";
import { cityKey, normalizeState } from "@/lib/city-key";

// Cron público: atualiza referências macro por cidade. Por padrão, regenera
// cidades cujo último refresh foi há mais de 7 dias (ou nunca).
export const Route = createFileRoute("/api/public/cron/refresh-city-references")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("x-cron-secret") ?? "";
        const expected = process.env.CRON_SECRET ?? "";
        if (!expected || provided.length !== expected.length) {
          return new Response("Unauthorized", { status: 401 });
        }
        let diff = 0;
        for (let i = 0; i < expected.length; i++) {
          diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
        }
        if (diff !== 0) return new Response("Unauthorized", { status: 401 });

        let maxAgeDays = 7;
        let limit = 20;
        try {
          const body = (await request.json()) as { maxAgeDays?: number; limit?: number };
          if (typeof body?.maxAgeDays === "number" && body.maxAgeDays >= 0) maxAgeDays = body.maxAgeDays;
          if (typeof body?.limit === "number" && body.limit > 0) limit = Math.min(body.limit, 100);
        } catch {
          // body opcional
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { resolveOwnerPlanAdmin } = await import("@/lib/plan-guard.server");
          const { data: props } = await supabaseAdmin
            .from("properties")
            .select("city, state, country, owner_id")
            .eq("published", true)
            .not("city", "is", null);

          type Bucket = { city_label: string; state: string | null; country: string };
          const cities = new Map<string, Bucket>();
          const planCache = new Map<string, boolean>();
          for (const p of (props ?? []) as Array<{ city: string | null; state: string | null; country: string | null; owner_id: string | null }>) {
            if (!p.city || !p.owner_id) continue;
            let canAuto = planCache.get(p.owner_id);
            if (canAuto === undefined) {
              const plan = await resolveOwnerPlanAdmin(supabaseAdmin, p.owner_id);
              canAuto = !!plan.features.autoImport;
              planCache.set(p.owner_id, canAuto);
            }
            if (!canAuto) continue;
            const country = p.country ?? "BR";
            const state = normalizeState(p.state);
            const key = `${cityKey(p.city)}|${state ?? ""}|${country}`;
            if (!cities.has(key)) cities.set(key, { city_label: p.city, state, country });
          }

          const { data: jobs } = await supabaseAdmin
            .from("city_reference_jobs")
            .select("city_key, state, country, last_refreshed_at");
          const lastByKey = new Map<string, string | null>();
          for (const j of (jobs ?? []) as Array<{ city_key: string; state: string | null; country: string; last_refreshed_at: string | null }>) {
            lastByKey.set(`${j.city_key}|${j.state ?? ""}|${j.country}`, j.last_refreshed_at);
          }

          const cutoff = Date.now() - maxAgeDays * 86400_000;
          const toRun: Bucket[] = [];
          for (const [key, b] of cities) {
            const last = lastByKey.get(key);
            const ageMs = last ? new Date(last).getTime() : 0;
            if (!last || ageMs < cutoff) toRun.push(b);
            if (toRun.length >= limit) break;
          }

          const results: Array<{ city: string; state: string | null; ok: boolean; total?: number; error?: string }> = [];
          // Processa até 3 cidades em paralelo para reduzir tempo total do cron.
          const CRON_CONCURRENCY = 3;
          for (let i = 0; i < toRun.length; i += CRON_CONCURRENCY) {
            const batch = toRun.slice(i, i + CRON_CONCURRENCY);
            const batchResults = await Promise.all(
              batch.map(async (b) => {
                try {
                  const r = await runCityGeneration(b);
                  return { city: b.city_label, state: b.state, ok: r.status === "ok", total: r.total };
                } catch (e) {
                  return { city: b.city_label, state: b.state, ok: false, error: e instanceof Error ? e.message : "unknown" };
                }
              }),
            );
            results.push(...batchResults);
          }

          return Response.json({ ok: true, processed: results.length, total_cities: cities.size, results });
        } catch (e) {
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : "unknown" },
            { status: 500 },
          );
        }
      },
    },
  },
});
