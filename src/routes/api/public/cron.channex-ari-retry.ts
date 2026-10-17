import { createFileRoute } from "@tanstack/react-router";

/**
 * Retentativa automática da outbox ARI da Channex (a cada 1 min via pg_cron).
 * Só processa itens `pending` com `next_attempt_at` vencido; nunca faz full
 * sync nem reenvia itens já enviados. O limitador 20/min continua valendo.
 */
export const Route = createFileRoute("/api/public/cron/channex-ari-retry")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { isValidCronSecret } = await import("@/lib/cron-auth.server");
        if (!isValidCronSecret(request)) return new Response("Unauthorized", { status: 401 });
        // `?only=ai`: batida curta (a cada 15 s) só para as respostas da IA cuja janela fechou.
        if (new URL(request.url).searchParams.get("only") === "ai") {
          try {
            const { processDueAiReplies } = await import("@/lib/channex-messages.server");
            return Response.json({ ok: true, replies: await processDueAiReplies() });
          } catch (err) {
            console.error("[cron:ai-reply-due]", err);
            return Response.json({ ok: false }, { status: 500 });
          }
        }
        // Hóspede sem resposta roda PRIMEIRO, em paralelo: lentidão da Channex nunca o atrasa.
        const stalled = import("@/lib/ai/stalled-replies.server")
          .then((m) => m.sweepStalledGuestReplies())
          .catch((e) => console.error("[cron:stalled-replies]", e));
        const { flushAriOutbox } = await import("@/lib/channex-ari.server");
        try {
          const ari = await flushAriOutbox();
          // Mesma batida de 1 min: sincroniza entidades/anúncios Channex (throttle de 5 min no banco).
          const { syncChannexEntities } = await import("@/lib/channex-entity-sync.server");
          await syncChannexEntities({ source: "cron" }).catch((e) =>
            console.error("[cron:channex-entity-sync]", e),
          );
          // Calendário do Airbnb (somente importação): reconfere um imóvel por batida.
          const { importStaleCalendar } = await import("@/lib/calendar-import.server");
          await importStaleCalendar().catch((e) => console.error("[cron:calendar-import]", e));
          // Respostas da IA cuja janela de consolidação já fechou (rede de segurança do webhook).
          const { processDueAiReplies } = await import("@/lib/channex-messages.server");
          await processDueAiReplies().catch((e) => console.error("[cron:ai-reply-due]", e));
          await stalled;
          return Response.json({ ok: true, batches: ari.batches.length });
        } catch (err) {
          console.error("[cron:channex-ari-retry]", err);
          return Response.json({ ok: false }, { status: 500 });
        }
      },
    },
  },
});
