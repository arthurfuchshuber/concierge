import { createFileRoute } from "@tanstack/react-router";

/**
 * Hóspede sem resposta, follow-ups e baixas por silêncio (todos os canais), a cada 1 min.
 * Rota própria para não disputar tempo com as chamadas da Channex.
 */
export const Route = createFileRoute("/api/public/cron/stalled-replies")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyCronSecret, unauthorizedCronResponse } = await import("@/lib/cron-auth.server");
        if (!verifyCronSecret(request)) return unauthorizedCronResponse();
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
