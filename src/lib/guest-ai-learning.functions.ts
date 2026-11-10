import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * APRENDIZADO CONTÍNUO — governança por EXCEÇÃO (10/11/2026). Todo aprendizado entra aprovado na hora; não há
 * fila nem aprovação manual. A equipe só intervém se discordar: Desfazer (aprovado ⇒ revogado) e ajustar escopo,
 * com a mesma regra de permissão da RPC de revisão (dono, admin ou `ai_train`).
 */

// -------- Governança por exceção: desfazer e ajustar escopo (10/11/2026) --------

const SILENT_ERRORS: Record<string, string> = {
  not_found: "Aprendizado não encontrado.",
  not_authorized: "Você não tem permissão para ajustar aprendizados da IA neste imóvel.",
  invalid_transition: "Só um aprendizado ativo pode ter o escopo ajustado.",
};
const silentError = (e: unknown) => {
  const m = e instanceof Error ? e.message : "";
  return new Error(SILENT_ERRORS[m] ?? "Não foi possível concluir a ação.");
};

/** Desfazer com 1 clique: a entrada (e as réplicas) saem do Documento Vivo na hora. */
export const undoLearningEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ closed: number }> => {
    const { undoLearning } = await import("@/lib/guest-ai-learning/silent.server");
    try {
      return { closed: await undoLearning({ entryId: data.id, userId: context.userId }) };
    } catch (e) {
      throw silentError(e);
    }
  });

/** Ajustar escopo: imóvel, cidade (mesma conta) ou todos os imóveis da conta. */
export const updateLearningEntryScope = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), scope: z.enum(["property", "city", "account"]) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ removed: number; replicated: number }> => {
    const { setLearningScope } = await import("@/lib/guest-ai-learning/silent.server");
    try {
      return await setLearningScope({ entryId: data.id, userId: context.userId, scope: data.scope });
    } catch (e) {
      throw silentError(e);
    }
  });

// -------- Selo "IA aprendeu" no chat (10/11/2026) --------

export interface ConversationLearning {
  messageId: string;
  entryId: string;
  statement: string;
  scope: "property" | "city" | "account";
}

/** Aprendizados ATIVOS gerados por mensagens desta conversa (leitura com a sessão: respeita RLS). */
export const getConversationLearnings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ conversationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<ConversationLearning[]> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = context.supabase as any;
    const { data: conv } = await db
      .from("property_chat_conversations")
      .select("id, property_id")
      .eq("id", data.conversationId)
      .maybeSingle();
    if (!conv?.property_id) return [];
    const { data: msgs } = await db
      .from("property_chat_messages")
      .select("id")
      .eq("conversation_id", data.conversationId)
      .eq("sender_type", "human")
      .limit(500);
    const ids = ((msgs ?? []) as Array<{ id: string }>).map((m) => m.id);
    if (ids.length === 0) return [];
    const { data: rows } = await db
      .from("guest_ai_learning_entries")
      .select("id, property_id, statement, evidence_refs")
      .eq("property_id", conv.property_id)
      .eq("status", "approved")
      .overlaps("evidence_refs", ids);
    const list = ((rows ?? []) as Array<Record<string, unknown>>).filter((r) => !isReplicaRefs(r["evidence_refs"]));
    const { scopesFor } = await import("@/lib/guest-ai-learning/views.server");
    const scopes = await scopesFor(db, list.map((r) => ({ id: String(r["id"]), propertyId: String(r["property_id"]) })));
    const idSet = new Set(ids);
    const out: ConversationLearning[] = [];
    for (const r of list) {
      const msgId = ((r["evidence_refs"] as string[] | null) ?? []).find((x) => idSet.has(x));
      if (!msgId) continue;
      out.push({ messageId: msgId, entryId: String(r["id"]), statement: String(r["statement"]), scope: scopes.get(String(r["id"]))?.scope ?? "property" });
    }
    return out;
  });

const isReplicaRefs = (refs: unknown) =>
  Array.isArray(refs) && refs.some((x) => typeof x === "string" && x.startsWith("replica:"));
