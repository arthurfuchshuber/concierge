/**
 * Knowledge Governance — Global Intelligence (equipe SaaS).
 *
 * Conhecimento agregado da plataforma inteira. Nenhum dado identificável de
 * hóspede ou empresa é promovido: apenas padrões e melhores práticas.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { logSystemEvent } from "../audit/events.server";

export async function listGlobalIntelligence(params: {
  supabase: SupabaseClient;
  status?: string;
}): Promise<Array<Record<string, unknown>>> {
  let q = params.supabase
    .from("ai_global_intelligence")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(300);
  if (params.status) q = q.eq("status", params.status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Array<Record<string, unknown>>;
}

export async function upsertGlobalIntelligence(params: {
  supabase: SupabaseClient;
  actorId: string;
  actorName: string | null;
  id?: string | null;
  input: {
    title: string;
    insight: string;
    category: string;
    confidence: number;
    impactEstimate?: string | null;
    impactPercentage?: number | null;
    sourceConversations?: number;
    sourceTenants?: number;
    status?: "draft" | "published" | "archived";
  };
}): Promise<Record<string, unknown>> {
  const payload = {
    title: params.input.title.trim(),
    insight: params.input.insight.trim(),
    category: params.input.category,
    confidence: params.input.confidence,
    impact_estimate: params.input.impactEstimate ?? null,
    impact_percentage: params.input.impactPercentage ?? null,
    source_conversations: params.input.sourceConversations ?? 0,
    source_tenants: params.input.sourceTenants ?? 0,
    status: params.input.status ?? "draft",
    published_at: params.input.status === "published" ? new Date().toISOString() : null,
    created_by: params.actorId,
  };

  const query = params.id
    ? params.supabase.from("ai_global_intelligence").update(payload).eq("id", params.id)
    : params.supabase.from("ai_global_intelligence").insert(payload);
  const { data, error } = await query.select("*").maybeSingle();
  if (error) throw error;

  await logSystemEvent(params.supabase, {
    actorType: "ADMIN",
    actorId: params.actorId,
    actorName: params.actorName,
    actorRole: "admin",
    userId: params.actorId,
    eventType: "knowledge_promoted",
    eventCategory: "LEARNING",
    entityType: "ai_global_intelligence",
    entityId: String((data as Record<string, unknown> | null)?.id ?? params.id ?? ""),
    description: `${params.id ? "Atualizou" : "Criou"} inteligência global: ${payload.title}`,
    reason: "Curadoria da equipe da plataforma",
    source: "saas_admin",
    metadata: { status: payload.status, confidence: payload.confidence },
  });

  return (data ?? {}) as Record<string, unknown>;
}

/** Promove um aprendizado aprovado de um tenant para conhecimento global. */
export async function promoteCandidateToGlobal(params: {
  supabase: SupabaseClient;
  candidateId: string;
  actorId: string;
  actorName: string | null;
}): Promise<Record<string, unknown>> {
  const { data: candidate } = await params.supabase
    .from("ai_learning_candidates")
    .select("*")
    .eq("id", params.candidateId)
    .maybeSingle();
  if (!candidate) throw new Error("Aprendizado não encontrado");

  const row = candidate as Record<string, unknown>;
  const created = await upsertGlobalIntelligence({
    supabase: params.supabase,
    actorId: params.actorId,
    actorName: params.actorName,
    input: {
      title: String(row.title ?? "Padrão identificado"),
      insight: String(row.extracted_information ?? row.proposed_memory ?? ""),
      category: String(row.category ?? "best_practice"),
      confidence: Number(row.confidence ?? 0.6),
      impactEstimate: (row.estimated_impact as string) ?? null,
      sourceConversations: 1,
      sourceTenants: 1,
      status: "draft",
    },
  });

  const history = Array.isArray(row.application_history) ? (row.application_history as unknown[]) : [];
  await params.supabase
    .from("ai_learning_candidates")
    .update({
      promoted_global_id: (created as Record<string, unknown>).id as string,
      application_history: [
        ...history,
        { at: new Date().toISOString(), action: "promoted_to_global", by: params.actorId },
      ] as never,
    })
    .eq("id", params.candidateId);

  return created;
}

/** Pipeline consolidado: conversa → candidato → validação → aprovação → global. */
export async function learningPipeline(params: {
  supabase: SupabaseClient;
  status?: string;
  limit?: number;
}): Promise<Array<Record<string, unknown>>> {
  let q = params.supabase
    .from("ai_learning_candidates")
    .select(
      "id, tenant_id, property_id, title, extracted_information, proposed_memory, learning_type, category, confidence, approval_status, suggested_scope, approved_scope, source_conversation_id, event_origin, created_at, reviewed_at, applied_at, promoted_global_id, validation, estimated_impact",
    )
    .order("created_at", { ascending: false })
    .limit(params.limit ?? 200);
  if (params.status) q = q.eq("approval_status", params.status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Array<Record<string, unknown>>;
}

/** Agrega performance por agente especialista para a página Agent Improvement. */
export async function agentImprovementOverview(params: {
  supabase: SupabaseClient;
  days?: number;
}): Promise<Array<{
  agent: string;
  interactions: number;
  resolutionRate: number | null;
  escalations: number;
  errors: number;
  avgConfidence: number | null;
  suggestions: number;
}>> {
  const days = params.days ?? 30;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data } = await params.supabase
    .from("ai_agent_logs")
    .select("selected_agent, needs_human, confidence, error, escalation_triggered")
    .gte("created_at", since)
    .limit(10000);

  const map = new Map<
    string,
    { interactions: number; resolved: number; escalations: number; errors: number; confSum: number; confN: number }
  >();
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    const agent = String(r.selected_agent ?? "generalist");
    const cur = map.get(agent) ?? { interactions: 0, resolved: 0, escalations: 0, errors: 0, confSum: 0, confN: 0 };
    cur.interactions += 1;
    if (r.needs_human !== true) cur.resolved += 1;
    if (r.escalation_triggered === true) cur.escalations += 1;
    if (r.error) cur.errors += 1;
    if (r.confidence != null) {
      cur.confSum += Number(r.confidence);
      cur.confN += 1;
    }
    map.set(agent, cur);
  }

  const { data: suggestions } = await params.supabase
    .from("ai_prompt_change_candidates")
    .select("prompt_key, status")
    .eq("status", "pending")
    .limit(500);
  const suggByAgent = new Map<string, number>();
  for (const s of (suggestions ?? []) as Array<Record<string, unknown>>) {
    const key = String(s.prompt_key ?? "");
    suggByAgent.set(key, (suggByAgent.get(key) ?? 0) + 1);
  }

  return [...map.entries()]
    .map(([agent, v]) => ({
      agent,
      interactions: v.interactions,
      resolutionRate: v.interactions ? Number((v.resolved / v.interactions).toFixed(4)) : null,
      escalations: v.escalations,
      errors: v.errors,
      avgConfidence: v.confN ? Number((v.confSum / v.confN).toFixed(3)) : null,
      suggestions: suggByAgent.get(agent) ?? 0,
    }))
    .sort((a, b) => b.interactions - a.interactions);
}
