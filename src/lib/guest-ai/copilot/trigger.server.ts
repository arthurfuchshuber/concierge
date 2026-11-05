/**
 * COPILOTO — disparo em SEGUNDO PLANO a partir dos canais de entrada (chat do guia, WhatsApp/Sinch,
 * Airbnb/Channex), logo depois de a mensagem do hóspede ser gravada.
 *
 *  - Nunca bloqueia o atendimento: devolve imediatamente; a geração corre em paralelo (padrão
 *    fire-and-forget já usado em `handoff.functions.ts` para o push ao hóspede).
 *  - Nunca lança e nunca altera o fluxo do canal (fallback humano, push, `needs_human` seguem iguais).
 *  - Com a chave mestra desligada (`GUEST_AI_COPILOT` ≠ `on`) nada é sequer carregado.
 *  - Só identificadores saem do canal (F0); o serviço re-deriva e valida tudo no backend.
 *  - A idempotência é do banco (`copilot_claim_generation`): se a UI pedir a mesma sugestão ao mesmo tempo,
 *    uma só geração acontece.
 * Logs: só códigos fechados — nunca texto do hóspede, do modelo ou de exceções.
 */
import { copilotEnabled, type CopilotGenerationRequest } from "./contracts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function triggerCopilotSuggestion(
  req: CopilotGenerationRequest,
  env: Record<string, string | undefined> = process.env,
): void {
  if (!copilotEnabled(env)) return;
  if (!UUID.test(req.conversationId ?? "") || !UUID.test(req.messageId ?? "")) return;
  void (async () => {
    try {
      const { generateCopilotSuggestion } = await import("./generate.server");
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
  })();
}
