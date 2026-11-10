import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DECISION_COLUMNS, type HumanDecisionRow } from "@/lib/guest-ai-decision";

/**
 * DECISÃO HUMANA COM 1 CLIQUE (10/11/2026) — server functions da tela. Leitura pela RLS do usuário (membros do
 * imóvel); o clique exige `chat_respond` na conversa e roda o servidor (`guest-ai-decision.server.ts`).
 */

export type ConversationDecision = HumanDecisionRow & { decidedByName: string | null };

const nameOf = (p: { trade_name?: string | null; full_name?: string | null } | undefined) =>
  ((p?.trade_name || p?.full_name) ?? "").trim() || null;

/** Decisões da conversa (mais antigas primeiro). Tabela ausente ou erro de leitura ⇒ lista vazia. */
export const listConversationDecisions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ conversationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<ConversationDecision[]> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = context.supabase as any;
    const { data: rows, error } = await db
      .from("guest_ai_human_decisions")
      .select(DECISION_COLUMNS)
      .eq("conversation_id", data.conversationId)
      .order("created_at", { ascending: true })
      .limit(50);
    if (error || !Array.isArray(rows)) return [];
    const ids = [...new Set((rows as HumanDecisionRow[]).map((r) => r.decided_by).filter((x): x is string => !!x))];
    const names = new Map<string, string | null>();
    if (ids.length > 0) {
      const { data: profs } = await db.from("profiles").select("id, full_name, trade_name").in("id", ids);
      for (const p of (profs ?? []) as Array<{ id: string; full_name?: string | null; trade_name?: string | null }>)
        names.set(p.id, nameOf(p));
    }
    return (rows as HumanDecisionRow[]).map((r) => ({
      ...r,
      options: Array.isArray(r.options) ? r.options : [],
      decidedByName: r.decided_by ? (names.get(r.decided_by) ?? null) : null,
    }));
  });

const ERRORS: Record<string, string> = {
  not_found: "Decisão não encontrada.",
  forbidden: "Você não tem acesso a este imóvel.",
  invalid: "Opção inválida.",
  not_authorized: "Você não tem permissão para aprovar late check-out neste imóvel. Nada foi enviado ao hóspede.",
  late_checkout_rejected: "O horário não pôde ser registrado (precisa ser depois do check-out oficial). Nada foi enviado ao hóspede.",
  action_failed: "Não foi possível registrar o late check-out. Nada foi enviado ao hóspede; responda manualmente.",
  error: "Não foi possível concluir a decisão. Tente novamente.",
};

export type DecideResponse =
  | { ok: true; outcome: "replied" | "silent" | "reply_failed"; message: string | null }
  | { ok: false; alreadyDecided: { by: string | null; at: string | null } | null; message: string };

/** O clique (1 toque). Duplo clique e clique simultâneo de outra pessoa são barrados pelo banco. */
export const decideHumanDecisionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ decisionId: z.string().uuid(), optionId: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<DecideResponse> => {
    const { supabase, userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data: row } = await db
      .from("guest_ai_human_decisions")
      .select("id, conversation_id")
      .eq("id", data.decisionId)
      .maybeSingle();
    if (!row?.conversation_id) return { ok: false, alreadyDecided: null, message: ERRORS.not_found! };
    const { requireChatRespondForConversation } = await import("@/lib/handoff.functions");
    await requireChatRespondForConversation(supabase, userId, String(row.conversation_id));

    const { decideHumanDecision } = await import("@/lib/guest-ai-decision.server");
    const r = await decideHumanDecision({ decisionId: data.decisionId, optionId: data.optionId, userId });
    if (r.ok) {
      return {
        ok: true,
        outcome: r.outcome,
        message: r.outcome === "reply_failed" ? "Decisão registrada, mas a mensagem não chegou ao hóspede. Responda manualmente." : null,
      };
    }
    if (r.code === "already_decided") {
      const { data: d } = await db
        .from("guest_ai_human_decisions")
        .select("decided_by, decided_at")
        .eq("id", data.decisionId)
        .maybeSingle();
      let by: string | null = null;
      if (d?.decided_by) {
        const { data: p } = await db.from("profiles").select("full_name, trade_name").eq("id", d.decided_by).maybeSingle();
        by = nameOf(p ?? undefined);
      }
      return { ok: false, alreadyDecided: { by, at: d?.decided_at ?? null }, message: "Já decidido" };
    }
    return { ok: false, alreadyDecided: null, message: ERRORS[r.code] ?? ERRORS.error! };
  });
