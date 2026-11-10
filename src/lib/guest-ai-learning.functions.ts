import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * APRENDIZADO CONTÍNUO — leitura e REVISÃO HUMANA (Etapa 4, 08/11/2026).
 *
 * Tudo com o cliente da SESSÃO do usuário: a leitura obedece à RLS ("learning entries readable by property
 * team") e a decisão vai pelo RPC `guest_ai_learning_review`, que confere no banco se quem decide é o
 * dono, admin ou membro com `ai_train` e só aceita pending→approved|rejected e approved→revoked (autor e
 * instante gravados no histórico). Nenhum atalho administrativo aqui. A tela de revisão começa por mockup.
 */

const STATUS = ["pending", "approved", "rejected", "revoked"] as const;

export interface LearningEntryView {
  id: string;
  propertyId: string;
  category: string;
  statement: string;
  source: string;
  status: (typeof STATUS)[number];
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  history: Array<{ status: string; at: string; note: string | null }>;
}

const ENTRY_COLUMNS = "id, property_id, category, statement, source, status, created_at, decided_at, decision_note";

export const listLearningEntries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ propertyId: z.string().uuid().optional(), status: z.enum(STATUS).optional() })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<LearningEntryView[]> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = context.supabase as any;
    let q = db.from("guest_ai_learning_entries").select(ENTRY_COLUMNS).order("created_at", { ascending: false }).limit(200);
    if (data.propertyId) q = q.eq("property_id", data.propertyId);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error("Não foi possível ler os aprendizados.");
    const list = (rows ?? []) as Array<Record<string, unknown>>;
    const ids = list.map((r) => String(r.id));
    const history = new Map<string, LearningEntryView["history"]>();
    if (ids.length > 0) {
      const { data: ev } = await db
        .from("guest_ai_learning_events")
        .select("entry_id, status, at, note")
        .in("entry_id", ids)
        .order("at", { ascending: true });
      for (const e of (ev ?? []) as Array<Record<string, unknown>>) {
        const k = String(e.entry_id);
        const arr = history.get(k) ?? [];
        arr.push({ status: String(e.status), at: String(e.at), note: (e.note as string | null) ?? null });
        history.set(k, arr);
      }
    }
    return list.map((r) => ({
      id: String(r.id),
      propertyId: String(r.property_id),
      category: String(r.category),
      statement: String(r.statement),
      source: String(r.source),
      status: r.status as LearningEntryView["status"],
      createdAt: String(r.created_at),
      decidedAt: (r.decided_at as string | null) ?? null,
      decisionNote: (r.decision_note as string | null) ?? null,
      history: history.get(String(r.id)) ?? [],
    }));
  });

const REVIEW_ERRORS: Record<string, string> = {
  not_authorized: "Você não tem permissão para revisar aprendizados da IA neste imóvel.",
  invalid_transition: "Este aprendizado já foi decidido e não aceita essa ação.",
  not_found: "Aprendizado não encontrado.",
  no_reviewer: "Sessão expirada. Entre de novo.",
};

export const reviewLearningEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        action: z.enum(["approve", "reject", "revoke"]),
        note: z.string().max(300).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ status: string }> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = context.supabase as any;
    const { data: next, error } = await db.rpc("guest_ai_learning_review", {
      p_id: data.id,
      p_action: data.action,
      p_note: data.note ?? null,
    });
    if (error) {
      const msg = String((error as { message?: string }).message ?? "");
      const code = Object.keys(REVIEW_ERRORS).find((k) => msg.includes(k));
      throw new Error(code ? REVIEW_ERRORS[code] : "Não foi possível registrar a decisão.");
    }
    return { status: String(next) };
  });

// -------- Governança por exceção: desfazer e ajustar escopo (10/11/2026) --------

const SILENT_ERRORS: Record<string, string> = {
  not_found: REVIEW_ERRORS.not_found,
  not_authorized: REVIEW_ERRORS.not_authorized,
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
