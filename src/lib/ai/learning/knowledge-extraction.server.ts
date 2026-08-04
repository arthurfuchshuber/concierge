/**
 * FASE 2 — Knowledge Extraction Engine.
 *
 * Lê a conversa analisada e extrai conhecimento reutilizável: regras implícitas
 * ditas por humanos, instruções operacionais e lacunas de base. Nunca grava
 * memória — apenas propõe candidatos.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { chatJson } from "../gateway.server";
import { definePrompt } from "../prompts";
import {
  LEARNING_TYPES,
  SUGGESTED_SCOPES,
  type ConversationAnalysis,
  type LearningCandidateDraft,
  type LearningType,
  type SuggestedScope,
} from "./types";

type Admin = SupabaseClient;

export const EXTRACTION_PROMPT = definePrompt(
  "learning.extraction",
  "v1.0.0",
  `Você extrai conhecimento reutilizável de conversas de hospedagem já encerradas.
Devolva APENAS JSON: { "candidates": [ ... ] } — no máximo 3 itens, ou lista vazia.
Cada item:
{
  "learningType": "property_rule" | "company_rule" | "global_rule" | "agent_behavior" | "prompt_improvement" | "tool_improvement" | "knowledge_gap",
  "title": "título curto",
  "extractedInformation": "a regra/fato em 1-3 frases, escrita para ser usada por outro agente",
  "category": "checkin | wifi | limpeza | manutenção | pagamento | regras | recomendações | outro",
  "memoryKind": "operational_rule | property_instruction | provider_knowledge | guest_preference | company_policy | temporary_exception",
  "suggestedScope": "reservation" | "property" | "owner_portfolio" | "company_global" | "temporary_exception",
  "confidence": 0..1,
  "ttlDays": número ou null,
  "rationale": "por que vale aprender",
  "evidence": "trecho curto que sustenta"
}
REGRAS DURAS
- Só extraia o que está EXPLÍCITO no material. Nunca deduza políticas.
- Exceção pontual ("dessa vez pode") é SEMPRE temporary_exception com ttlDays curto.
- Preferência de um hóspede específico NUNCA vira regra do imóvel.
- Nada de dados pessoais (documento, telefone, cartão, endereço do hóspede).
- Se não houver nada realmente reutilizável, devolva { "candidates": [] }.`,
);

export type ExtractionInput = {
  supabase: Admin;
  analysis: ConversationAnalysis;
  propertyName?: string | null;
};

export async function extractKnowledge(input: ExtractionInput): Promise<LearningCandidateDraft[]> {
  const { supabase, analysis } = input;
  try {
    const transcript = await loadTranscript(supabase, analysis.conversationId);
    const humanDecisions = await loadHumanDecisions(supabase, analysis.conversationId);
    if (!transcript.length && !humanDecisions.length) return [];

    const { data } = await chatJson<{ candidates?: Array<Record<string, unknown>> }>("validation", [
      { role: "system", content: EXTRACTION_PROMPT.text },
      {
        role: "user",
        content: JSON.stringify({
          imovel: input.propertyName ?? null,
          desfecho: analysis.outcome,
          intencao: analysis.mainIntent,
          lacunasPercebidas: analysis.unansweredTopics,
          decisoesHumanas: humanDecisions,
          conversa: transcript,
        }),
      },
    ]);

    const raw = Array.isArray(data?.candidates) ? data!.candidates! : [];
    return raw.map(normalizeDraft).filter((c): c is LearningCandidateDraft => !!c).slice(0, 3);
  } catch (err) {
    console.error("[learning:extraction] falhou", err);
    return [];
  }
}

function normalizeDraft(row: Record<string, unknown>): LearningCandidateDraft | null {
  const info = String(row["extractedInformation"] ?? "").trim();
  if (info.length < 10) return null;

  const learningType = (LEARNING_TYPES.includes(row["learningType"] as LearningType)
    ? row["learningType"]
    : "property_rule") as LearningType;

  let scope = (SUGGESTED_SCOPES.includes(row["suggestedScope"] as SuggestedScope)
    ? row["suggestedScope"]
    : "property") as SuggestedScope;

  const memoryKind = String(row["memoryKind"] ?? "operational_rule");
  // Exceção pontual jamais vira regra permanente.
  if (memoryKind === "temporary_exception") scope = "temporary_exception";
  // Preferência de hóspede nunca sobe para regra de portfólio/empresa.
  if (memoryKind === "guest_preference" && scope !== "reservation") scope = "property";

  const ttlRaw = Number(row["ttlDays"]);
  const ttlDays = scope === "temporary_exception" ? (Number.isFinite(ttlRaw) && ttlRaw > 0 ? ttlRaw : 7) : Number.isFinite(ttlRaw) && ttlRaw > 0 ? ttlRaw : null;

  return {
    learningType,
    title: row["title"] ? String(row["title"]).slice(0, 160) : null,
    extractedInformation: info.slice(0, 1200),
    category: row["category"] ? String(row["category"]).slice(0, 60) : null,
    memoryKind,
    suggestedScope: scope,
    confidence: Math.max(0, Math.min(1, Number(row["confidence"] ?? 0.6) || 0.6)),
    ttlDays,
    rationale: row["rationale"] ? String(row["rationale"]).slice(0, 600) : null,
    evidence: row["evidence"] ? String(row["evidence"]).slice(0, 600) : null,
  };
}

async function loadTranscript(
  supabase: Admin,
  conversationId: string,
): Promise<Array<{ role: string; text: string }>> {
  const out: Array<{ role: string; text: string }> = [];
  try {
    const { data } = await supabase
      .from("ai_messages")
      .select("role, content, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(60);
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      const text = String(r.content ?? "").trim();
      if (text) out.push({ role: String(r.role ?? "guest"), text: text.slice(0, 800) });
    }
  } catch {
    /* ignorado */
  }
  if (out.length) return out;

  try {
    const { data } = await supabase
      .from("property_chat_messages")
      .select("sender_type, content, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(60);
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      const text = String(r.content ?? "").trim();
      if (text) out.push({ role: String(r.sender_type ?? "guest"), text: text.slice(0, 800) });
    }
  } catch {
    /* ignorado */
  }
  return out;
}

async function loadHumanDecisions(
  supabase: Admin,
  conversationId: string,
): Promise<Array<{ question: string; answer: string }>> {
  try {
    const { data } = await supabase
      .from("ai_human_escalations")
      .select("question_to_human, human_response")
      .eq("conversation_id", conversationId)
      .eq("status", "answered")
      .limit(10);
    return ((data ?? []) as Array<Record<string, unknown>>)
      .filter((r) => !!r.human_response)
      .map((r) => ({
        question: String(r.question_to_human ?? "").slice(0, 500),
        answer: String(r.human_response ?? "").slice(0, 800),
      }));
  } catch {
    return [];
  }
}
