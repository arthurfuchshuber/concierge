import { createFileRoute } from "@tanstack/react-router";
import { refreshStaleRecommendations, refreshStaleCityReferencesByPlaceId } from "@/lib/maps.functions";

// Cron público: chamado pelo pg_cron diário. Autentica via apikey (anon).
export const Route = createFileRoute("/api/public/cron/refresh-recommendations")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyCronSecret, unauthorizedCronResponse } = await import("@/lib/cron-auth.server");
        if (!verifyCronSecret(request)) return unauthorizedCronResponse();
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
