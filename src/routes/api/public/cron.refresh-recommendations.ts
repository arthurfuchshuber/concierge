import { createFileRoute } from "@tanstack/react-router";
import { refreshStaleRecommendations } from "@/lib/maps.functions";

// Cron público: chamado pelo pg_cron diário. Autentica via apikey (anon).
export const Route = createFileRoute("/api/public/cron/refresh-recommendations")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("x-cron-secret") ?? "";
        const expected = process.env.CRON_SECRET ?? "";
        if (!expected || provided.length !== expected.length) {
          return new Response("Unauthorized", { status: 401 });
        }
        // timing-safe compare
        let diff = 0;
        for (let i = 0; i < expected.length; i++) {
          diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
        }
        if (diff !== 0) {
          return new Response("Unauthorized", { status: 401 });
        }
        let limit = 200;
        try {
          const body = (await request.json()) as { limit?: number };
          if (typeof body?.limit === "number" && body.limit > 0) limit = body.limit;
        } catch {
          // body opcional
        }
        try {
          const result = await refreshStaleRecommendations(limit);
          return Response.json({ ok: true, ...result });
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
