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
