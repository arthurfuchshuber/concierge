/**
 * F2-B · B1 — Telemetria do turno, por LISTA BRANCA.
 *
 * Só identificador opaco, códigos fixos, contagens, números e versão. Nenhum campo de texto:
 * resposta, pergunta de encaminhamento, mensagem do hóspede, prompt, compromissos e lacunas
 * declaradas pelo modelo NUNCA entram no log.
 */
import type { LlmErrorCode } from "@/lib/guest-ai/llm/contracts";
import type { FallbackKind, OrchestratorResult, Strategy, TurnStage, ValidationBlock } from "./contracts";

export interface TurnLogEvent {
  event: "guest_ai.turn";
  traceId: string | null;
  mode: "shadow";
  outcome: "draft" | "fallback";
  fallback: FallbackKind | null;
  llmCode: LlmErrorCode | null;
  stage: TurnStage;
  model: string;
  reasoningEffort: string;
  latencyMs: number;
  deadlineMs: number;
  llmLatencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  costUsd: number | null;
  validatorVerdict: "pass" | "block" | null;
  validatorBlocks: ValidationBlock[];
  strategy: Strategy | null;
  credentialIntent: "none" | "would_deliver" | null;
  handoffNeeded: boolean | null;
  groundedOnCount: number | null;
  capabilityNeedsCount: number | null;
  promptVersion: string | null;
}

export type TurnLogger = (e: TurnLogEvent) => void;

export const defaultTurnLogger: TurnLogger = (e) => {
  const line = JSON.stringify(e);
  if (e.outcome === "draft") console.info("[guest-ai/turn]", line);
  else console.warn("[guest-ai/turn]", line);
};

export function buildTurnLogEvent(r: OrchestratorResult): TurnLogEvent {
  const t = r.telemetry;
  const draft = r.kind === "draft" ? r : null;
  const validation = r.kind === "draft" ? r.validation : r.validation;
  return {
    event: "guest_ai.turn",
    traceId: t.traceId,
    mode: "shadow",
    outcome: r.kind,
    fallback: r.kind === "fallback" ? r.fallback : null,
    llmCode: r.kind === "fallback" ? r.llmCode : null,
    stage: t.stage,
    model: t.model,
    reasoningEffort: t.reasoningEffort,
    latencyMs: t.latencyMs,
    deadlineMs: t.deadlineMs,
    llmLatencyMs: t.llm ? t.llm.latencyMs : null,
    inputTokens: t.llm ? t.llm.usage.inputTokens : null,
    outputTokens: t.llm ? t.llm.usage.outputTokens : null,
    reasoningTokens: t.llm ? t.llm.usage.reasoningTokens : null,
    costUsd: t.llm ? t.llm.costUsd : null,
    validatorVerdict: validation ? validation.verdict : null,
    validatorBlocks: validation ? [...validation.blocks] : [],
    strategy: draft ? draft.decision.strategy : null,
    credentialIntent: draft ? draft.decision.credentialIntent : null,
    handoffNeeded: draft ? draft.decision.handoff.needed : null,
    groundedOnCount: draft ? draft.decision.groundedOn.length : null,
    capabilityNeedsCount: draft ? draft.decision.capabilityNeeds.length : null,
    promptVersion: t.promptVersion,
  };
}
