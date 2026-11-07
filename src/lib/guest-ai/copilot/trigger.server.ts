/**
 * COPILOTO — disparo em SEGUNDO PLANO a partir dos canais de entrada (chat do guia, WhatsApp/Sinch,
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
 * Logs: só códigos fechados — nunca texto do hóspede, do modelo ou de exceções.
 */
import { runInBackground } from "@/lib/background.server";
import { copilotFlagOn, type CopilotGenerationRequest } from "./contracts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function triggerCopilotSuggestion(
  req: CopilotGenerationRequest,
  env: Record<string, string | undefined> = process.env,
  deps: { generate?: typeof import("./generate.server").generateCopilotSuggestion } = {},
): Promise<void> {
  if (!copilotFlagOn("generation", env)) return Promise.resolve();
  if (!UUID.test(req.conversationId ?? "") || !UUID.test(req.messageId ?? ""))
    return Promise.resolve();
  return runInBackground(async () => {
    try {
      const generateCopilotSuggestion =
        deps.generate ?? (await import("./generate.server")).generateCopilotSuggestion;
      const r = await generateCopilotSuggestion(
        {
          surface: req.surface,
          conversationId: req.conversationId,
          messageId: req.messageId,
          expectedOwnerId: req.expectedOwnerId ?? null,
        },
        { env },
      );
      if (r.status === "skipped")
        console.warn("[copilot] geração não concluída", r.code, r.detail ?? "");
    } catch {
      console.error("[copilot] geração falhou (erro interno)");
    }
  });
}
