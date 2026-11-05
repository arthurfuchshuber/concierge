/**
 * COPILOTO — gerador que liga a cadeia (`runTurnChain`) ao Lovable AI Gateway (`generateGuestLlm`, F2-A).
 *
 * Terceiro (e único novo) chamador do Gateway, ao lado do Orchestrator e do gerador Shadow (o teste
 * `data-boundary` fixa a lista). Reaproveita integralmente o Gateway existente: timeout (≤ 15 s), nova
 * tentativa, classificação dos 17 erros, JSON validado e bloqueio de valores proibidos. Aqui só se somam
 * as regras do Copiloto:
 *  - UMA chamada por geração (a repetição interna é do Gateway e já está no orçamento);
 *  - custo POR TURNO limitado ANTES da rede (limite superior de tokens de entrada em bytes + teto de saída);
 *  - verificação `beforeNetwork` imediatamente antes da chamada (a sugestão ainda é a vigente? não foi
 *    substituída por mensagem mais nova do hóspede?) — se não, nada sai para a rede;
 *  - prazo = o que RESTA do prazo global (nenhuma etapa ganha relógio próprio).
 * Nunca devolve texto de erro do provedor: só códigos fechados (`CopilotGeneratorStop`).
 */
import type { ComposedPrompt } from "@/lib/guest-ai/orchestrator/contracts";
import type { LlmErrorCode, ReasoningEffort } from "@/lib/guest-ai/llm/contracts";
import { generateGuestLlm } from "@/lib/guest-ai/llm/gateway.server";
import type { LlmProvider } from "@/lib/guest-ai/llm/providers/types";
import type { LlmLogger } from "@/lib/guest-ai/llm/telemetry";
import { estimateCostUsd, modelSpec } from "@/lib/guest-ai/llm/models";
import { COPILOT_MAX_TURN_COST_USD } from "./contracts";

export type CopilotGeneratorStopCode =
  | "generator_reused"
  | "deadline_expired"
  | "superseded"
  | "budget_turn_exceeded"
  | "model_unregistered"
  | "gateway_failed";

export class CopilotGeneratorStop extends Error {
  constructor(readonly code: CopilotGeneratorStopCode) {
    super(code);
    this.name = "CopilotGeneratorStop";
  }
}

export interface CopilotGeneratorTelemetry {
  readonly status: "idle" | "blocked" | "called" | "failed";
  readonly blockCode: CopilotGeneratorStopCode | null;
  readonly estimatedInputTokens: number | null;
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly latencyMs: number;
  readonly error: LlmErrorCode | null;
}

export interface CopilotGenerator {
  readonly modelId: string;
  generate(prompt: ComposedPrompt, signal: AbortSignal): Promise<string>;
  telemetry(): CopilotGeneratorTelemetry;
}

export interface CopilotGeneratorDeps {
  modelId: string;
  maxOutputTokens: number;
  reasoningEffort: ReasoningEffort;
  /** Tempo (ms) que resta do prazo global da geração. */
  remainingMs: () => number;
  /** Conferido IMEDIATAMENTE antes da rede: `false` ⇒ a sugestão deixou de ser a vigente (nada é chamado). */
  beforeNetwork: () => Promise<boolean>;
  traceId: string;
  maxTurnCostUsd?: number;
  /** Transporte injetável (testes usam transporte falso; nenhuma chamada externa). */
  provider?: LlmProvider;
  log?: LlmLogger;
  now?: () => number;
}

/** Moldura por mensagem e por requisição (papéis, separadores): margem SUPERIOR, não estimativa. */
export const COPILOT_FRAME_TOKENS_PER_MESSAGE = 16;
export const COPILOT_FRAME_TOKENS_BASE = 64;

/**
 * Limite SUPERIOR de tokens de entrada: bytes UTF-8 de todo o conteúdo + moldura (em BPE por bytes cada
 * token cobre ≥ 1 byte, logo tokens ≤ bytes). Prompt ilegível ⇒ 0 (o orçamento então bloqueia).
 */
export function copilotInputTokenBound(prompt: ComposedPrompt): number {
  if (!prompt || typeof prompt.system !== "string" || !Array.isArray(prompt.messages)) return 0;
  const enc = new TextEncoder();
  let bytes = enc.encode(prompt.system).length;
  for (const m of prompt.messages) {
    if (!m || typeof m.content !== "string") return 0;
    bytes += enc.encode(m.content).length;
  }
  return (
    bytes +
    COPILOT_FRAME_TOKENS_BASE +
    COPILOT_FRAME_TOKENS_PER_MESSAGE * (prompt.messages.length + 1)
  );
}

export function createCopilotGenerator(deps: CopilotGeneratorDeps): CopilotGenerator {
  const now = deps.now ?? (() => performance.now());
  const ceiling = deps.maxTurnCostUsd ?? COPILOT_MAX_TURN_COST_USD;
  let used = false;
  let t: CopilotGeneratorTelemetry = Object.freeze({
    status: "idle",
    blockCode: null,
    estimatedInputTokens: null,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    latencyMs: 0,
    error: null,
  });
  const block = (code: CopilotGeneratorStopCode): never => {
    t = Object.freeze({ ...t, status: "blocked", blockCode: code });
    throw new CopilotGeneratorStop(code);
  };
  return {
    modelId: deps.modelId,
    async generate(prompt, signal) {
      if (used) block("generator_reused");
      used = true;
      const spec = modelSpec(deps.modelId);
      if (!spec) block("model_unregistered");
      if (signal.aborted || deps.remainingMs() <= 0) block("deadline_expired");
      const bound = copilotInputTokenBound(prompt);
      t = Object.freeze({ ...t, estimatedInputTokens: bound });
      // pior caso do turno: toda a entrada (limite superior) + todo o teto de saída
      if (bound <= 0 || estimateCostUsd(spec!, bound, deps.maxOutputTokens) > ceiling)
        block("budget_turn_exceeded");
      if (!(await deps.beforeNetwork())) block("superseded");
      if (signal.aborted || deps.remainingMs() <= 0) block("deadline_expired");

      const t0 = now();
      const result = await generateGuestLlm(
        {
          purpose: "guest_reply",
          model: deps.modelId,
          messages: [{ role: "system", content: prompt.system }, ...prompt.messages],
          maxOutputTokens: deps.maxOutputTokens,
          reasoningEffort: deps.reasoningEffort,
          responseFormat: "json",
          timeoutMs: Math.max(1_000, Math.min(15_000, Math.floor(deps.remainingMs()))),
          signal,
          traceId: deps.traceId,
        },
        { provider: deps.provider, log: deps.log },
      );
      const u = result.telemetry.usage;
      t = Object.freeze({
        ...t,
        status: result.ok ? "called" : "failed",
        calls: result.telemetry.attempts,
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        // uso desconhecido depois de chamar ⇒ custo liquidado pelo pior caso reservado
        costUsd:
          result.telemetry.attempts === 0
            ? 0
            : u.source === "none"
              ? estimateCostUsd(spec!, bound, deps.maxOutputTokens)
              : result.telemetry.costUsd,
        latencyMs: Math.max(0, Math.round(now() - t0)),
        error: result.ok ? null : result.error.code,
      });
      if (!result.ok) throw new CopilotGeneratorStop("gateway_failed");
      return result.text;
    },
    telemetry: () => t,
  };
}
