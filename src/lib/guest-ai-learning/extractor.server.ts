/**
 * APRENDIZADO CONTÍNUO · execução do EXTRATOR (Etapa 3 da tranche final, 10/11/2026).
 *
 * UMA chamada ao Gemini Flash por situação encerrada → validação (`parseLearningOutput`) → cada candidato
 * passa por `proposeLearningCandidate` (travas puras + RPC `guest_ai_learning_propose`) e nasce `pending`.
 *
 * - FAIL-CLOSED: só roda com `GUEST_AI_LEARNING_EXTRACTOR=on` (exatamente). Desligado = nada é lido nem chamado.
 * - ISOLAMENTO: o imóvel vem de quem chama (derivado do banco); o modelo nunca escolhe imóvel.
 * - CUSTO: pior caso conferido ANTES da rede (≤ US$ 0,01 por tentativa; o Gateway faz no máximo 2).
 * - NUNCA LANÇA e nunca afeta quem chamou (memória do hóspede, encerramento da conversa).
 * - Logs só com códigos e contagens: nunca o texto da conversa nem do fato.
 */
import { generateGuestLlm } from "@/lib/guest-ai/llm/gateway.server";
import type { LlmProvider } from "@/lib/guest-ai/llm/providers/types";
import { estimateCostUsd, modelSpec } from "@/lib/guest-ai/llm/models";
import { GUEST_AI_RESERVE_MODEL } from "@/lib/guest-ai/orchestrator/contracts";
import { proposeLearningCandidate, type ProposeResult } from "@/lib/guest-ai-learning.server";
import type { LearningCandidateInput } from "@/lib/guest-ai/learning/learning";
import {
  buildLearningPrompt,
  parseLearningOutput,
  LEARNING_EXTRACT_MAX_MESSAGES,
  LEARNING_EXTRACT_MAX_OUTPUT_TOKENS,
  type LearningTrigger,
  type TranscriptMessage,
  type TranscriptSpeaker,
} from "./extractor";

/** Teto do pior caso POR TENTATIVA (o Gateway pode tentar 2 vezes no mesmo modelo). */
export const LEARNING_EXTRACT_MAX_ATTEMPT_COST_USD = 0.01;

export function learningExtractorEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env["GUEST_AI_LEARNING_EXTRACTOR"] === "on";
}

export interface ExtractInput {
  trigger: LearningTrigger;
  /** Imóvel da situação encerrada, lido do banco (nunca do modelo). */
  propertyId: string;
  messages: readonly TranscriptMessage[];
  /** Correlação opaca para logs (sem dado pessoal). */
  traceId: string;
}

export interface ExtractDeps {
  env?: Record<string, string | undefined>;
  provider?: LlmProvider;
  propose?: (c: LearningCandidateInput) => Promise<ProposeResult>;
  log?: (e: Record<string, unknown>) => void;
}

export interface ExtractResult {
  status: "off" | "skipped" | "failed" | "done";
  reason: string | null;
  proposed: number;
  duplicates: number;
  refused: Record<string, number>;
  costUsd: number;
}

const bound = (msgs: readonly { content: unknown }[]) =>
  msgs.reduce((n, m) => n + new TextEncoder().encode(typeof m.content === "string" ? m.content : "").length, 0) + 16;

