/**
 * MODO COPILOTO — núcleo do ENVIO da sugestão aprovada (só servidor; carregado por import dinâmico em
 * `sendCopilotSuggestion`, para que nada daqui — guarda, rotinas de canal — entre no bundle do navegador).
 *
 *  1. `copilot_claim_send` (sessão do usuário; autoria = `auth.uid()`): estado + token. Clique repetido,
 *     segunda aba ou nova tentativa durante o envio ⇒ `send_in_progress`; envio sem desfecho > 2 min ⇒
 *     `send_unknown` ⇒ RECONCILIA antes de qualquer nova tentativa (nunca reenvia sozinho).
 *  2. `guardCopilotSend`: escopo (conversa/mensagem/imóvel/tenant) e identidade de envio do Airbnb.
 *  3. Rotina humana EXISTENTE do canal (`handoff-send.server` / `whatsapp-send.server`), com remetente estrito
 *     no Airbnb — nenhum mecanismo paralelo de envio.
 *  4. `copilot_finish_send` com o id da mensagem; sem id ⇒ reconciliação pelo autor e instante. Erro na
 *     rotina ⇒ reconciliação ANTES de marcar falha (erro depois da gravação não leva a segundo envio).
 */
import type { GuestSurface } from "@/lib/guest-ai/types";
import { copilotFlagOn } from "@/lib/guest-ai/copilot/contracts";

type Rpc = Record<string, unknown> & { result?: string };
interface RpcClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}
async function rpc(client: unknown, fn: string, args: Record<string, unknown>): Promise<Rpc> {
  const { data, error } = await (client as RpcClient).rpc(fn, args);
  if (error) throw new Error(`copilot_rpc_failed:${fn}`);
  return (typeof data === "object" && data !== null ? data : {}) as Rpc;
}

export type CopilotSendError =
  | "assigned_to_other"
  | "permission_denied"
  | "guest_phone_missing"
  | "whatsapp_not_configured"
  | "whatsapp_send_failed"
  | "airbnb_rejected"
  | "preferred_sender_failed"
  | "sender_mismatch"
  | "send_failed";

/** Código FECHADO a partir da exceção da rotina humana (as mensagens continuam indo ao atendente). */
export function classifySendError(e: unknown): CopilotSendError {
  const msg = e instanceof Error ? e.message : String(e);
  if (/atendida por outro membro/i.test(msg)) return "assigned_to_other";
  if (/permiss|não tem acesso|plano|recurso/i.test(msg)) return "permission_denied";
  if (/telefone/i.test(msg)) return "guest_phone_missing";
  if (/WhatsApp Business não está configurado/i.test(msg)) return "whatsapp_not_configured";
  if (/Falha ao enviar WhatsApp/i.test(msg)) return "whatsapp_send_failed";
  if (/conta remetente configurada/i.test(msg)) return "preferred_sender_failed";
  if (/Airbnb recusou/i.test(msg)) return "airbnb_rejected";
  return "send_failed";
}

export type CopilotSendOutcome =
  | { status: "sent"; messageId: string | null }
  | { status: "send_in_progress" }
  | { status: "reconciled_sent"; messageId: string | null }
  | { status: "unknown_result" }
  | { status: "send_failed"; code: string; message: string | null }
  | { status: "invalid_state"; state: string | null }
  | { status: "send_disabled" };

export interface CopilotSendDeps {
  /** Ambiente lido para a chave `GUEST_AI_COPILOT_SEND` (padrão `process.env`, no servidor). */
  env?: Record<string, string | undefined>;
  guard?: typeof import("@/lib/guest-ai/copilot/send-guard.server").guardCopilotSend;
  sendHuman?: typeof import("@/lib/handoff-send.server").sendHumanMessageToConversation;
  sendWhatsapp?: typeof import("@/lib/whatsapp-send.server").sendWhatsappMessageToConversation;
}

