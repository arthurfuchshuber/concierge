/**
 * F2-A — Observabilidade segura do gateway.
 *
 * O evento de log é montado por LISTA BRANCA de campos: só números, códigos fixos e
 * identificadores opacos. Conteúdo de mensagens, resposta do modelo, chave de API, corpo de
 * erro do provedor e `forbiddenValues` NUNCA entram — não existe campo para eles.
 */
import type { LlmErrorCode, LlmPurpose, LlmResponseFormat, LlmTelemetry, ReasoningEffort } from "./contracts";

export interface LlmCallLogEvent {
  event: "guest_ai.llm.call";
  outcome: "ok" | "error";
  code: LlmErrorCode | null;
  httpStatus: number | null;
  provider: string;
  model: string;
  purpose: LlmPurpose;
  latencyMs: number;
  attempts: number;
  timeoutMs: number;
  reasoningEffort: ReasoningEffort;
  responseFormat: LlmResponseFormat;
  messageCount: number;
  inputChars: number;
  outputChars: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  usageSource: LlmTelemetry["usage"]["source"];
  costUsd: number;
  providerRequestId: string | null;
  traceId: string | null;
}

export type LlmLogger = (event: LlmCallLogEvent) => void;

export const defaultLlmLogger: LlmLogger = (event) => {
  const line = JSON.stringify(event);
  if (event.outcome === "ok") console.info("[guest-ai/llm]", line);
  else console.warn("[guest-ai/llm]", line);
};

export function buildLogEvent(args: {
  outcome: "ok" | "error";
  code: LlmErrorCode | null;
  httpStatus: number | null;
  telemetry: LlmTelemetry;
  timeoutMs: number;
  reasoningEffort: ReasoningEffort;
  responseFormat: LlmResponseFormat;
  messageCount: number;
  inputChars: number;
  outputChars: number;
}): LlmCallLogEvent {
  const t = args.telemetry;
  return {
    event: "guest_ai.llm.call",
    outcome: args.outcome,
    code: args.code,
    httpStatus: args.httpStatus,
    provider: t.provider,
    model: t.model,
    purpose: t.purpose,
    latencyMs: t.latencyMs,
    attempts: t.attempts,
    timeoutMs: args.timeoutMs,
    reasoningEffort: args.reasoningEffort,
    responseFormat: args.responseFormat,
    messageCount: args.messageCount,
    inputChars: args.inputChars,
    outputChars: args.outputChars,
    inputTokens: t.usage.inputTokens,
    outputTokens: t.usage.outputTokens,
    reasoningTokens: t.usage.reasoningTokens,
    totalTokens: t.usage.totalTokens,
    usageSource: t.usage.source,
    costUsd: t.costUsd,
    providerRequestId: t.providerRequestId,
    traceId: t.traceId,
  };
}
