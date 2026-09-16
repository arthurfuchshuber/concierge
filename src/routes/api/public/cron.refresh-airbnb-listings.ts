import { createFileRoute } from "@tanstack/react-router";
import { refreshStaleAirbnbListings } from "@/lib/airbnb.functions";

// Cron público: chamado pelo pg_cron uma vez por dia. Mesmo padrão de
// autenticação (comparação em tempo constante do x-cron-secret) e mesma
// forma de endpoint dos outros crons públicos (refresh-recommendations,
// refresh-city-news, proactive-concierge) — ver as migrations
// "schedule_*_cron" para o agendamento correspondente no pg_cron.
export const Route = createFileRoute("/api/public/cron/refresh-airbnb-listings")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { isValidCronSecret } = await import("@/lib/cron-auth.server");
        if (!isValidCronSecret(request)) {
          return new Response("Unauthorized", { status: 401 });
        }
        let limit = 100;
        try {
          const body = (await request.json()) as { limit?: number };
          if (typeof body?.limit === "number" && body.limit > 0) limit = body.limit;
        } catch {
          // body opcional
        }
        try {
          const result = await refreshStaleAirbnbListings(limit);
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
