/**
 * FASE 3 — Gestão de candidatos de aprendizado (`ai_learning_candidates`).
 *
 * Persistência com deduplicação, aprovação humana e aplicação na memória de
 * longo prazo. Nenhum caminho aqui grava memória sem aprovação explícita.
 */
import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeMemories } from "../memory/longterm.server";
import { logSystemEvent } from "../audit/events.server";
import type { MemoryKind, MemoryScope } from "../memory/types";
import type { LearningCandidateDraft, SuggestedScope, ValidationVerdict } from "./types";

type Admin = SupabaseClient;

/** Escopo de aprovação → escopo da memória de longo prazo. */
export function memoryScopeOf(scope: SuggestedScope): MemoryScope {
  if (scope === "company_global") return "global";
  if (scope === "owner_portfolio") return "owner";
  if (scope === "reservation") return "guest";
  return "property";
}

function dedupeKeyOf(params: { ownerId: string; propertyId: string | null; content: string }): string {
  const norm = params.content.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256")
    .update(`${params.ownerId}|${params.propertyId ?? "all"}|${norm}`)
    .digest("hex");
}

export type StoreInput = {
  supabase: Admin;
  tenantId: string;
  ownerId: string;
  propertyId: string | null;
  conversationId: string | null;
  agent?: string | null;
  draft: LearningCandidateDraft;
  verdict: ValidationVerdict;
};

/**
 * Grava (ou reforça) uma candidata. Retorna o id ou null se duplicada/rejeitada.
 * Candidata reprovada pelo validador é gravada como `rejected` para auditoria.
 */
export async function storeLearningCandidate(input: StoreInput): Promise<string | null> {
  const { supabase, draft, verdict } = input;
  const dedupeKey = dedupeKeyOf({
    ownerId: input.ownerId,
    propertyId: input.propertyId,
    content: draft.extractedInformation,
  });

  try {
    const { data: existing } = await supabase
      .from("ai_learning_candidates")
      .select("id, approval_status")
      .eq("dedupe_key", dedupeKey)
      .maybeSingle();

    if (existing?.id) {
      // Já conhecido: apenas reforça a evidência, sem duplicar fila.
      await supabase
        .from("ai_learning_candidates")
        .update({ confidence: verdict.confidence, updated_at: new Date().toISOString() })
        .eq("id", existing.id)
        .eq("approval_status", "pending");
      return null;
    }

    const { data, error } = await supabase
      .from("ai_learning_candidates")
      .insert({
        tenant_id: input.tenantId,
        owner_id: input.ownerId,
        property_id: input.propertyId,
        source_conversation_id: input.conversationId,
        agent_type: input.agent ?? null,
        learning_type: draft.learningType,
        title: draft.title,
        proposed_memory: draft.extractedInformation,
        extracted_information: draft.extractedInformation,
        category: draft.category,
        memory_kind: verdict.memoryKind,
        suggested_scope: draft.suggestedScope,
        recommended_scope: verdict.scope,
        confidence: verdict.confidence,
        ttl_days: verdict.ttlDays,
        rationale: draft.rationale,
        validation: {
          approved: verdict.approved,
          risk: verdict.risk,
          conflicts: verdict.conflicts,
          reasons: verdict.reasons,
          evidence: draft.evidence ?? null,
        } as never,
        dedupe_key: dedupeKey,
        // Aprovação humana continua obrigatória: o validador nunca aplica sozinho.
        approval_status: verdict.approved ? "pending" : "rejected",
      })
      .select("id")
      .single();

    if (error) throw error;
    const newId = data?.id ? String(data.id) : null;
    if (newId) {
      await logSystemEvent(supabase, {
        tenantId: input.tenantId,
        actorType: "AI_AGENT",
        actorId: input.agent ?? "learning_loop",
        actorName: input.agent ?? "Continuous Learning Loop",
        eventType: "learning_candidate_created",
        eventCategory: "LEARNING",
        entityType: "ai_learning_candidates",
        entityId: newId,
        conversationId: input.conversationId,
        propertyId: input.propertyId,
        description: draft.title ?? "Novo aprendizado sugerido",
        reason: verdict.reasons.join(" · ") || "Padrão extraído de conversa encerrada",
        source: "learning_loop",
        metadata: { learning_type: draft.learningType, scope: verdict.scope, risk: verdict.risk },
      });
    }
    return newId;
  } catch (err) {
    console.error("[learning:candidates] falha ao gravar candidata", err);
    return null;
  }
}

