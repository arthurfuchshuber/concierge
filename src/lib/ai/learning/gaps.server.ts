/**
 * FASE 7 — Automatic Knowledge Gap Detection.
 *
 * Consolida perguntas recorrentes que a IA não soube responder em
 * `ai_knowledge_gaps`, para o anfitrião ver o que falta na base.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConversationAnalysis } from "./types";

type Admin = SupabaseClient;

/** Normaliza o tema para agrupar variações da mesma dúvida. */
export function normalizeTopic(topic: string): string {
  return topic
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(o|a|os|as|de|da|do|em|para|com|um|uma|qual|como|onde|tem|ha)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export async function recordKnowledgeGaps(params: {
  supabase: Admin;
  analysis: ConversationAnalysis;
}): Promise<number> {
  const { supabase, analysis } = params;
  const topics = analysis.unansweredTopics.filter((t) => t.trim().length > 2);
  if (!topics.length) return 0;

  let recorded = 0;
  for (const topic of topics) {
    const key = normalizeTopic(topic);
    if (!key) continue;
    try {
      const { data: existing } = await supabase
        .from("ai_knowledge_gaps")
        .select("id, occurrences, sample_questions, avg_confidence, escalation_count")
        .eq("tenant_id", analysis.tenantId)
        .eq("normalized_key", key)
        .is("resolved_at", null)
        .maybeSingle();

      if (existing?.id) {
        const occurrences = Number(existing.occurrences ?? 1) + 1;
        const samples = Array.isArray(existing.sample_questions) ? existing.sample_questions : [];
        const prevAvg = Number(existing.avg_confidence ?? analysis.avgConfidence ?? 0);
        const nextAvg =
          analysis.avgConfidence == null
            ? prevAvg
            : (prevAvg * (occurrences - 1) + analysis.avgConfidence) / occurrences;

        await supabase
          .from("ai_knowledge_gaps")
          .update({
            occurrences,
            sample_questions: [...samples, topic].slice(-8) as never,
            avg_confidence: Number(nextAvg.toFixed(4)),
            escalation_count: Number(existing.escalation_count ?? 0) + (analysis.escalations > 0 ? 1 : 0),
            last_seen_at: new Date().toISOString(),
            status: occurrences >= 3 ? "recurring" : "open",
          })
          .eq("id", existing.id);
      } else {
        await supabase.from("ai_knowledge_gaps").insert({
          tenant_id: analysis.tenantId,
          owner_id: analysis.ownerId,
          property_id: analysis.propertyId,
          topic: topic.slice(0, 200),
          normalized_key: key,
          sample_questions: [topic] as never,
          occurrences: 1,
          avg_confidence: analysis.avgConfidence,
          escalation_count: analysis.escalations > 0 ? 1 : 0,
          status: "open",
        });
      }
      recorded += 1;
    } catch (err) {
      console.error("[learning:gaps] falha ao registrar lacuna", err);
    }
  }
  return recorded;
}

export async function listKnowledgeGaps(params: {
  supabase: Admin;
  tenantId: string;
  limit?: number;
}) {
  const { data } = await params.supabase
    .from("ai_knowledge_gaps")
    .select("id, property_id, topic, occurrences, avg_confidence, escalation_count, status, first_seen_at, last_seen_at")
    .eq("tenant_id", params.tenantId)
    .is("resolved_at", null)
    .order("occurrences", { ascending: false })
    .limit(params.limit ?? 30);
  return data ?? [];
}

export async function resolveKnowledgeGap(params: {
  supabase: Admin;
  tenantId: string;
  gapId: string;
}): Promise<void> {
  await params.supabase
    .from("ai_knowledge_gaps")
    .update({ status: "resolved", resolved_at: new Date().toISOString() })
    .eq("id", params.gapId)
    .eq("tenant_id", params.tenantId);
}
