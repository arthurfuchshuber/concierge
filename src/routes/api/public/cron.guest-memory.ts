import { createFileRoute } from "@tanstack/react-router";

/**
 * Cron: memória do hóspede pós-checkout (diretriz do titular, 06/11/2026). A cada hora processa até
 * `limit` estadias com checkout confirmado ainda sem memória — o mesmo caminho faz a carga retroativa.
 * Ver `runGuestMemoryCycle` em `src/lib/guest-memory/worker.server.ts`. Protegido por `x-cron-secret`.
 * Desligar sem mexer no banco: secret `GUEST_MEMORY_WORKER=off`.
 */
export const Route = createFileRoute("/api/public/cron/guest-memory")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyCronSecret, unauthorizedCronResponse } =
          await import("@/lib/cron-auth.server");
        if (!verifyCronSecret(request)) return unauthorizedCronResponse();
        const body = (await request.json().catch(() => ({}))) as { limit?: unknown };
        const limit = typeof body.limit === "number" ? body.limit : undefined;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runGuestMemoryCycle, createSupabaseGuestMemoryStore } =
          await import("@/lib/guest-memory/worker.server");
        try {
          const result = await runGuestMemoryCycle({
            store: createSupabaseGuestMemoryStore(supabaseAdmin as never),
            limit,
          });
          return Response.json({ ok: true, ...result });
        } catch (err) {
          console.error("[cron:guest-memory]", err instanceof Error ? err.message : "erro");
          return Response.json({ ok: false, error: "cycle failed" }, { status: 500 });
        }
      },
    },
  },
});
