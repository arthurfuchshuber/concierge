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
  "v1.1.0",
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
O rastro inclui "conversaMascarada" (texto real, com dados pessoais já mascarados) e
"confirmacaoDoHospede" (resposta real do hóspede ao "deu certo?": confirmed, denied ou unanswered).
Confirmação do hóspede pesa mais que a confiança do modelo.
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

    const fb = await negativeFeedback(supabase, conversationId);
    const feedback = fb.count;
    const transcript = await loadMaskedTranscript(supabase, conversationId);

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
      motivosDoFeedback: fb.reasons.map(maskPii),
      confirmacaoDoHospede: transcript.check,
      conversaMascarada: transcript.text,
      perguntas: rows
        .map((r) => (r.intent as Record<string, unknown> | null)?.["question"] ?? null)
        .filter(Boolean)
        .slice(0, 12),
    };

    const heuristic = heuristicOutcome({
      confirmation: transcript.check,
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
  /** resposta real do hóspede ao "deu certo?" (quando a IA perguntou). */
  confirmation?: "confirmed" | "denied" | "unanswered" | null;
}): { outcome: ConversationOutcome; quality: number } {
  if (p.confirmation === "denied") return { outcome: "FAILURE", quality: 0.15 };
  if (p.confirmation === "confirmed" && p.negativeFeedback === 0) return { outcome: "SUCCESS", quality: 0.95 };
  if (p.negativeFeedback > 0 || (p.escalations > 0 && (p.avgConfidence ?? 1) < 0.5)) {
    return { outcome: "FAILURE", quality: 0.2 };
  }
  if (p.humanIntervened || p.needsHumanCount > 0) return { outcome: "PARTIAL", quality: 0.55 };
  if ((p.avgConfidence ?? 0) >= 0.8) return { outcome: "SUCCESS", quality: 0.9 };
  return { outcome: "LEARNING_OPPORTUNITY", quality: 0.65 };
}

/**
 * Cada linha de `chat_message_feedback` é um marcador de "resposta não útil"
 * (colunas reais: reason, resolved, marked_by…; NÃO existe `helpful`). A versão
 * anterior filtrava por `helpful = false` — coluna inexistente —, a consulta
 * falhava e o `catch` devolvia 0: o aprendizado nunca via reclamação alguma.
 */
async function negativeFeedback(
  supabase: Admin,
  conversationId: string,
): Promise<{ count: number; reasons: string[] }> {
  try {
    const { data, error } = await supabase
      .from("chat_message_feedback")
      .select("reason, resolved")
      .eq("conversation_id", conversationId)
      .limit(20);
    if (error) throw error;
    const rows = (data ?? []) as Array<{ reason: string | null; resolved: boolean | null }>;
    return {
      count: rows.length,
      reasons: rows.map((r) => (r.reason ?? "").trim()).filter(Boolean).slice(0, 5),
    };
  } catch (e) {
    console.error("[learning:analyzer] feedback indisponível", e);
    return { count: 0, reasons: [] };
  }
}

/** Mascara dados pessoais/sensíveis antes de enviar texto ao modelo analisador. */
export function maskPii(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\b(?:\+?\d[\s().-]?){9,}\d\b/g, "[número]")
    .replace(/\b(?=\w*[a-zA-Z])(?=\w*\d)\w{4,}\b/g, "[código]")
    .replace(/\b\d{4,}\b/g, "[número]");
}

const CONFIRM_POS = /\b(deu certo|funcionou|resolveu|resolvido|consegui|conseguimos|tudo certo|tudo ok|ja esta|ja ta|normalizou|voltou|obrigad[oa]|perfeito|show)\b/;
const CONFIRM_NEG = /\b(nao (?:deu|resolveu|funcionou|consegui|conseguimos)|continua|ainda (?:nao|esta|ta)|persiste|sem sucesso|piorou|nada)\b/;
const CHECK_MARK = /deu certo por a[ií]|conseguiu resolver|resolveu por a[ií]/i;

/** Lê o desfecho real: a resposta do hóspede ao "deu certo?" enviado pela IA. */
export function readResolutionCheck(
  msgs: Array<{ role: string; content: string | null }>,
): "confirmed" | "denied" | "unanswered" | null {
  const i = msgs.findIndex((m) => m.role === "assistant" && CHECK_MARK.test(m.content ?? ""));
  if (i < 0) return null;
  const reply = msgs.slice(i + 1).find((m) => m.role === "user");
  if (!reply) return "unanswered";
  const t = (reply.content ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (CONFIRM_NEG.test(t)) return "denied";
  if (CONFIRM_POS.test(t)) return "confirmed";
  return "unanswered";
}

async function loadMaskedTranscript(
  supabase: Admin,
  conversationId: string,
): Promise<{ text: string; check: ReturnType<typeof readResolutionCheck> }> {
  try {
    const { data } = await supabase
      .from("property_chat_messages")
      .select("role, content, created_at")
      .eq("conversation_id", conversationId)
      .not("is_internal_note", "is", true)
      .order("created_at", { ascending: true })
      .limit(40);
    const msgs = (data ?? []) as Array<{ role: string; content: string | null }>;
    const text = msgs
      .map((m) => `${m.role === "user" ? "Hóspede" : "IA"}: ${maskPii((m.content ?? "").slice(0, 400))}`)
      .join("\n")
      .slice(0, 6000);
    return { text, check: readResolutionCheck(msgs) };
  } catch {
    return { text: "", check: null };
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