export type ListInput = {
  supabase: Admin;
  tenantId: string;
  status?: string;
  limit?: number;
};

export async function listLearningCandidates(input: ListInput) {
  const { data } = await input.supabase
    .from("ai_learning_candidates")
    .select(
      "id, property_id, source_conversation_id, agent_type, learning_type, title, extracted_information, proposed_memory, category, memory_kind, suggested_scope, recommended_scope, approved_scope, confidence, ttl_days, rationale, validation, approval_status, reviewed_at, applied_at, created_at",
    )
    .eq("tenant_id", input.tenantId)
    .eq("approval_status", input.status ?? "pending")
    .order("confidence", { ascending: false })
    .limit(input.limit ?? 50);
  return data ?? [];
}

export type ApplyInput = {
  supabase: Admin;
  candidateId: string;
  reviewerId: string;
  tenantId: string;
  approvedScope?: SuggestedScope;
  editedContent?: string | null;
};

/** Aprovação humana — único caminho que escreve na memória de longo prazo. */
export async function approveAndApply(input: ApplyInput): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = input;
  const { data: row, error } = await supabase
    .from("ai_learning_candidates")
    .select("*")
    .eq("id", input.candidateId)
    .eq("tenant_id", input.tenantId)
    .single();

  if (error || !row) return { ok: false, error: "candidata não encontrada" };
  if (row.approval_status !== "pending") return { ok: false, error: "candidata já revisada" };

  const scope = (input.approvedScope ?? row.recommended_scope ?? row.suggested_scope ?? "property") as SuggestedScope;
  const content = String(input.editedContent ?? row.extracted_information ?? row.proposed_memory ?? "");
  if (content.trim().length < 10) return { ok: false, error: "conteúdo vazio" };

  await writeMemories({
    supabase,
    ownerId: String(row.owner_id),
    propertyId: scope === "company_global" || scope === "owner_portfolio" ? null : (row.property_id as string | null),
    subjectKey: null,
    guestName: null,
    sourceRef: input.candidateId,
    candidates: [
      {
        scope: memoryScopeOf(scope),
        kind: (row.memory_kind ?? "operational_rule") as MemoryKind,
        category: row.category as string | null,
        title: row.title as string | null,
        content,
        importance: 0.9,
        confidence: 0.95,
        source: "human_approved",
        ttlDays: scope === "temporary_exception" ? Number(row.ttl_days ?? 7) : null,
        author: "equipe",
        approvedBy: input.reviewerId,
        metadata: { candidate_id: input.candidateId, approved_scope: scope, learning_type: row.learning_type },
      },
    ],
  });

  await supabase
    .from("ai_learning_candidates")
    .update({
      approval_status: "approved",
      approved_scope: scope,
      reviewed_by: input.reviewerId,
      reviewed_at: new Date().toISOString(),
      applied_at: new Date().toISOString(),
      extracted_information: content,
      proposed_memory: content,
    })
    .eq("id", input.candidateId);

  await logSystemEvent(supabase, {
    tenantId: input.tenantId,
    userId: input.reviewerId,
    actorType: "USER",
    actorId: input.reviewerId,
    eventType: "learning_approved",
    eventCategory: "LEARNING",
    entityType: "ai_learning_candidates",
    entityId: input.candidateId,
    conversationId: (row.source_conversation_id as string | null) ?? null,
    propertyId: (row.property_id as string | null) ?? null,
    description: `Aprendizado aprovado e aplicado (${scope})`,
    reason: "Aprovação humana explícita",
    source: "admin_panel",
    metadata: { scope, learning_type: row.learning_type },
  });

  return { ok: true };
}

export async function rejectCandidate(params: {
  supabase: Admin;
  candidateId: string;
  tenantId: string;
  reviewerId: string;
}): Promise<{ ok: boolean }> {
  await params.supabase
    .from("ai_learning_candidates")
    .update({
      approval_status: "rejected",
      reviewed_by: params.reviewerId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", params.candidateId)
    .eq("tenant_id", params.tenantId);

  await logSystemEvent(params.supabase, {
    tenantId: params.tenantId,
    userId: params.reviewerId,
    actorType: "USER",
    actorId: params.reviewerId,
    eventType: "learning_rejected",
    eventCategory: "LEARNING",
    entityType: "ai_learning_candidates",
    entityId: params.candidateId,
    description: "Aprendizado rejeitado",
    reason: "Revisão humana",
    source: "admin_panel",
  });
  return { ok: true };
}
