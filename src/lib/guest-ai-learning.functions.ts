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

// -------- Qualificação na aprovação: temporalidade e abrangência (10/11/2026) --------

export interface QualifyResult {
  status: "approved" | "rejected";
  replicated: number;
  duplicates: number;
  failed: number;
}

/**
 * Aprovar com qualificação. Pontual ⇒ recusa ("Situação pontual"). Permanente ⇒ aprova; com abrangência
 * cidade/conta, replica para os imóveis do MESMO dono (aprovação de cada réplica pela RPC de revisão, com a
 * sessão de quem decidiu). Nada nasce aprovado sem essa decisão humana.
 */
export const qualifyLearningEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        temporality: z.enum(["permanent", "one_off"]),
        scope: z.enum(["property", "city", "account"]).default("property"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<QualifyResult> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = context.supabase as any;
    const { planQualification } = await import("@/lib/guest-ai-learning/qualify");
    const { data: entry } = await db
      .from("guest_ai_learning_entries")
      .select("id, property_id, category, statement, source, status")
      .eq("id", data.id)
      .maybeSingle();
    if (!entry) throw new Error(REVIEW_ERRORS.not_found);
    const { data: origin } = await db
      .from("properties")
      .select("id, owner_id, city, archived_at")
      .eq("id", entry.property_id)
      .maybeSingle();
    if (!origin) throw new Error(REVIEW_ERRORS.not_found);
    const ref = (p: Record<string, unknown>) => ({
      id: String(p.id),
      ownerId: (p.owner_id as string | null) ?? null,
      city: (p.city as string | null) ?? null,
      archived: !!p.archived_at,
    });
    let siblings: Array<Record<string, unknown>> = [];
    if (data.temporality === "permanent" && data.scope !== "property" && origin.owner_id) {
      const { data: rows } = await db
        .from("properties")
        .select("id, owner_id, city, archived_at")
        .eq("owner_id", origin.owner_id)
        .limit(500);
      siblings = (rows ?? []) as Array<Record<string, unknown>>;
    }
    const plan = planQualification(
      { temporality: data.temporality, scope: data.scope, origin: ref(origin) },
      siblings.map(ref),
    );

    const review = async (id: string, action: "approve" | "reject", note: string | null) => {
      const { error } = await db.rpc("guest_ai_learning_review", { p_id: id, p_action: action, p_note: note });
      if (error) {
        const msg = String((error as { message?: string }).message ?? "");
        const code = Object.keys(REVIEW_ERRORS).find((k) => msg.includes(k));
        throw new Error(code ? REVIEW_ERRORS[code] : "Não foi possível registrar a decisão.");
      }
    };
    await review(data.id, plan.action, plan.note);
    const out: QualifyResult = { status: plan.action === "approve" ? "approved" : "rejected", replicated: 0, duplicates: 0, failed: 0 };

    if (plan.replicateTo.length > 0) {
      const { proposeLearningCandidate } = await import("@/lib/guest-ai-learning.server");
      const note = `Replicado de ${data.id} (${data.scope === "city" ? "mesma cidade" : "todos os imóveis da conta"})`;
      for (const pid of plan.replicateTo) {
        const r = await proposeLearningCandidate({
          propertyId: pid,
          category: String(entry.category),
          statement: String(entry.statement),
          evidence: { source: entry.source, propertyId: pid, refs: [`replica:${data.id}`], closed: true },
        });
        if (!r.ok) {
          out.failed += 1;
          continue;
        }
        if (r.duplicate || !r.id) {
          out.duplicates += 1;
          continue;
        }
        try {
          await review(r.id, "approve", note);
          out.replicated += 1;
        } catch {
          out.failed += 1; // sem permissão naquele imóvel: a réplica fica PENDENTE (nunca aprovada sozinha)
        }
      }
    }
    return out;
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

/** Reverter ao Dossiê (painel de divergências): mesmo efeito do desfazer — a entrada sai do Documento Vivo. */
export const revertLearningEntry = undoLearningEntry;
