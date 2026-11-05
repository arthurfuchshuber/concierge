/**
 * MODO COPILOTO (diretriz definitiva de 05/11/2026) — server functions da tela de Atendimento.
 *
 * Tudo aqui corre com o cliente da SESSÃO do usuário (`requireSupabaseAuth` → RLS + `auth.uid()`):
 *  - leitura da sugestão vigente da conversa (RLS do imóvel; só dentro da retenção);
 *  - pedido explícito de geração (idempotente com o disparo em segundo plano dos canais);
 *  - editar / descartar (RPCs `copilot_edit` / `copilot_discard`: autoria = `auth.uid()`);
 *  - ENVIAR: reivindica o envio no banco (`copilot_claim_send`: estado + token; clique repetido, segunda aba
 *    ou nova tentativa durante o envio não geram segundo envio), confere no backend escopo e identidade de
 *    envio (`guardCopilotSend`), invoca a ROTINA HUMANA EXISTENTE do canal (`sendHumanMessageToConversation`
 *    / `sendWhatsappMessageToConversation` — permissão, bloqueio por responsável, pausa da IA, push) e
 *    encerra o envio (`copilot_finish_send`). Erro na tentativa ⇒ `copilot_reconcile_send` procura a mensagem
 *    gravada ANTES de marcar falha: um resultado ambíguo nunca dispara um segundo envio automático.
 * A IA nunca envia nada por conta própria; nenhum identificador de usuário vem do frontend.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  COPILOT_ROW_COLUMNS,
  copilotEnabled,
  type CopilotSuggestionRow,
} from "@/lib/guest-ai/copilot/contracts";
import type { GuestSurface } from "@/lib/guest-ai/types";

const UUID = z.string().uuid();
const TEXT = z.string().trim().min(1).max(4000);

/**
 * A tabela e as RPCs do Copiloto ainda não existem na produção (migration local, não aplicada), então não
 * estão em `integrations/supabase/types.ts` (gerado da produção). Acesso tipado localmente, sem alterar o gerado.
 */
interface UntypedClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}
const untyped = (c: unknown): UntypedClient => c as UntypedClient;

type Rpc = Record<string, unknown> & { result?: string };
async function rpc(client: unknown, fn: string, args: Record<string, unknown>): Promise<Rpc> {
  const { data, error } = await untyped(client).rpc(fn, args);
  if (error) throw new Error(`copilot_rpc_failed:${fn}`);
  return (typeof data === "object" && data !== null ? data : {}) as Rpc;
}

function surfaceOfSession(sessionId: string): GuestSurface {
  if (sessionId.startsWith("wa:")) return "whatsapp";
  if (sessionId.startsWith("airbnb:")) return "airbnb";
  return "guide_chat";
}

async function latestSuggestion(
  client: unknown,
  conversationId: string,
): Promise<CopilotSuggestionRow | null> {
  const { data, error } = await untyped(client)
    .from("guest_ai_copilot_suggestions")
    .select(COPILOT_ROW_COLUMNS.join(", "))
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    // tabela ainda não migrada neste ambiente ⇒ sem sugestão (a UI mostra o Copiloto como indisponível)
    return null;
  }
  const row = (data as CopilotSuggestionRow[] | null)?.[0];
  return row ?? null;
}

async function suggestionById(
  client: unknown,
  suggestionId: string,
): Promise<CopilotSuggestionRow | null> {
  const { data, error } = await untyped(client)
    .from("guest_ai_copilot_suggestions")
    .select(COPILOT_ROW_COLUMNS.join(", "))
    .eq("id", suggestionId)
    .maybeSingle();
  if (error) return null;
  return (data as CopilotSuggestionRow | null) ?? null;
}

// -------- Sugestão vigente da conversa --------

export const getCopilotSuggestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ conversationId: UUID }).parse(raw))
  .handler(async ({ data, context }) => {
    const enabled = copilotEnabled();
    const suggestion = await latestSuggestion(context.supabase, data.conversationId);
    return { enabled, suggestion };
  });

