/**
 * Knowledge Distillation + Approval Flow.
 *
 * Toda decisão humana vira candidata a conhecimento (`ai_learning_candidates`).
 * Nada entra na memória de longo prazo sem aprovação explícita de um humano —
 * e uma exceção pontual nunca vira regra permanente (vira exceção temporária).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { chatJson } from "../gateway.server";
import { PROMPTS } from "../prompts";
import { writeMemories } from "../memory/longterm.server";
import type { LearningScope, MemoryKind, MemoryScope } from "../memory/types";

type Admin = SupabaseClient;

export type Distilled = {
  shouldLearn: boolean;
  title: string | null;
  proposedMemory: string;
  category: string | null;
  memoryKind: MemoryKind;
  recommendedScope: LearningScope;
  confidence: number;
  ttlDays: number | null;
  rationale: string | null;
};

const VALID_KINDS: MemoryKind[] = [
  "operational_rule",
  "property_instruction",
  "provider_knowledge",
  "guest_preference",
  "company_policy",
  "temporary_exception",
];

const VALID_SCOPES: LearningScope[] = ["property", "owner_portfolio", "company_global", "temporary_exception"];

/** Escopo de aprovação → escopo da memória de longo prazo. */
export function memoryScopeOf(scope: LearningScope): MemoryScope {
  if (scope === "owner_portfolio") return "owner";
  if (scope === "company_global") return "global";
  return "property";
}

/** Analisa a decisão humana e propõe (ou não) um conhecimento reutilizável. */
export async function distillHumanDecision(params: {
  question: string;
  humanAnswer: string;
  agent?: string;
  propertyName?: string | null;
}): Promise<Distilled | null> {
  try {
    const { data } = await chatJson<Partial<Distilled>>("validation", [
      { role: "system", content: PROMPTS.distillation.text },
      {
        role: "user",
        content:
          `Agente que perguntou: ${params.agent ?? "generalist"}\n` +
          `${params.propertyName ? `Imóvel: ${params.propertyName}\n` : ""}` +
          `Pergunta interna da IA: ${params.question}\n` +
          `Decisão do humano: ${params.humanAnswer}`,
      },
    ]);

    if (!data || !data.shouldLearn || !data.proposedMemory) return null;

    const kind = (VALID_KINDS.includes(data.memoryKind as MemoryKind)
      ? data.memoryKind
      : "operational_rule") as MemoryKind;
    let scope = (VALID_SCOPES.includes(data.recommendedScope as LearningScope)
      ? data.recommendedScope
      : "property") as LearningScope;

    // Exceção pontual jamais vira regra permanente.
    if (kind === "temporary_exception") scope = "temporary_exception";

    return {
      shouldLearn: true,
      title: (data.title ?? null) as string | null,
      proposedMemory: String(data.proposedMemory).slice(0, 1200),
      category: (data.category ?? null) as string | null,
      memoryKind: kind,
      recommendedScope: scope,
      confidence: Math.max(0, Math.min(1, Number(data.confidence ?? 0.7))),
      ttlDays: scope === "temporary_exception" ? Number(data.ttlDays ?? 7) || 7 : (data.ttlDays ?? null),
      rationale: (data.rationale ?? null) as string | null,
    };
  } catch (err) {
    console.error("[learning] destilação falhou", err);
    return null;
  }
}

