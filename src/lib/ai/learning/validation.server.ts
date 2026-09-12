/**
 * FASE 4 — Knowledge Validation Agent.
 *
 * Antes de qualquer candidato virar conhecimento, um segundo agente avalia
 * risco, escopo e conflito com memórias já existentes. Ele só pode RESTRINGIR
 * (rebaixar escopo, exigir humano) — nunca ampliar.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { chatJson } from "../gateway.server";
import { definePrompt } from "../prompts";
import { SUGGESTED_SCOPES, type LearningCandidateDraft, type SuggestedScope, type ValidationVerdict } from "./types";

type Admin = SupabaseClient;

export const VALIDATION_PROMPT = definePrompt(
  "learning.validation",
  "v1.0.0",
  `Você é o guardião do conhecimento de uma plataforma de hospedagem multi-cliente.
Avalie se o conhecimento proposto pode ser aprendido e em que escopo.
Responda APENAS JSON:
{
  "approved": true|false,
  "scope": "reservation" | "property" | "owner_portfolio" | "company_global" | "temporary_exception",
  "memoryKind": "operational_rule | property_instruction | provider_knowledge | guest_preference | company_policy | temporary_exception",
  "confidence": 0..1,
  "ttlDays": número ou null,
  "risk": "low" | "medium" | "high",
  "conflicts": ["memória existente que ele contradiz"],
  "reasons": ["justificativas curtas"]
}
REGRAS DURAS
- Você só pode RESTRINGIR o escopo proposto, nunca ampliá-lo.
- "company_global" exige que a regra valha para QUALQUER imóvel de QUALQUER cliente. Na dúvida, rebaixe.
- Informação específica de um hóspede ou de uma estadia = "reservation" ou "temporary_exception".
- Contradição com memória existente ⇒ approved=false e liste em "conflicts".
- Conteúdo com dado pessoal, preço negociado pontual ou promessa fora de política ⇒ approved=false, risk="high".`,
);

export type ValidateInput = {
  supabase: Admin;
  ownerId: string;
  propertyId: string | null;
  draft: LearningCandidateDraft;
};

/** Ordem de restrição: índice maior = escopo mais amplo. */
const BREADTH: SuggestedScope[] = [
  "temporary_exception",
  "reservation",
  "property",
  "owner_portfolio",
  "company_global",
];

export async function validateKnowledge(input: ValidateInput): Promise<ValidationVerdict> {
  const { draft } = input;
  const fallback: ValidationVerdict = {
    approved: false,
    scope: draft.suggestedScope,
    memoryKind: draft.memoryKind,
    confidence: draft.confidence,
    ttlDays: draft.ttlDays,
    risk: "medium",
    conflicts: [],
    reasons: ["Validação automática indisponível — requer revisão humana."],
  };

  try {
    const existing = await relatedMemories(input);

    const { data } = await chatJson<Partial<ValidationVerdict>>("validation", [
      { role: "system", content: VALIDATION_PROMPT.text },
      {
        role: "user",
        content: JSON.stringify({
          proposto: {
            tipo: draft.learningType,
            titulo: draft.title,
            conteudo: draft.extractedInformation,
            categoria: draft.category,
            memoryKind: draft.memoryKind,
            escopoSugerido: draft.suggestedScope,
            confianca: draft.confidence,
            evidencia: draft.evidence,
          },
          memoriasExistentes: existing,
        }),
      },
    ]);

    if (!data) return fallback;

    let scope = (SUGGESTED_SCOPES.includes(data.scope as SuggestedScope)
      ? data.scope
      : draft.suggestedScope) as SuggestedScope;

    // Nunca ampliar além do proposto.
    if (BREADTH.indexOf(scope) > BREADTH.indexOf(draft.suggestedScope)) scope = draft.suggestedScope;

    const memoryKind = String(data.memoryKind ?? draft.memoryKind);
    if (memoryKind === "temporary_exception") scope = "temporary_exception";

    const conflicts = (data.conflicts ?? []).map((c) => String(c)).slice(0, 5);
    const risk = (["low", "medium", "high"].includes(String(data.risk)) ? data.risk : "medium") as
      | "low"
      | "medium"
      | "high";

    return {
      approved: !!data.approved && conflicts.length === 0 && risk !== "high",
      scope,
      memoryKind,
      confidence: Math.max(0, Math.min(1, Number(data.confidence ?? draft.confidence) || draft.confidence)),
      ttlDays:
        scope === "temporary_exception"
          ? Number(data.ttlDays ?? draft.ttlDays ?? 7) || 7
          : (data.ttlDays ?? draft.ttlDays ?? null),
      risk,
      conflicts,
      reasons: (data.reasons ?? []).map((r) => String(r)).slice(0, 5),
    };
  } catch (err) {
    console.error("[learning:validation] falhou", err);
    return fallback;
  }
}

async function relatedMemories(input: ValidateInput): Promise<Array<{ title: string | null; content: string }>> {
  try {
    let query = input.supabase
      .from("ai_memories")
      .select("title, content, property_id, category")
      .eq("owner_id", input.ownerId)
      .order("last_seen_at", { ascending: false })
      .limit(12);
    if (input.draft.category) query = query.eq("category", input.draft.category);
    const { data } = await query;
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      title: (r.title as string | null) ?? null,
      content: String(r.content ?? "").slice(0, 400),
    }));
  } catch {
    return [];
  }
}
