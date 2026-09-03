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
        const provided = request.headers.get("x-cron-secret") ?? "";
        const expected = process.env.CRON_SECRET ?? "";
        if (!expected) return new Response("Unauthorized", { status: 401 });
        const enc = new TextEncoder();
        const a = enc.encode(provided.padEnd(expected.length, "\0").slice(0, expected.length));
        const b = enc.encode(expected);
        let diff = provided.length !== expected.length ? 1 : 0;
        for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
        if (diff !== 0) return new Response("Unauthorized", { status: 401 });
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