/** Grava a candidata pendente de aprovação. Nunca escreve na memória direto. */
export async function queueLearningCandidate(params: {
  supabase: Admin;
  ownerId: string;
  propertyId: string | null;
  escalationId?: string | null;
  agent?: string;
  distilled: Distilled;
}): Promise<string | null> {
  try {
    const { data, error } = await params.supabase
      .from("ai_learning_candidates")
      .insert({
        owner_id: params.ownerId,
        tenant_id: params.ownerId,
        property_id: params.propertyId,
        source_escalation_id: params.escalationId ?? null,
        agent_type: params.agent ?? null,
        title: params.distilled.title,
        proposed_memory: params.distilled.proposedMemory,
        category: params.distilled.category,
        memory_kind: params.distilled.memoryKind,
        recommended_scope: params.distilled.recommendedScope,
        confidence: params.distilled.confidence,
        ttl_days: params.distilled.ttlDays,
        rationale: params.distilled.rationale,
        approval_status: "pending",
      })
      .select("id")
      .single();

    if (error) throw error;
    return data?.id ? String(data.id) : null;
  } catch (err) {
    console.error("[learning] falha ao enfileirar candidata", err);
    return null;
  }
}

/**
 * Pipeline completo pós-resposta humana: destila e enfileira para aprovação.
 * Nunca lança — aprendizado jamais pode quebrar o atendimento.
 */
export async function learnFromHumanAnswer(params: {
  supabase: Admin;
  ownerId: string;
  propertyId: string | null;
  propertyName?: string | null;
  escalationId?: string | null;
  agent?: string;
  question: string;
  humanAnswer: string;
}): Promise<{ candidateId: string | null; distilled: Distilled | null }> {
  const distilled = await distillHumanDecision({
    question: params.question,
    humanAnswer: params.humanAnswer,
    agent: params.agent,
    propertyName: params.propertyName,
  });
  if (!distilled) return { candidateId: null, distilled: null };

  const candidateId = await queueLearningCandidate({
    supabase: params.supabase,
    ownerId: params.ownerId,
    propertyId: params.propertyId,
    escalationId: params.escalationId,
    agent: params.agent,
    distilled,
  });
  return { candidateId, distilled };
}

/**
 * Aprovação humana: só aqui o conhecimento entra na memória de longo prazo,
 * com autoria e escopo definidos pelo aprovador.
 */
export async function approveLearningCandidate(params: {
  supabase: Admin;
  candidateId: string;
  reviewerId: string;
  approvedScope?: LearningScope;
  editedMemory?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = params;
  const { data: row, error } = await supabase
    .from("ai_learning_candidates")
    .select("*")
    .eq("id", params.candidateId)
    .single();

  if (error || !row) return { ok: false, error: "candidata não encontrada" };
  if (row.approval_status !== "pending") return { ok: false, error: "candidata já revisada" };

  const scope = (params.approvedScope ?? row.recommended_scope ?? "property") as LearningScope;
  const content = (params.editedMemory ?? row.proposed_memory) as string;

  await writeMemories({
    supabase,
    ownerId: String(row.owner_id),
    propertyId: scope === "company_global" || scope === "owner_portfolio" ? null : (row.property_id as string | null),
    subjectKey: null,
    guestName: null,
    sourceRef: params.candidateId,
    candidates: [
      {
        scope: memoryScopeOf(scope),
        kind: row.memory_kind as MemoryKind,
        category: row.category as string | null,
        title: row.title as string | null,
        content,
        importance: 0.9,
        confidence: 0.95,
        source: "human_approved",
        ttlDays: scope === "temporary_exception" ? Number(row.ttl_days ?? 7) : null,
        author: "equipe",
        approvedBy: params.reviewerId,
        metadata: { candidate_id: params.candidateId, approved_scope: scope },
      },
    ],
  });

  await supabase
    .from("ai_learning_candidates")
    .update({
      approval_status: "approved",
      approved_scope: scope,
      reviewed_by: params.reviewerId,
      reviewed_at: new Date().toISOString(),
      proposed_memory: content,
    })
    .eq("id", params.candidateId);

  return { ok: true };
}

export async function rejectLearningCandidate(params: {
  supabase: Admin;
  candidateId: string;
  reviewerId: string;
}): Promise<{ ok: boolean }> {
  await params.supabase
    .from("ai_learning_candidates")
    .update({
      approval_status: "rejected",
      reviewed_by: params.reviewerId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", params.candidateId);
  return { ok: true };
}
