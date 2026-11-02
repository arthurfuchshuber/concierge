import { createFileRoute } from "@tanstack/react-router";

/**
 * Sonda D14 do ConciergeIA Guest (F2-B · B1): homologação controlada da 1ª chamada real ao
 * provedor de LLM, com prompts sintéticos. DESLIGADA por padrão (`GUEST_AI_LLM_PROBE=on` +
 * segredo de cron). Com a chave desligada responde 404 e não chama nada. Ver
 * `src/lib/guest-ai/llm/probe.server.ts`.
 */
export const Route = createFileRoute("/api/public/guest-ai/llm-probe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleProbeRequest } = await import("@/lib/guest-ai/llm/probe.server");
        try {
          return await handleProbeRequest(request);
        } catch {
          return Response.json({ ok: false, error: "probe_failed" }, { status: 500 });
        }
      },
      GET: async ({ request }) => {
        const { handleProbeRequest } = await import("@/lib/guest-ai/llm/probe.server");
        return handleProbeRequest(request);
      },
    },
  },
});
