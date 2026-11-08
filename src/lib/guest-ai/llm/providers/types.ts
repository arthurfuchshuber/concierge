/** F2-A — contrato interno entre o gateway e um transporte de fornecedor. */
import type { LlmFinishReason, LlmMessage, LlmResponseFormat, LlmToolCall, LlmToolChoice, LlmToolSpec, ReasoningEffort } from "../contracts";
import type { ClassifiedError } from "../errors";
import type { ModelSpec } from "../models";

/** Pedido já validado e normalizado pelo gateway (o transporte não revalida regras de negócio). */
export interface ProviderRequest {
  spec: ModelSpec;
  messages: readonly LlmMessage[];
  maxOutputTokens: number;
  reasoningEffort: ReasoningEffort;
  responseFormat: LlmResponseFormat;
  temperature: number | null;
  /** Ferramentas de consulta (ausente/vazio = nenhuma; o transporte não envia o campo). */
  tools?: readonly LlmToolSpec[];
  /** Padrão `auto` (só com `tools`). */
  toolChoice?: LlmToolChoice;
}

/** Uso bruto informado pelo provedor (campos ausentes = não informado). */
export interface RawUsage {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
}

export type ProviderOutcome =
  | {
      kind: "ok";
      text: string;
      finishReason: LlmFinishReason;
      /** Chamadas de ferramenta pedidas pelo modelo (só quando a requisição ofereceu ferramentas). */
      toolCalls?: readonly LlmToolCall[];
      usage: RawUsage | null;
      requestId: string | null;
    }
  | {
      kind: "error";
      error: ClassifiedError;
      /** Uso já cobrado mesmo na falha (ex.: resposta truncada), quando informado. */
      usage: RawUsage | null;
      requestId: string | null;
    };

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface LlmProvider {
  readonly id: string;
  /**
   * Executa UMA tentativa. Nunca lança por erro HTTP/formato: devolve `kind: "error"`.
   * Pode lançar só quando o `signal` aborta (o gateway distingue timeout de cancelamento).
   */
  complete(req: ProviderRequest, signal: AbortSignal): Promise<ProviderOutcome>;
}
