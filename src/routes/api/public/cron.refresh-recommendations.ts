import { createFileRoute } from "@tanstack/react-router";
import { refreshStaleRecommendations, refreshStaleCityReferencesByPlaceId } from "@/lib/maps.functions";

// Cron público: chamado pelo pg_cron diário. Autentica via apikey (anon).
export const Route = createFileRoute("/api/public/cron/refresh-recommendations")({
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
        let limit = 200;
        try {
          const body = (await request.json()) as { limit?: number };
          if (typeof body?.limit === "number" && body.limit > 0) limit = body.limit;
        } catch {
          // body opcional
        }
        try {
          const result = await refreshStaleRecommendations(limit);
          const cityResult = await refreshStaleCityReferencesByPlaceId(limit);
          return Response.json({ ok: true, recommendations: result, city_references: cityResult });
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
