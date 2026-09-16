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
        // Timing-safe comparison: always iterate full expected length to avoid
        // length-based timing attacks. Early-exit on length mismatch leaks info.
        if (!expected) return new Response("Unauthorized", { status: 401 });
        const enc = new TextEncoder();
        const a = enc.encode(provided.padEnd(expected.length, "\0").slice(0, expected.length));
        const b = enc.encode(expected);
        let diff = provided.length !== expected.length ? 1 : 0;
        for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
        if (diff !== 0) return new Response("Unauthorized", { status: 401 });

        let maxAgeDays = 7;
        // Padrão conservador: 3 cidades por execução (cada uma leva ~15-20s).
        // O scheduler deve chamar repetidamente até hasMore === false.
        let limit = 3;
        try {
          const body = (await request.json()) as { maxAgeDays?: number; limit?: number };
          if (typeof body?.maxAgeDays === "number" && body.maxAgeDays >= 0) maxAgeDays = body.maxAgeDays;
          if (typeof body?.limit === "number" && body.limit > 0) limit = Math.min(body.limit, 10);
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
            // Dedup by city_key|country (ignore state inconsistency)
            const key = `${cityKey(p.city)}|${country}`;
            if (!cities.has(key)) cities.set(key, { city_label: p.city, state, country });
          }

          const { data: jobs } = await supabaseAdmin
            .from("city_reference_jobs")
            .select("city_key, state, country, last_refreshed_at");
          const lastByKey = new Map<string, string | null>();
          for (const j of (jobs ?? []) as Array<{ city_key: string; state: string | null; country: string; last_refreshed_at: string | null }>) {
            // Use same dedup key
            const jk = `${j.city_key}|${j.country}`;
            const existing = lastByKey.get(jk);
            // Keep the most recent refresh date if multiple job rows for same city
            if (!existing || (j.last_refreshed_at && (!existing || j.last_refreshed_at > existing))) {
              lastByKey.set(jk, j.last_refreshed_at);
            }
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
          // Processa 1 cidade por vez — geração leva 30-60s cada, paralelo causaria timeout.
          // O limit já controla quantas cidades processar por execução do cron.
          const CRON_START = Date.now();
          const CRON_MAX_MS = 50_000; // 50s — deixa margem antes do timeout do edge (60s)
          for (const b of toRun) {
            if (Date.now() - CRON_START > CRON_MAX_MS) {
              results.push({ city: b.city_label, state: b.state, ok: false, error: "timeout_budget_exceeded" });
              continue;
            }
            try {
              const r = await runCityGeneration(b);
              results.push({ city: b.city_label, state: b.state, ok: r.status === "ok" || r.status === "partial", total: r.total });
            } catch (e) {
              results.push({ city: b.city_label, state: b.state, ok: false, error: e instanceof Error ? e.message : "unknown" });
            }
          }

          // hasMore: true indica que há mais cidades stale para processar —
          // o scheduler pode chamar novamente imediatamente.
          const hasMore = toRun.length >= limit;
          return Response.json({ ok: true, processed: results.length, total_cities: cities.size, hasMore, results });
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
