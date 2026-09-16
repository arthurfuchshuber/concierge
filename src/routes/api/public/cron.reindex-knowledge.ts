import { createFileRoute } from "@tanstack/react-router";

/** Cron público: reindexa a base de conhecimento da IA em lotes. */
export const Route = createFileRoute("/api/public/cron/reindex-knowledge")({
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

        let limit = 25;
        let offset = 0;
        let onlyPublished = true;
        try {
          const body = (await request.json()) as { limit?: number; offset?: number; onlyPublished?: boolean };
          if (typeof body?.limit === "number" && body.limit > 0) limit = Math.min(body.limit, 60);
          if (typeof body?.offset === "number" && body.offset >= 0) offset = body.offset;
          if (typeof body?.onlyPublished === "boolean") onlyPublished = body.onlyPublished;
        } catch {
          // body opcional
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { reindexAllProperties } = await import("@/lib/ai/reindex-all.server");
          const result = await reindexAllProperties({
            supabase: supabaseAdmin as never,
            onlyPublished,
            limit,
            offset,
          });
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
