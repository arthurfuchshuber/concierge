import { createFileRoute } from "@tanstack/react-router";

/**
 * Retentativa automática da outbox ARI da Channex (a cada 1 min via pg_cron).
 * Só processa itens `pending` com `next_attempt_at` vencido; nunca faz full
 * sync nem reenvia itens já enviados. O limitador 20/min continua valendo.
 *
 * O parâmetro `?only=ai` (batida de 15 s das respostas da IA antiga) deixou de
 * existir em 01/11/2026 com a remoção da implementação antiga; chamadas com
 * ele respondem `ok` sem fazer nada, para o job agendado não gerar erro.
 */
export const Route = createFileRoute("/api/public/cron/channex-ari-retry")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyCronSecret, unauthorizedCronResponse } = await import("@/lib/cron-auth.server");
        if (!verifyCronSecret(request)) return unauthorizedCronResponse();
        if (new URL(request.url).searchParams.get("only") === "ai") {
          return Response.json({ ok: true, replies: 0, retired: true });
        }
        const { flushAriOutbox } = await import("@/lib/channex-ari.server");
        try {
          const ari = await flushAriOutbox();
          // Sem polling periódico na Channex (pedido do suporte Channex): entidades e calendário
          // chegam só por webhooks e por ações do usuário.
          return Response.json({ ok: true, batches: ari.batches.length });
        } catch (err) {
          console.error("[cron:channex-ari-retry]", err);
          return Response.json({ ok: false }, { status: 500 });
        }
      },
    },
  },
});
