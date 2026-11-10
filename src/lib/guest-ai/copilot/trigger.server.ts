/**
 * COPILOTO — disparo em SEGUNDO PLANO a partir dos canais de entrada (chat do guia, WhatsApp (em standby desde 10/11/2026),
 * Airbnb/Channex), logo depois de a mensagem do hóspede ser gravada.
 *
 *  - Gate G1 (R2): a geração NUNCA fica solta. Com o `waitUntil` do Worker, a promessa devolvida resolve na
 *    hora e a geração segue sob o `waitUntil`; sem ele, a promessa só resolve quando a geração termina (o canal
 *    a aguarda dentro da própria requisição). Ver `src/lib/background.server.ts`. O chamador DEVE aguardar.
 *  - Nunca lança e nunca altera o fluxo do canal (fallback humano, push, `needs_human` seguem iguais).
 *  - Com `GUEST_AI_COPILOT_GENERATION` ≠ `on` nada é sequer carregado (a UI ligada não liga a geração).
 *  - Só identificadores saem do canal (F0); o serviço re-deriva e valida tudo no backend.
 *  - A idempotência é do banco (`copilot_claim_generation`): se a UI pedir a mesma sugestão ao mesmo tempo,
 *    uma só geração acontece.
 *  - Rajada (06/11/2026): com `waitUntil` disponível, cada disparo espera `COPILOT_BURST_QUIET_MS` (6 s) antes de
 *    gerar; a geração dispensa a mensagem se o hóspede já mandou outra mais nova (a mais nova responde ao
 *    conjunto). Sem `waitUntil`, não espera (a resposta do canal nunca fica 6 s presa).
 * Logs: só códigos fechados — nunca texto do hóspede, do modelo ou de exceções.
 */
import { backgroundAvailable, runInBackground } from "@/lib/background.server";
import {
  COPILOT_BURST_QUIET_MS,
  COPILOT_BACKSTAGE_DEADLINE_MS,
  copilotFlagOn,
  type CopilotGenerationRequest,
} from "./contracts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function triggerCopilotSuggestion(
  req: CopilotGenerationRequest,
  env: Record<string, string | undefined> = process.env,
  deps: {
    generate?: typeof import("./generate.server").generateCopilotSuggestion;
    /** Espera da janela de respiro (testes: imediata). */
    sleep?: (ms: number) => Promise<void>;
    /** Força a espera (padrão: só com `waitUntil` do Worker). */
    quietWindow?: boolean;
  } = {},
): Promise<void> {
  if (!copilotFlagOn("generation", env)) return Promise.resolve();
  if (!UUID.test(req.conversationId ?? "") || !UUID.test(req.messageId ?? ""))
    return Promise.resolve();
  const wait = deps.quietWindow ?? backgroundAvailable();
  return runInBackground(async () => {
    try {
      if (wait)
        await (deps.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms))))(
          COPILOT_BURST_QUIET_MS,
        );
      const generateCopilotSuggestion =
        deps.generate ?? (await import("./generate.server")).generateCopilotSuggestion;
      const r = await generateCopilotSuggestion(
        {
          surface: req.surface,
          conversationId: req.conversationId,
          messageId: req.messageId,
          expectedOwnerId: req.expectedOwnerId ?? null,
        },
        // o respiro sai do orçamento total do segundo plano (o Worker dá ~30 s depois da resposta)
        wait
          ? { env, deadlineMs: COPILOT_BACKSTAGE_DEADLINE_MS - COPILOT_BURST_QUIET_MS }
          : { env, deadlineMs: COPILOT_BACKSTAGE_DEADLINE_MS },
      );
      if (r.status === "skipped" && r.code !== "superseded_by_newer_message")
        console.warn("[copilot] geração não concluída", r.code, r.detail ?? "");
    } catch {
      console.error("[copilot] geração falhou (erro interno)");
    }
  });
}