export async function extractAndProposeLearnings(input: ExtractInput, deps: ExtractDeps = {}): Promise<ExtractResult> {
  const res: ExtractResult = { status: "done", reason: null, proposed: 0, duplicates: 0, refused: {}, costUsd: 0 };
  const log = deps.log ?? ((e) => console.info("[guest-ai-learning]", JSON.stringify(e)));
  const end = (status: ExtractResult["status"], reason: string | null) => {
    res.status = status;
    res.reason = reason;
    log({ trace: input.traceId, trigger: input.trigger, status, reason, proposed: res.proposed, duplicates: res.duplicates, refused: res.refused, costUsd: res.costUsd });
    return res;
  };
  try {
    if (!learningExtractorEnabled(deps.env ?? process.env)) return { ...res, status: "off" };
    if (!input.propertyId) return end("skipped", "no_property");
    const prompt = buildLearningPrompt(input.trigger, input.messages);
    if (!prompt) return end("skipped", "no_conversation");

    const spec = modelSpec(GUEST_AI_RESERVE_MODEL);
    if (!spec) return end("failed", "model_missing");
    const worst = estimateCostUsd(spec, bound(prompt.messages), LEARNING_EXTRACT_MAX_OUTPUT_TOKENS);
    if (worst > LEARNING_EXTRACT_MAX_ATTEMPT_COST_USD) return end("skipped", "budget_call_exceeded");

    const llm = await generateGuestLlm(
      {
        purpose: "evaluation",
        model: GUEST_AI_RESERVE_MODEL,
        messages: prompt.messages,
        maxOutputTokens: LEARNING_EXTRACT_MAX_OUTPUT_TOKENS,
        reasoningEffort: "low",
        responseFormat: "json",
        traceId: `gl-${input.traceId}`.slice(0, 80),
      },
      { provider: deps.provider },
    );
    res.costUsd = llm.telemetry.costUsd;
    if (!llm.ok) return end("failed", `llm_${llm.error.code}`);

    const { candidates, dropped } = parseLearningOutput(llm.json, prompt, input.trigger);
    for (const d of dropped) res.refused[d] = (res.refused[d] ?? 0) + 1;
    const propose = deps.propose ?? ((c: LearningCandidateInput) => proposeLearningCandidate(c));
    for (const c of candidates) {
      const r = await propose({
        propertyId: input.propertyId,
        category: c.category,
        statement: c.statement,
        evidence: { source: c.source, propertyId: input.propertyId, refs: c.refs, closed: true },
      });
      if (r.ok) {
        if (r.duplicate) res.duplicates += 1;
        else res.proposed += 1;
      } else res.refused[r.code] = (res.refused[r.code] ?? 0) + 1;
    }
    return end("done", null);
  } catch {
    return end("failed", "internal_error");
  }
}

// ─────────────── gatilho: atendimento encerrado pela equipe ───────────────

/** Mapeia a linha de `property_chat_messages` para o falante do transcrito. */
export function speakerFromRow(row: { role?: unknown; sender_type?: unknown; is_internal_note?: unknown }): TranscriptSpeaker {
  if (row.is_internal_note === true) return "internal_note";
  if (row.role === "user" && row.sender_type === "guest") return "guest";
  if (row.role === "assistant" && row.sender_type === "human") return "team";
  if (row.role === "assistant") return "ai";
  if (row.sender_type === "system") return "system";
  return "other";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from(table: string): any };

/**
 * Chamado DEPOIS que a equipe marca a conversa como resolvida. Só considera "incidente resolvido pela
 * equipe" quando a equipe de fato atuou (houve encaminhamento ou alguém assumiu). Imóvel lido da própria
 * conversa no banco. Nunca lança.
 */
export async function learnFromResolvedConversation(
  conversationId: string,
  deps: ExtractDeps & { admin?: Admin } = {},
): Promise<ExtractResult | null> {
  try {
    if (!learningExtractorEnabled(deps.env ?? process.env)) return null;
    const admin: Admin =
      deps.admin ?? ((await import("@/integrations/supabase/client.server")).supabaseAdmin as unknown as Admin);
    const { data: conv } = await admin
      .from("property_chat_conversations")
      .select("id, property_id, status, handoff_at, assigned_to")
      .eq("id", conversationId)
      .maybeSingle();
    if (!conv || conv.status !== "resolved" || !conv.property_id) return null;
    if (!conv.handoff_at && !conv.assigned_to) return null; // sem atuação da equipe não é incidente resolvido
    const { data: rows } = await admin
      .from("property_chat_messages")
      .select("id, role, sender_type, content, is_internal_note, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(LEARNING_EXTRACT_MAX_MESSAGES);
    const messages: TranscriptMessage[] = ((rows ?? []) as Array<Record<string, unknown>>)
      .reverse()
      .filter((r) => typeof r["content"] === "string")
      .map((r) => ({ id: String(r["id"]), speaker: speakerFromRow(r), text: String(r["content"]) }));
    return await extractAndProposeLearnings(
      { trigger: "incident_resolved", propertyId: String(conv.property_id), messages, traceId: conversationId },
      deps,
    );
  } catch {
    return null;
  }
}
