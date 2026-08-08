/**
 * Knowledge Governance — Conhecimento da Operação (`ai_tenant_knowledge`).
 *
 * Regras internas da empresa: políticas, procedimentos, fornecedores.
 * Não duplica dados do imóvel (PROPERTY_DATA continua sendo a fonte oficial).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { logSystemEvent } from "../audit/events.server";

export type TenantKnowledgeInput = {
  title: string;
  category: string;
  content: string;
  knowledgeScope: "TENANT_KNOWLEDGE" | "PORTFOLIO_KNOWLEDGE";
  priority: number;
  propertyId?: string | null;
  status?: "active" | "archived";
};

export const KNOWLEDGE_CATEGORIES = [
  "politica_interna",
  "procedimento",
  "atendimento",
  "fornecedor",
  "processo",
  "financeiro",
  "geral",
] as const;

export async function listTenantKnowledge(params: {
  supabase: SupabaseClient;
  tenantId: string;
  status?: string;
}): Promise<Array<Record<string, unknown>>> {
  let q = params.supabase
    .from("ai_tenant_knowledge")
    .select("*")
    .eq("tenant_id", params.tenantId)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(500);
  if (params.status) q = q.eq("status", params.status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Array<Record<string, unknown>>;
}

export async function upsertTenantKnowledge(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorId: string;
  actorName: string | null;
  actorRole: string | null;
  id?: string | null;
  input: TenantKnowledgeInput;
}): Promise<Record<string, unknown>> {
  const payload = {
    tenant_id: params.tenantId,
    owner_id: params.tenantId,
    property_id: params.input.propertyId ?? null,
    title: params.input.title.trim(),
    category: params.input.category,
    content: params.input.content.trim(),
    knowledge_scope: params.input.knowledgeScope,
    priority: params.input.priority,
    status: params.input.status ?? "active",
    author_id: params.actorId,
    author_name: params.actorName,
  };

  const query = params.id
    ? params.supabase.from("ai_tenant_knowledge").update(payload).eq("id", params.id).eq("tenant_id", params.tenantId)
    : params.supabase.from("ai_tenant_knowledge").insert(payload);

  const { data, error } = await query.select("*").maybeSingle();
  if (error) throw error;

  await logSystemEvent(params.supabase, {
    tenantId: params.tenantId,
    userId: params.actorId,
    actorType: "USER",
    actorId: params.actorId,
    actorName: params.actorName,
    actorRole: params.actorRole,
    eventType: params.id ? "memory_updated" : "memory_created",
    eventCategory: "MEMORY",
    entityType: "ai_tenant_knowledge",
    entityId: String((data as Record<string, unknown> | null)?.id ?? params.id ?? ""),
    description: `${params.id ? "Atualizou" : "Criou"} conhecimento da operação: ${payload.title}`,
    reason: "Cadastro manual de regra interna da empresa",
    source: "admin_panel",
    metadata: { scope: payload.knowledge_scope, category: payload.category, priority: payload.priority },
  });

  return (data ?? {}) as Record<string, unknown>;
}

export async function archiveTenantKnowledge(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorId: string;
  actorName: string | null;
  id: string;
}): Promise<void> {
  const { error } = await params.supabase
    .from("ai_tenant_knowledge")
    .update({ status: "archived" })
    .eq("id", params.id)
    .eq("tenant_id", params.tenantId);
  if (error) throw error;

  await logSystemEvent(params.supabase, {
    tenantId: params.tenantId,
    userId: params.actorId,
    actorType: "USER",
    actorId: params.actorId,
    actorName: params.actorName,
    eventType: "memory_archived",
    eventCategory: "MEMORY",
    entityType: "ai_tenant_knowledge",
    entityId: params.id,
    description: "Arquivou conhecimento da operação",
    reason: "Solicitação manual do cliente",
    source: "admin_panel",
  });
}

/**
 * Memória da Operação — visão consolidada dos padrões aprendidos, sem
 * duplicar nada: lê lacunas, memória operacional e memórias de longo prazo.
 */