/** Corpo de `sendCopilotSuggestion` (testável com dependências injetadas). `userId` só informa logs: a autoria é `auth.uid()`. */
export async function sendCopilotSuggestionCore(
  supabase: unknown,
  userId: string,
  data: { suggestionId: string; text?: string | null },
  deps: CopilotSendDeps = {},
): Promise<CopilotSendOutcome> {
  // 0) porta do ENVIO, conferida no servidor ANTES de qualquer efeito (nem a reivindicação acontece).
  //    A UI ligada não liga o envio; um pedido forjado do navegador cai aqui.
  if (!copilotFlagOn("send", deps.env)) return { status: "send_disabled" };
  // 1) reivindica o envio (estado + token). Nada abaixo acontece sem `claimed`.
  const claim = await rpc(supabase, "copilot_claim_send", {
    p_suggestion_id: data.suggestionId,
    p_text: data.text ?? null,
  });
  switch (claim.result) {
    case "claimed":
      break;
    case "send_in_progress":
      return { status: "send_in_progress" };
    case "send_unknown": {
      // envio reivindicado há > 2 min sem desfecho: VERIFICA antes de qualquer nova tentativa
      const rec = await rpc(supabase, "copilot_reconcile_send", {
        p_suggestion_id: data.suggestionId,
        p_attempt_finished: false,
        p_error_code: null,
      });
      if (rec.result === "reconciled_sent")
        return {
          status: "reconciled_sent",
          messageId: (rec["sent_message_id"] as string | null) ?? null,
        };
      if (rec.result === "send_in_progress") return { status: "send_in_progress" };
      return { status: "unknown_result" };
    }
    case "invalid_state":
      return { status: "invalid_state", state: (claim["state"] as string | null) ?? null };
    case "not_found":
    case "unauthenticated":
      throw new Error("Sugestão não encontrada.");
    default:
      throw new Error("Não foi possível iniciar o envio.");
  }
  const sendToken = claim["send_token"] as string | undefined;
  const text = claim["text"] as string | undefined;
  const conversationId = claim["conversation_id"] as string | undefined;
  const propertyId = claim["property_id"] as string | undefined;
  const tenantId = claim["tenant_id"] as string | undefined;
  const surface = claim["surface"] as GuestSurface | undefined;
  const triggerMessageId = claim["trigger_message_id"] as string | undefined;
  const finishFailed = async (code: string) => {
    // procura a mensagem gravada antes de marcar falha (erro depois da gravação ⇒ `sent`, nunca reenvio)
    const rec = await rpc(supabase, "copilot_reconcile_send", {
      p_suggestion_id: data.suggestionId,
      p_attempt_finished: true,
      p_error_code: code,
    });
    return rec.result === "reconciled_sent"
      ? ({
          status: "reconciled_sent",
          messageId: (rec["sent_message_id"] as string | null) ?? null,
        } as const)
      : null;
  };
  if (
    !sendToken ||
    !text ||
    !conversationId ||
    !propertyId ||
    !tenantId ||
    !surface ||
    !triggerMessageId
  ) {
    await finishFailed("claim_incomplete");
    return { status: "send_failed", code: "claim_incomplete", message: null };
  }

  // 2) guarda de escopo e identidade de envio (backend, só leitura)
  const guard =
    deps.guard ?? (await import("@/lib/guest-ai/copilot/send-guard.server")).guardCopilotSend;
  const g = await guard({ conversationId, triggerMessageId, propertyId, tenantId, surface });
  if (!g.ok) {
    const rec = await finishFailed(g.code.slice(0, 64));
    return (
      rec ?? {
        status: "send_failed",
        code: g.code,
        message: g.code.startsWith("sender_identity_")
          ? "A conta remetente deste anúncio não pôde ser confirmada. Nada foi enviado."
          : "A conversa mudou e a sugestão não pôde ser enviada.",
      }
    );
  }

  // 3) rotina humana do canal (permissão, bloqueio por responsável, pausa da IA, push)
  let sent: {
    messageId: string | null;
    externalId: string | null;
    channel: "web" | "airbnb" | "whatsapp";
  };
  try {
    if (g.surface === "whatsapp") {
      const sendWhatsapp =
        deps.sendWhatsapp ??
        (await import("@/lib/whatsapp-send.server")).sendWhatsappMessageToConversation;
      const r = await sendWhatsapp(supabase as never, userId, { conversationId, text });
      sent = { messageId: r.messageId, externalId: r.externalId, channel: "whatsapp" };
    } else {
      const sendHuman =
        deps.sendHuman ??
        (await import("@/lib/handoff-send.server")).sendHumanMessageToConversation;
      const r = await sendHuman(
        supabase as never,
        userId,
        { conversationId, content: text, internalNote: false },
        g.senderChannelId ? { strictSender: { expectedChannelId: g.senderChannelId } } : {},
      );
      sent = { messageId: r.messageId, externalId: r.externalId, channel: r.channel };
    }
  } catch (e) {
    const code = classifySendError(e);
    const rec = await finishFailed(code);
    return rec ?? { status: "send_failed", code, message: e instanceof Error ? e.message : null };
  }

  // 4) encerra o envio com o id da mensagem gravada (sem id ⇒ reconciliação pelo autor/instante)
  if (sent.messageId) {
    const fin = await rpc(supabase, "copilot_finish_send", {
      p_suggestion_id: data.suggestionId,
      p_send_token: sendToken,
      p_outcome: "sent",
      p_message_id: sent.messageId,
      p_provider_message_id: sent.externalId,
      p_channel: sent.channel,
      p_error_code: null,
    });
    if (fin.result === "finished") return { status: "sent", messageId: sent.messageId };
  }
  const rec = await rpc(supabase, "copilot_reconcile_send", {
    p_suggestion_id: data.suggestionId,
    p_attempt_finished: false,
    p_error_code: null,
  });
  // a rotina não lê a linha de volta (chat do guia/WhatsApp): o id vem da reconciliação pelo autor e instante
  if (rec.result === "reconciled_sent")
    return { status: "sent", messageId: (rec["sent_message_id"] as string | null) ?? null };
  // a mensagem saiu (a rotina humana não lançou) mas não foi possível registrar o desfecho: nunca reenviar
  return { status: "sent", messageId: sent.messageId };
}
