/**
 * Continuous Learning Loop — orquestrador.
 *
 * Encadeia: Analyzer → Extraction → Validation → Candidate → Gaps → Memory
 * Intelligence. Assíncrono e tolerante a falhas: nunca afeta o atendimento.
 *
 * SEGURANÇA (FASE 11): todo conhecimento nasce com origem rastreável
 * (conversa + tenant), passa por validação de risco/escopo e só entra na
 * memória de longo prazo após aprovação humana explícita.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { analyzeConversation } from "./conversation-analyzer.server";
import { extractKnowledge } from "./knowledge-extraction.server";
import { validateKnowledge } from "./validation.server";
import { storeLearningCandidate } from "./candidates.server";
import { recordKnowledgeGaps } from "./gaps.server";
import { applyOutcomeToMemories } from "./memory-intelligence.server";
import type { ConversationAnalysis } from "./types";

type Admin = SupabaseClient;

export type LoopResult = {
  analysis: ConversationAnalysis | null;
  candidates: number;
  gaps: number;
  memoriesScored: number;
};

const EMPTY: LoopResult = { analysis: null, candidates: 0, gaps: 0, memoriesScored: 0 };

export async function runLearningLoop(params: {
  supabase: Admin;
  conversationId: string;
  tenantId: string;
  ownerId: string;
  propertyId?: string | null;
  propertyName?: string | null;
}): Promise<LoopResult> {
  try {
    const analysis = await analyzeConversation({
      supabase: params.supabase,
      conversationId: params.conversationId,
      tenantId: params.tenantId,
      ownerId: params.ownerId,
      propertyId: params.propertyId ?? null,
    });
    if (!analysis) return EMPTY;

    const memoriesScored = await applyOutcomeToMemories({
      supabase: params.supabase,
      conversationId: params.conversationId,
      outcome: analysis.outcome,
    });

    const gaps = await recordKnowledgeGaps({ supabase: params.supabase, analysis });

    // Conversas que correram bem sem nada novo não geram candidatos.
    const shouldExtract = analysis.outcome !== "SUCCESS" || analysis.humanIntervened;
    let candidates = 0;
    if (shouldExtract) {
      const drafts = await extractKnowledge({
        supabase: params.supabase,
        analysis,
        propertyName: params.propertyName ?? null,
      });
      for (const draft of drafts) {
        const verdict = await validateKnowledge({
          supabase: params.supabase,
          ownerId: analysis.ownerId,
          propertyId: analysis.propertyId,
          draft,
        });
        const id = await storeLearningCandidate({
          supabase: params.supabase,
          tenantId: analysis.tenantId,
          ownerId: analysis.ownerId,
          propertyId: analysis.propertyId,
          conversationId: analysis.conversationId,
          agent: analysis.agent,
          draft,
          verdict,
        });
        if (id) candidates += 1;
      }
    }

    return { analysis, candidates, gaps, memoriesScored };
  } catch (err) {
    console.error("[learning:loop] falhou", err);
    return EMPTY;
  }
}

/**
 * Varredura em lote: processa conversas encerradas recentemente que ainda não
 * passaram pelo loop. Usada pelo cron.
 */
export async function sweepLearningLoop(params: {
  supabase: Admin;
  hours?: number;
  limit?: number;
}): Promise<{ processed: number; candidates: number; gaps: number }> {
  const since = new Date(Date.now() - (params.hours ?? 24) * 3_600_000).toISOString();
  const { data } = await params.supabase
    .from("ai_agent_logs")
    .select("conversation_id, tenant_id, owner_id, property_id, created_at")
    .gte("created_at", since)
    .not("conversation_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1000);

  const seen = new Set<string>();
  const targets: Array<{ conversationId: string; tenantId: string; ownerId: string; propertyId: string | null }> = [];
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const cid = String(row.conversation_id ?? "");
    if (!cid || seen.has(cid)) continue;
    seen.add(cid);
    targets.push({
      conversationId: cid,
      tenantId: String(row.tenant_id ?? row.owner_id ?? ""),
      ownerId: String(row.owner_id ?? row.tenant_id ?? ""),
      propertyId: (row.property_id as string | null) ?? null,
    });
    if (targets.length >= (params.limit ?? 25)) break;
  }

  let processed = 0;
  let candidates = 0;
  let gaps = 0;
  for (const t of targets) {
    if (!t.tenantId || !t.ownerId) continue;
    // Já processado? Evita retrabalho e duplicidade de lacunas.
    const { data: existing } = await params.supabase
      .from("ai_learning_candidates")
      .select("id")
      .eq("source_conversation_id", t.conversationId)
      .limit(1);
    if (existing?.length) continue;

    const res = await runLearningLoop({ supabase: params.supabase, ...t });
    if (res.analysis) processed += 1;
    candidates += res.candidates;
    gaps += res.gaps;
  }
  return { processed, candidates, gaps };
}
