/**
 * FASE 6 — Prompt Improvement Engine.
 *
 * Detecta padrões repetidos de falha e propõe ajustes de prompt em
 * `ai_prompt_change_candidates`. NUNCA altera prompt automaticamente:
 * `prompts.ts` continua sendo a única fonte de verdade, editada por humanos.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { chatJson } from "../gateway.server";
import { PROMPTS, definePrompt, type PromptKey } from "../prompts";

type Admin = SupabaseClient;

export const OPTIMIZER_PROMPT = definePrompt(
  "learning.prompt_optimizer",
  "v1.0.0",
  `Você melhora prompts de um concierge de hospedagem com base em falhas reais.
Responda APENAS JSON:
{
  "suggestion": "trecho de instrução a ACRESCENTAR ou substituir, pronto para colar",
  "reason": "o padrão de falha que isso corrige",
  "expectedImpact": "o que deve melhorar",
  "confidence": 0..1
}
REGRAS DURAS
- Proponha no máximo um ajuste pequeno e cirúrgico; nunca reescreva o prompt inteiro.
- Nunca reduza regras de segurança, escalonamento ou proibição de ações físicas.
- Se as falhas forem por falta de dados na base (e não por instrução), responda
  { "suggestion": "", "reason": "lacuna de conhecimento, não de prompt", "expectedImpact": "", "confidence": 0 }.`,
);

export type PromptSuggestion = {
  promptKey: string;
  suggestion: string;
  reason: string;
  expectedImpact: string;
  confidence: number;
  sampleSize: number;
};

/** Analisa falhas recentes e propõe (para revisão humana) um ajuste de prompt. */
export async function proposePromptImprovement(params: {
  supabase: Admin;
  tenantId: string;
  promptKey?: PromptKey;
  days?: number;
  minFailures?: number;
}): Promise<PromptSuggestion | null> {
  const promptKey = params.promptKey ?? "agent";
  const days = params.days ?? 14;
  const minFailures = params.minFailures ?? 5;

  try {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const { data } = await params.supabase
      .from("ai_agent_logs")
      .select("intent, confidence, needs_human, validation, reflection, selected_agent")
      .eq("tenant_id", params.tenantId)
      .eq("needs_human", true)
      .gte("created_at", since)
      .limit(200);

    const failures = (data ?? []) as Array<Record<string, unknown>>;
    if (failures.length < minFailures) return null;

    const entry = PROMPTS[promptKey];
    const digest = failures.slice(0, 40).map((f) => ({
      agente: f.selected_agent,
      confianca: f.confidence,
      intencao: (f.intent as Record<string, unknown> | null)?.["category"] ?? null,
      validacao: (f.validation as Record<string, unknown> | null)?.["reason"] ?? null,
      reflexao: (f.reflection as Record<string, unknown> | null)?.["critique"] ?? null,
    }));

    const { data: out } = await chatJson<{
      suggestion?: string;
      reason?: string;
      expectedImpact?: string;
      confidence?: number;
    }>("validation", [
      { role: "system", content: OPTIMIZER_PROMPT.text },
      {
        role: "user",
        content: JSON.stringify({
          promptId: entry.id,
          promptVersion: entry.version,
          promptAtual: entry.text.slice(0, 4000),
          falhasRecentes: digest,
        }),
      },
    ]);

    const suggestion = String(out?.suggestion ?? "").trim();
    if (!suggestion) return null;

    const result: PromptSuggestion = {
      promptKey: entry.id,
      suggestion: suggestion.slice(0, 2000),
      reason: String(out?.reason ?? "").slice(0, 600),
      expectedImpact: String(out?.expectedImpact ?? "").slice(0, 600),
      confidence: Math.max(0, Math.min(1, Number(out?.confidence ?? 0.5) || 0.5)),
      sampleSize: failures.length,
    };

    await params.supabase.from("ai_prompt_change_candidates").insert({
      tenant_id: params.tenantId,
      owner_id: params.tenantId,
      prompt_key: entry.id,
      prompt_version: entry.version,
      current_prompt: entry.text.slice(0, 8000),
      suggestion: result.suggestion,
      reason: result.reason,
      expected_impact: result.expectedImpact,
      evidence: { amostra: digest.slice(0, 10) } as never,
      sample_size: result.sampleSize,
      confidence: result.confidence,
      status: "pending",
    });

    return result;
  } catch (err) {
    console.error("[learning:prompt-optimizer] falhou", err);
    return null;
  }
}

export async function listPromptSuggestions(params: { supabase: Admin; tenantId: string; limit?: number }) {
  const { data } = await params.supabase
    .from("ai_prompt_change_candidates")
    .select("id, prompt_key, prompt_version, suggestion, reason, expected_impact, sample_size, confidence, status, created_at")
    .eq("tenant_id", params.tenantId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(params.limit ?? 20);
  return data ?? [];
}

export async function reviewPromptSuggestion(params: {
  supabase: Admin;
  tenantId: string;
  suggestionId: string;
  reviewerId: string;
  status: "approved" | "rejected";
}): Promise<void> {
  await params.supabase
    .from("ai_prompt_change_candidates")
    .update({ status: params.status, reviewed_by: params.reviewerId, reviewed_at: new Date().toISOString() })
    .eq("id", params.suggestionId)
    .eq("tenant_id", params.tenantId);
}
