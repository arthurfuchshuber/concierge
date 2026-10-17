import { createFileRoute } from "@tanstack/react-router";

/**
 * Hóspede sem resposta, follow-ups e baixas por silêncio (todos os canais), a cada 1 min.
 * Rota própria para não disputar tempo com as chamadas da Channex.
 */
export const Route = createFileRoute("/api/public/cron/stalled-replies")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { isValidCronSecret } = await import("@/lib/cron-auth.server");
        if (!isValidCronSecret(request)) return new Response("Unauthorized", { status: 401 });
        try {
          const { sweepStalledGuestReplies } = await import("@/lib/ai/stalled-replies.server");
          return Response.json({ ok: true, done: await sweepStalledGuestReplies() });
        } catch (err) {
          console.error("[cron:stalled-replies]", err);
          return Response.json({ ok: false }, { status: 500 });
        }
      },
    },
  },
});
