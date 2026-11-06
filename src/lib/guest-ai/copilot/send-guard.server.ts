/**
 * COPILOTO — guarda de ENVIO (servidor). Antes de a server function `sendCopilotSuggestion` invocar a rotina
 * humana de envio, confere no backend, só com leitura:
 *  1. escopo: a conversa, a mensagem que gerou a sugestão, o imóvel e a conta continuam coerentes
 *     (`validateTurnScope`, F0) e batem com a linha da sugestão (nenhum envio cruzado entre conversas,
 *     imóveis ou tenants);
 *  2. Airbnb: a identidade de envio é RESOLVIDA e VALIDADA pela política existente (`resolveSenderIdentity`,
 *     B2.5/B3.2): preferência `airbnb_sender_pref` do próprio tenant, anúncio do imóvel da conversa, gêmeos
 *     consistentes, conta ativa. Qualquer motivo de falha ⇒ o envio NÃO acontece (nenhum fallback silencioso
 *     para outra conta). O canal exato devolvido (`senderChannelId`) é imposto no envio (modo estrito).
 * Resolver identidade NÃO autoriza enviar: quem autoriza é o clique do atendente; quem envia é a rotina humana.
 * Nunca lança: devolve um resultado fechado.
 */
import { GuestAiScopeError, validateTurnScope } from "@/lib/guest-ai/data/scope.server";
import { getGuestAiDb, type GuestAiDb } from "@/lib/guest-ai/data/client.server";
import { loadSenderIdentitySource } from "@/lib/guest-ai/data/sender-identity.server";
import { resolveSenderIdentity, type SenderIdentity } from "@/lib/guest-ai/policy/sender-identity";
import type { GuestSurface, ValidatedTurn } from "@/lib/guest-ai/types";

export interface CopilotSendTarget {
  conversationId: string;
  triggerMessageId: string;
  propertyId: string;
  tenantId: string;
  surface: GuestSurface;
}

export type CopilotSendGuardResult =
  | {
      ok: true;
      surface: GuestSurface;
      turn: ValidatedTurn;
      senderChannelId: string | null;
      senderSource: SenderIdentity["source"];
    }
  | { ok: false; code: string };

export interface CopilotSendGuardDeps {
  db?: GuestAiDb;
  validateTurnScope?: typeof validateTurnScope;
  loadSenderIdentitySource?: typeof loadSenderIdentitySource;
  now?: () => Date;
}

export async function guardCopilotSend(
  target: CopilotSendTarget,
  deps: CopilotSendGuardDeps = {},
): Promise<CopilotSendGuardResult> {
  try {
    const db = deps.db ?? (await getGuestAiDb());
    let turn: ValidatedTurn;
    try {
      turn = await (deps.validateTurnScope ?? validateTurnScope)(
        {
          surface: target.surface,
          conversationId: target.conversationId,
          messageId: target.triggerMessageId,
          expectedOwnerId: target.tenantId,
        },
        { db },
      );
    } catch (e) {
      return {
        ok: false,
        code: `scope_${e instanceof GuestAiScopeError ? e.code : "lookup_failed"}`,
      };
    }
    if (
      turn.propertyId !== target.propertyId ||
      turn.tenantId !== target.tenantId ||
      turn.conversationId !== target.conversationId
    )
      return { ok: false, code: "scope_mismatch" };
    if (turn.surface !== "airbnb")
      return { ok: true, surface: turn.surface, turn, senderChannelId: null, senderSource: null };
    const source = await (deps.loadSenderIdentitySource ?? loadSenderIdentitySource)(turn, { db });
    const identity = resolveSenderIdentity({
      tenantId: turn.tenantId,
      propertyId: turn.propertyId,
      surface: turn.surface,
      source,
      now: (deps.now ?? (() => new Date()))().toISOString(),
    });
    if (identity.status !== "resolved")
      return { ok: false, code: `sender_identity_${identity.reason}` };
    return {
      ok: true,
      surface: turn.surface,
      turn,
      senderChannelId: identity.senderChannelId,
      senderSource: identity.source,
    };
  } catch {
    return { ok: false, code: "guard_failed" };
  }
}
