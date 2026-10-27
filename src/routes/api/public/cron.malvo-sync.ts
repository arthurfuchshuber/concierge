import { createFileRoute } from "@tanstack/react-router";

/** Drena a fila de avisos do Malvo (a cada 1 min via pg_cron). Nunca faz polling no banco. */
export const Route = createFileRoute("/api/public/cron/malvo-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { isValidCronSecret } = await import("@/lib/cron-auth.server");
        if (!isValidCronSecret(request)) return new Response("Unauthorized", { status: 401 });
        try {
          const { processMalvoQueue } = await import("@/lib/malvo.server");
          return Response.json({ ok: true, ...(await processMalvoQueue()) });
        } catch (err) {
          console.error("[cron:malvo-sync]", err);
          return Response.json({ ok: false }, { status: 500 });
        }
      },
    },
  },
});
