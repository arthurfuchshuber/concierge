import { createFileRoute } from "@tanstack/react-router";

/** Drena a fila de avisos do Malvo (reserva, 1x/hora via pg_cron). Nunca faz polling no banco. */
export const Route = createFileRoute("/api/public/cron/malvo-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { isValidCronSecret } = await import("@/lib/cron-auth.server");
        if (!isValidCronSecret(request)) return new Response("Unauthorized", { status: 401 });
        try {
          const { processMalvoQueue } = await import("@/lib/malvo.server");
          const { syncAsaas } = await import("@/lib/asaas.server");
          // Asaas não está no Open Finance: extrato incremental pela API própria.
          const asaas = await syncAsaas().catch((e) => ({ error: String(e?.message ?? e) }));
          return Response.json({ ok: true, ...(await processMalvoQueue()), asaas });
        } catch (err) {
          console.error("[cron:malvo-sync]", err);
          return Response.json({ ok: false }, { status: 500 });
        }
      },
    },
  },
});
