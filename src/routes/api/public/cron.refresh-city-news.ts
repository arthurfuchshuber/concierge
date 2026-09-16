import { createFileRoute } from "@tanstack/react-router";
import { generateAndCacheCityNews } from "@/lib/city-news.functions";
import { cityKey } from "@/lib/city-key";

// Cron público — chamado diariamente às 10h BRT (13:00 UTC) pelo pg_cron.
// Regenera as manchetes do dia para todas as cidades com imóveis publicados.
// Processa até `limit` cidades por execução (padrão 5) para caber no budget do worker.
export const Route = createFileRoute("/api/public/cron/refresh-city-news")({
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

        let limit = 5;
        let force = true;
        try {
          const body = (await request.json()) as { limit?: number; force?: boolean };
          if (typeof body?.limit === "number" && body.limit > 0) limit = Math.min(body.limit, 15);
          if (typeof body?.force === "boolean") force = body.force;
        } catch {
          // body opcional
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: props } = await supabaseAdmin
            .from("properties")
            .select("city, country")
            .eq("published", true)
            .not("city", "is", null);

          type Bucket = { key: string; label: string; country: string | null };
          const cities = new Map<string, Bucket>();
          for (const p of (props ?? []) as Array<{ city: string | null; country: string | null }>) {
            if (!p.city) continue;
            const k = cityKey(p.city);
            if (!cities.has(k)) cities.set(k, { key: k, label: p.city, country: p.country });
          }

          const today = new Date().toISOString().slice(0, 10);
          // Descobre quais cidades já foram atualizadas hoje (para skip quando !force).
          const doneToday = new Set<string>();
          if (!force && cities.size > 0) {
            const { data: cached } = await supabaseAdmin
              .from("city_daily_news")
              .select("city_key")
              .eq("date", today)
              .in("city_key", Array.from(cities.keys()));
            for (const r of (cached ?? []) as Array<{ city_key: string }>) doneToday.add(r.city_key);
          }

          const toRun: Bucket[] = [];
          for (const b of cities.values()) {
            if (!force && doneToday.has(b.key)) continue;
            toRun.push(b);
            if (toRun.length >= limit) break;
          }

          const CRON_START = Date.now();
          const CRON_MAX_MS = 50_000;
          const results: Array<{ city: string; ok: boolean; generated?: boolean; cached?: boolean; error?: string }> = [];
          for (const b of toRun) {
            if (Date.now() - CRON_START > CRON_MAX_MS) {
              results.push({ city: b.label, ok: false, error: "timeout_budget_exceeded" });
              continue;
            }
            try {
              const r = await generateAndCacheCityNews({
                cityKey: b.key,
                cityLabel: b.label,
                country: b.country,
                lang: "pt",
                force,
              });
              results.push({
                city: b.label,
                ok: !!r.items,
                generated: r.generated,
                cached: r.cached,
              });
            } catch (e) {
              results.push({ city: b.label, ok: false, error: e instanceof Error ? e.message : "unknown" });
            }
          }

          const hasMore = toRun.length >= limit && cities.size > toRun.length + doneToday.size;
          return Response.json({
            ok: true,
            processed: results.length,
            total_cities: cities.size,
            already_done_today: doneToday.size,
            hasMore,
            results,
          });
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