// -------- Pedido explícito de geração (idempotente com o disparo dos canais) --------

export const ensureCopilotSuggestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ conversationId: UUID }).parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (!copilotEnabled()) return { status: "disabled" as const, suggestion: null };
    // acesso à conversa pela RLS + permissão de resposta na conta do imóvel
    const { data: conv } = await supabase
      .from("property_chat_conversations")
      .select("id, guest_session_id, property_id, properties:property_id(owner_id)")
      .eq("id", data.conversationId)
      .maybeSingle();
    if (!conv) throw new Error("Conversa não encontrada.");
    const joined = conv.properties as
      { owner_id?: string | null } | { owner_id?: string | null }[] | null;
    const ownerId = (Array.isArray(joined) ? joined[0]?.owner_id : joined?.owner_id) ?? null;
    if (!ownerId) throw new Error("Conversa sem imóvel.");
    const { requireMemberPermission } = await import("@/lib/member-permissions.server");
    await requireMemberPermission(supabase, userId, ownerId, "chat_respond");
    const { data: guestMsg } = await supabase
      .from("property_chat_messages")
      .select("id")
      .eq("conversation_id", data.conversationId)
      .eq("sender_type", "guest")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!guestMsg?.id)
      return {
        status: "no_guest_message" as const,
        suggestion: await latestSuggestion(supabase, data.conversationId),
      };
    const { generateCopilotSuggestion } = await import("@/lib/guest-ai/copilot/generate.server");
    const r = await generateCopilotSuggestion({
      surface: surfaceOfSession(String(conv.guest_session_id ?? "")),
      conversationId: data.conversationId,
      messageId: guestMsg.id,
      expectedOwnerId: ownerId,
    });
    return {
      status: r.status,
      code: "code" in r ? r.code : null,
      suggestion: await latestSuggestion(supabase, data.conversationId),
    };
  });

// -------- Editar / descartar --------

export const editCopilotSuggestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ suggestionId: UUID, text: TEXT }).parse(raw))
  .handler(async ({ data, context }) => {
    const r = await rpc(context.supabase, "copilot_edit", {
      p_suggestion_id: data.suggestionId,
      p_text: data.text,
    });
    if (r.result === "not_found" || r.result === "unauthenticated")
      throw new Error("Sugestão não encontrada.");
    if (r.result === "invalid_state") throw new Error("Esta sugestão já não pode ser editada.");
    if (r.result !== "edited") throw new Error("Não foi possível salvar a edição.");
    return {
      ok: true as const,
      suggestion: await suggestionById(context.supabase, data.suggestionId),
    };
  });

export const discardCopilotSuggestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ suggestionId: UUID }).parse(raw))
  .handler(async ({ data, context }) => {
    const r = await rpc(context.supabase, "copilot_discard", {
      p_suggestion_id: data.suggestionId,
    });
    if (r.result === "not_found" || r.result === "unauthenticated")
      throw new Error("Sugestão não encontrada.");
    if (r.result === "invalid_state") throw new Error("Esta sugestão já não pode ser descartada.");
    if (r.result !== "discarded") throw new Error("Não foi possível descartar.");
    return {
      ok: true as const,
      suggestion: await suggestionById(context.supabase, data.suggestionId),
    };
  });

// -------- Enviar ao hóspede (pela rotina humana do canal) --------

export const sendCopilotSuggestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ suggestionId: UUID, text: TEXT.optional() }).parse(raw))
  .handler(async ({ data, context }) => {
    // núcleo do envio (servidor): reivindicação, guarda, rotina humana do canal, encerramento/reconciliação
    const { sendCopilotSuggestionCore } = await import("@/lib/copilot-send.server");
    const outcome = await sendCopilotSuggestionCore(context.supabase, context.userId, data);
    return { outcome, suggestion: await suggestionById(context.supabase, data.suggestionId) };
  });