export type OperationMemoryInsight = {
  id: string;
  kind: "gap" | "recurrence" | "memory";
  propertyId: string | null;
  propertyName: string | null;
  topic: string;
  detail: string;
  occurrences: number;
  confidence: number | null;
  suggestion: string;
  status: string;
  lastSeenAt: string | null;
};

export async function listOperationMemory(params: {
  supabase: SupabaseClient;
  tenantId: string;
}): Promise<OperationMemoryInsight[]> {
  const { supabase, tenantId } = params;

  const [gapsRes, opsRes, memRes, propsRes] = await Promise.all([
    supabase
      .from("ai_knowledge_gaps")
      .select("id, property_id, topic, sample_questions, occurrences, avg_confidence, status, last_seen_at")
      .eq("tenant_id", tenantId)
      .order("occurrences", { ascending: false })
      .limit(60),
    supabase
      .from("ai_operational_memory")
      .select("id, property_id, category, request, recurrence_count, status, updated_at")
      .eq("tenant_id", tenantId)
      .gte("recurrence_count", 2)
      .order("recurrence_count", { ascending: false })
      .limit(60),
    supabase
      .from("ai_memories")
      .select("id, property_id, title, content, occurrences, confidence, scope, last_seen_at")
      .eq("tenant_id", tenantId)
      .is("expires_at", null)
      .order("occurrences", { ascending: false })
      .limit(60),
    supabase.from("properties").select("id, name").eq("owner_id", tenantId).limit(500),
  ]);

  const names = new Map<string, string>();
  for (const p of (propsRes.data ?? []) as Array<Record<string, unknown>>) {
    names.set(String(p.id), String(p.name ?? ""));
  }
  const nameOf = (id: unknown) => (id ? (names.get(String(id)) ?? null) : null);

  const out: OperationMemoryInsight[] = [];

  for (const g of (gapsRes.data ?? []) as Array<Record<string, unknown>>) {
    const samples = Array.isArray(g.sample_questions) ? (g.sample_questions as unknown[]) : [];
    out.push({
      id: String(g.id),
      kind: "gap",
      propertyId: (g.property_id as string) ?? null,
      propertyName: nameOf(g.property_id),
      topic: String(g.topic ?? "Dúvida recorrente"),
      detail: samples.slice(0, 3).map((s) => String(s)).join(" · ") || "Hóspedes perguntam com frequência sobre este tema.",
      occurrences: Number(g.occurrences ?? 0),
      confidence: g.avg_confidence == null ? null : Number(g.avg_confidence),
      suggestion: "Melhorar a instrução correspondente no guia do imóvel.",
      status: String(g.status ?? "open"),
      lastSeenAt: (g.last_seen_at as string) ?? null,
    });
  }

  for (const o of (opsRes.data ?? []) as Array<Record<string, unknown>>) {
    out.push({
      id: String(o.id),
      kind: "recurrence",
      propertyId: (o.property_id as string) ?? null,
      propertyName: nameOf(o.property_id),
      topic: String(o.category ?? "Ocorrência recorrente"),
      detail: String(o.request ?? ""),
      occurrences: Number(o.recurrence_count ?? 0),
      confidence: null,
      suggestion: "Tratar a causa raiz na operação ou registrar procedimento padrão.",
      status: String(o.status ?? "open"),
      lastSeenAt: (o.updated_at as string) ?? null,
    });
  }

  for (const m of (memRes.data ?? []) as Array<Record<string, unknown>>) {
    out.push({
      id: String(m.id),
      kind: "memory",
      propertyId: (m.property_id as string) ?? null,
      propertyName: nameOf(m.property_id),
      topic: String(m.title ?? "Padrão identificado"),
      detail: String(m.content ?? ""),
      occurrences: Number(m.occurrences ?? 1),
      confidence: m.confidence == null ? null : Number(m.confidence),
      suggestion: "Confirme se o padrão continua válido para a operação.",
      status: String(m.scope ?? "property"),
      lastSeenAt: (m.last_seen_at as string) ?? null,
    });
  }

  return out.sort((a, b) => b.occurrences - a.occurrences).slice(0, 120);
}
