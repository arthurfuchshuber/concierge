/**
 * FASE 1 — Conversation Analyzer.
 *
 * Após uma conversa encerrada, reconstrói o que aconteceu a partir do rastro
 * já existente (`ai_agent_logs`, `ai_human_escalations`, feedback do hóspede)
 * e classifica o desfecho: SUCCESS, PARTIAL, FAILURE ou LEARNING_OPPORTUNITY.
 *
 * Nunca lança: análise jamais pode quebrar o atendimento.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { chatJson } from "../gateway.server";
import { definePrompt } from "../prompts";
import type { ConversationAnalysis, ConversationOutcome } from "./types";

type Admin = SupabaseClient;

export const ANALYZER_PROMPT = definePrompt(
  "learning.analyzer",
  "v1.0.0",
  `Você audita conversas de um concierge de hospedagem já encerradas.
Analise o rastro fornecido (intenção, agente, ferramentas, fontes, confiança, escalonamentos, feedback)
e devolva APENAS JSON:
{
  "outcome": "SUCCESS" | "PARTIAL" | "FAILURE" | "LEARNING_OPPORTUNITY",
  "qualityScore": 0..1,
  "satisfaction": "positive" | "neutral" | "negative" | null,
  "unansweredTopics": ["tema em 2-6 palavras"],
  "reasoning": "1-3 frases objetivas"
}
Critérios:
- SUCCESS: a IA resolveu sozinha, com confiança alta e sem intervenção humana.
- PARTIAL: resolveu em parte, exigiu reforço humano ou deixou dúvida.
- FAILURE: não resolveu, escalou por falta de informação ou o hóspede reclamou.
- LEARNING_OPPORTUNITY: resolveu, mas há informação que deveria estar na base.
Nunca invente temas que não aparecem no rastro. Nunca inclua dados sensíveis
(documento, cartão, senha pessoal do hóspede) em "unansweredTopics".`,
);

const HEURISTIC_ONLY_REASON = "Classificação heurística (modelo indisponível).";

export type AnalyzeInput = {
  supabase: Admin;
  conversationId: string;
  tenantId: string;
  ownerId: string;
  propertyId?: string | null;
};

export async function analyzeConversation(input: AnalyzeInput): Promise<ConversationAnalysis | null> {
  const { supabase, conversationId } = input;
  try {
    const { data: logs } = await supabase
      .from("ai_agent_logs")
      .select(
        "intent, selected_agent, tools_used, sources, confidence, needs_human, escalation_triggered, human_response_used, property_id, created_at, reflection",
      )
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(60);

    const rows = (logs ?? []) as Array<Record<string, unknown>>;
    if (!rows.length) return null;

    const confidences = rows
      .map((r) => Number(r.confidence))
      .filter((n) => Number.isFinite(n));
    const avgConfidence = confidences.length
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : null;

    const toolsUsed = uniq(
      rows.flatMap((r) => asArray(r.tools_used).map((t) => String((t as Record<string, unknown>)?.name ?? t))),
    );
    const sourcesUsed = uniq(
      rows.flatMap((r) => asArray(r.sources).map((s) => String((s as Record<string, unknown>)?.source ?? s))),
    );
    const escalations = rows.filter((r) => r.escalation_triggered === true).length;
    const humanIntervened = rows.some((r) => r.human_response_used === true) || escalations > 0;
    const needsHumanCount = rows.filter((r) => r.needs_human === true).length;
    const mainIntent = pickIntent(rows);
    const agent =
      ([...rows].reverse().find((r) => !!r.selected_agent)?.selected_agent as string | null) ?? null;

    const feedback = await negativeFeedbackCount(supabase, conversationId);

    const trace = {
      mensagens: rows.length,
      intencao: mainIntent,
      agente: agent,
      ferramentas: toolsUsed,
      fontes: sourcesUsed,
      confiancaMedia: avgConfidence,
      escalonamentos: escalations,
      intervencaoHumana: humanIntervened,
      respostasSemConfianca: needsHumanCount,
      feedbackNegativo: feedback,
      perguntas: rows
        .map((r) => (r.intent as Record<string, unknown> | null)?.["question"] ?? null)
        .filter(Boolean)
        .slice(0, 12),
    };

    const heuristic = heuristicOutcome({
      avgConfidence,
      escalations,
      needsHumanCount,
      humanIntervened,
      negativeFeedback: feedback,
    });

    let outcome: ConversationOutcome = heuristic.outcome;
    let qualityScore = heuristic.quality;
    let satisfaction: ConversationAnalysis["satisfaction"] = feedback > 0 ? "negative" : null;
    let unansweredTopics: string[] = [];
    let reasoning = HEURISTIC_ONLY_REASON;

    const { data } = await chatJson<{
      outcome?: string;
      qualityScore?: number;
      satisfaction?: string | null;
      unansweredTopics?: string[];
      reasoning?: string;
    }>("validation", [
      { role: "system", content: ANALYZER_PROMPT.text },
      { role: "user", content: JSON.stringify(trace) },
    ]);

    if (data?.outcome && ["SUCCESS", "PARTIAL", "FAILURE", "LEARNING_OPPORTUNITY"].includes(data.outcome)) {
      outcome = data.outcome as ConversationOutcome;
      qualityScore = clamp01(Number(data.qualityScore ?? heuristic.quality));
      satisfaction = normalizeSatisfaction(data.satisfaction) ?? satisfaction;
      unansweredTopics = (data.unansweredTopics ?? [])
        .map((t) => String(t).trim())
        .filter((t) => t.length > 2)
        .slice(0, 6);
      reasoning = String(data.reasoning ?? "").slice(0, 500) || reasoning;
    }

    return {
      conversationId,
      tenantId: input.tenantId,
      ownerId: input.ownerId,
      propertyId: input.propertyId ?? ((rows[0]?.property_id as string | null) ?? null),
      outcome,
      qualityScore,
      mainIntent,
      agent,
      toolsUsed,
      sourcesUsed,
      avgConfidence,
      humanIntervened,
      escalations,
      satisfaction,
      unansweredTopics,
      reasoning,
      messageCount: rows.length,
    };
  } catch (err) {
    console.error("[learning:analyzer] falhou", err);
    return null;
  }
}

function heuristicOutcome(p: {
  avgConfidence: number | null;
  escalations: number;
  needsHumanCount: number;
  humanIntervened: boolean;
  negativeFeedback: number;
}): { outcome: ConversationOutcome; quality: number } {
  if (p.negativeFeedback > 0 || (p.escalations > 0 && (p.avgConfidence ?? 1) < 0.5)) {
    return { outcome: "FAILURE", quality: 0.2 };
  }
  if (p.humanIntervened || p.needsHumanCount > 0) return { outcome: "PARTIAL", quality: 0.55 };
  if ((p.avgConfidence ?? 0) >= 0.8) return { outcome: "SUCCESS", quality: 0.9 };
  return { outcome: "LEARNING_OPPORTUNITY", quality: 0.65 };
}

async function negativeFeedbackCount(supabase: Admin, conversationId: string): Promise<number> {
  try {
    const { count } = await supabase
      .from("chat_message_feedback")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversationId)
      .eq("helpful", false);
    return count ?? 0;
  } catch {
    return 0;
  }
}

function pickIntent(rows: Array<Record<string, unknown>>): string | null {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const intent = r.intent as Record<string, unknown> | null;
    const key = intent?.["category"] ?? intent?.["intent"] ?? null;
    if (!key) continue;
    const k = String(key);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best: string | null = null;
  let max = 0;
  for (const [k, v] of counts) if (v > max) ((best = k), (max = v));
  return best;
}

function normalizeSatisfaction(value: unknown): ConversationAnalysis["satisfaction"] {
  const v = typeof value === "string" ? value.toLowerCase() : null;
  if (v === "positive" || v === "neutral" || v === "negative") return v;
  return null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function uniq(list: string[]): string[] {
  return [...new Set(list.filter(Boolean))].slice(0, 20);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}
