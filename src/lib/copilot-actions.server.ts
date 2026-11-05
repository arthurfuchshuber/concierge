/**
 * MODO COPILOTO — corpo das server functions de leitura, geração sob demanda, edição e descarte (só servidor;
 * carregado por import dinâmico a partir de `copilot.functions.ts`). Cada ação confere a SUA chave antes de
 * qualquer efeito; a interface só recebe o estado das chaves para se adaptar e não decide nenhum bloqueio:
 *  - leitura, edição e descarte  ⇒ `GUEST_AI_COPILOT_UI`;
 *  - geração sob demanda          ⇒ `GUEST_AI_COPILOT_UI` E `GUEST_AI_COPILOT_GENERATION` (a geração ainda
 *    confere a própria chave dentro de `generateCopilotSuggestion`, para qualquer chamador);
 *  - envio                        ⇒ `GUEST_AI_COPILOT_SEND`, em `copilot-send.server.ts`.
 * Tudo com o cliente da SESSÃO do usuário (RLS + `auth.uid()`); nenhum id de usuário vem do navegador.
 */
import {
  COPILOT_ROW_COLUMNS,
  copilotFlags,
  type CopilotFlags,
  type CopilotSuggestionRow,
} from "@/lib/guest-ai/copilot/contracts";
import type { GuestSurface } from "@/lib/guest-ai/types";

type Env = Record<string, string | undefined>;

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

export function surfaceOfSession(sessionId: string): GuestSurface {
  if (sessionId.startsWith("wa:")) return "whatsapp";
  if (sessionId.startsWith("airbnb:")) return "airbnb";
  return "guide_chat";
}

export async function latestSuggestion(
  client: unknown,
  conversationId: string,
): Promise<CopilotSuggestionRow | null> {
  const { data, error } = await untyped(client)
    .from("guest_ai_copilot_suggestions")
    .select(COPILOT_ROW_COLUMNS.join(", "))
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(1);
  // tabela ainda não migrada neste ambiente ⇒ sem sugestão
  if (error) return null;
  return (data as CopilotSuggestionRow[] | null)?.[0] ?? null;
}

export async function suggestionById(
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

// -------- leitura --------

export async function readCopilotSuggestion(
  client: unknown,
  conversationId: string,
  env?: Env,
): Promise<{ flags: CopilotFlags; suggestion: CopilotSuggestionRow | null }> {
  const flags = copilotFlags(env);
  // UI desligada ⇒ nem a tabela é lida
  if (!flags.ui) return { flags, suggestion: null };
  return { flags, suggestion: await latestSuggestion(client, conversationId) };
}

// -------- geração sob demanda --------

export type EnsureResult =
  | { status: "ui_disabled" | "generation_disabled"; code: null; suggestion: null }
  | { status: string; code: string | null; suggestion: CopilotSuggestionRow | null };

export interface EnsureDeps {
  env?: Env;
  requirePermission?: (supabase: unknown, userId: string, ownerId: string) => Promise<void>;
  generate?: typeof import("@/lib/guest-ai/copilot/generate.server").generateCopilotSuggestion;
}

export async function ensureCopilotSuggestionCore(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  conversationId: string,
  deps: EnsureDeps = {},
): Promise<EnsureResult> {
  const flags = copilotFlags(deps.env);
  if (!flags.ui) return { status: "ui_disabled", code: null, suggestion: null };
  if (!flags.generation) return { status: "generation_disabled", code: null, suggestion: null };
  // acesso à conversa pela RLS + permissão de resposta na conta do imóvel
  const { data: conv } = await supabase
    .from("property_chat_conversations")
    .select("id, guest_session_id, property_id, properties:property_id(owner_id)")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv) throw new Error("Conversa não encontrada.");
  const joined = conv.properties as
    { owner_id?: string | null } | { owner_id?: string | null }[] | null;
  const ownerId = (Array.isArray(joined) ? joined[0]?.owner_id : joined?.owner_id) ?? null;
  if (!ownerId) throw new Error("Conversa sem imóvel.");
  if (deps.requirePermission) await deps.requirePermission(supabase, userId, ownerId);
  else {
    const { requireMemberPermission } = await import("@/lib/member-permissions.server");
    await requireMemberPermission(supabase, userId, ownerId, "chat_respond");
  }
  const { data: guestMsg } = await supabase
    .from("property_chat_messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("sender_type", "guest")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!guestMsg?.id)
    return {
      status: "no_guest_message",
      code: null,
      suggestion: await latestSuggestion(supabase, conversationId),
    };
  const generate =
    deps.generate ??
    (await import("@/lib/guest-ai/copilot/generate.server")).generateCopilotSuggestion;
  const r = await generate(
    {
      surface: surfaceOfSession(String(conv.guest_session_id ?? "")),
      conversationId,
      messageId: guestMsg.id,
      expectedOwnerId: ownerId,
    },
    deps.env ? { env: deps.env } : {},
  );
  return {
    status: r.status,
    code: "code" in r ? r.code : null,
    suggestion: await latestSuggestion(supabase, conversationId),
  };
}

// -------- edição / descarte --------

export async function editCopilotSuggestionCore(
  supabase: unknown,
  data: { suggestionId: string; text: string },
  env?: Env,
): Promise<{ ok: true; suggestion: CopilotSuggestionRow | null }> {
  if (!copilotFlags(env).ui) throw new Error("Sugestões da IA desativadas.");
  const r = await rpc(supabase, "copilot_edit", {
    p_suggestion_id: data.suggestionId,
    p_text: data.text,
  });
  if (r.result === "not_found" || r.result === "unauthenticated")
    throw new Error("Sugestão não encontrada.");
  if (r.result === "invalid_state") throw new Error("Esta sugestão já não pode ser editada.");
  if (r.result !== "edited") throw new Error("Não foi possível salvar a edição.");
  return { ok: true, suggestion: await suggestionById(supabase, data.suggestionId) };
}

export async function discardCopilotSuggestionCore(
  supabase: unknown,
  data: { suggestionId: string },
  env?: Env,
): Promise<{ ok: true; suggestion: CopilotSuggestionRow | null }> {
  if (!copilotFlags(env).ui) throw new Error("Sugestões da IA desativadas.");
  const r = await rpc(supabase, "copilot_discard", { p_suggestion_id: data.suggestionId });
  if (r.result === "not_found" || r.result === "unauthenticated")
    throw new Error("Sugestão não encontrada.");
  if (r.result === "invalid_state") throw new Error("Esta sugestão já não pode ser descartada.");
  if (r.result !== "discarded") throw new Error("Não foi possível descartar.");
  return { ok: true, suggestion: await suggestionById(supabase, data.suggestionId) };
}
