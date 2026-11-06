/**
 * F2-B · B2.1 — ORÇAMENTO DE CONTEXTO (puro).
 *
 * Mede o prompt REAL (as mensagens exatamente como irão ao Gateway) contra três tetos:
 *  1. tokens estimados ≤ janela do modelo − reserva de saída − margem técnica;
 *  2. caracteres totais ≤ teto do Gateway F2-A (200 mil);
 *  3. número de mensagens ≤ teto do Gateway F2-A (60).
 * Se qualquer teto for ultrapassado, devolve um veredito tipado (`ok: false` + motivo) — NUNCA corta,
 * resume ou descarta conteúdo (diretriz B2.1 §7). Quem decide o que fazer é quem chamou.
 *
 * Estimativa: `ceil(caracteres / 3)` — conservadora para português (o Gate B2.0 mediu com /4; /3
 * superestima de propósito). Não há tokenizador real do Gemini disponível localmente.
 *
 * Honestidade sobre o que NÃO está validado: a janela de 128 mil é PROVISÓRIA (registro F2-A) e a
 * latência com prompts grandes nunca foi medida (D14 desligada). As métricas carregam
 * `capacityValidated: false` e `latencyValidated: false` literais.
 *
 * Este arquivo não importa `llm/` (fronteira estática do módulo): os tetos do Gateway e a janela do
 * modelo são espelhados aqui e um teste garante que são IGUAIS aos de `llm/contracts.ts` e `llm/models.ts`.
 */
import { TURN_MAX_OUTPUT_TOKENS } from "@/lib/guest-ai/orchestrator/contracts";

/** Espelho de `LIMITS` (llm/contracts.ts). Igualdade garantida por teste. */
export const GATEWAY_LIMITS = Object.freeze({ maxMessages: 60, maxTotalChars: 200_000 });
/** Espelho de `CONSERVATIVE_CONTEXT_WINDOW` (llm/models.ts) — provisório. Igualdade garantida por teste. */
export const PROVISIONAL_CONTEXT_WINDOW_TOKENS = 128_000;
export const CHARS_PER_TOKEN_CONSERVATIVE = 3;
/** Margem técnica fixa (erro da estimativa, envelope do provedor, formato JSON). */
export const DEFAULT_SAFETY_MARGIN_TOKENS = 8_000;

export interface BudgetConfig {
  contextWindowTokens: number;
  reservedOutputTokens: number;
  safetyMarginTokens: number;
  gatewayMaxMessages: number;
  gatewayMaxChars: number;
}

export function defaultBudgetConfig(): BudgetConfig {
  return {
    contextWindowTokens: PROVISIONAL_CONTEXT_WINDOW_TOKENS,
    reservedOutputTokens: TURN_MAX_OUTPUT_TOKENS,
    safetyMarginTokens: DEFAULT_SAFETY_MARGIN_TOKENS,
    gatewayMaxMessages: GATEWAY_LIMITS.maxMessages,
    gatewayMaxChars: GATEWAY_LIMITS.maxTotalChars,
  };
}

export function estimateTokens(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.ceil(chars / CHARS_PER_TOKEN_CONSERVATIVE);
}

/** Seção medida (só nome e tamanho — nunca conteúdo). */
export interface SectionMeasure {
  name: string;
  chars: number;
}

export interface BudgetMetrics {
  estimator: "chars_div_3_conservative";
  sections: Array<{ name: string; chars: number; estimatedTokens: number }>;
  messages: number;
  totalChars: number;
  estimatedInputTokens: number;
  contextWindowTokens: number;
  reservedOutputTokens: number;
  safetyMarginTokens: number;
  /** Tokens de entrada disponíveis = janela − saída − margem. */
  availableInputTokens: number;
  gatewayMaxChars: number;
  gatewayMaxMessages: number;
  capacityValidated: false;
  latencyValidated: false;
}

export type BudgetOverReason = "input_tokens" | "gateway_chars" | "gateway_messages" | "invalid_config";

export type BudgetVerdict = { ok: true; metrics: BudgetMetrics } | { ok: false; reason: BudgetOverReason; metrics: BudgetMetrics };

const positiveInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n > 0;

/**
 * Avalia o orçamento das mensagens que iriam ao Gateway. `sections` é só telemetria (nomes e
 * tamanhos das partes); a decisão usa o tamanho REAL de `messages`.
 */
export function evaluateBudget(
  messages: ReadonlyArray<{ content: string }>,
  sections: readonly SectionMeasure[],
  config: BudgetConfig = defaultBudgetConfig(),
): BudgetVerdict {
  const totalChars = messages.reduce((n, m) => n + (typeof m?.content === "string" ? m.content.length : 0), 0);
  const estimatedInputTokens = estimateTokens(totalChars);
  const available = config.contextWindowTokens - config.reservedOutputTokens - config.safetyMarginTokens;
  const metrics: BudgetMetrics = {
    estimator: "chars_div_3_conservative",
    sections: sections.map((s) => ({ name: s.name, chars: s.chars, estimatedTokens: estimateTokens(s.chars) })),
    messages: messages.length,
    totalChars,
    estimatedInputTokens,
    contextWindowTokens: config.contextWindowTokens,
    reservedOutputTokens: config.reservedOutputTokens,
    safetyMarginTokens: config.safetyMarginTokens,
    availableInputTokens: available,
    gatewayMaxChars: config.gatewayMaxChars,
    gatewayMaxMessages: config.gatewayMaxMessages,
    capacityValidated: false,
    latencyValidated: false,
  };

  const validConfig =
    positiveInt(config.contextWindowTokens) &&
    positiveInt(config.reservedOutputTokens) &&
    Number.isInteger(config.safetyMarginTokens) &&
    config.safetyMarginTokens >= 0 &&
    positiveInt(config.gatewayMaxMessages) &&
    positiveInt(config.gatewayMaxChars) &&
    available > 0;
  if (!validConfig) return { ok: false, reason: "invalid_config", metrics };
  if (messages.length === 0 || messages.length > config.gatewayMaxMessages) return { ok: false, reason: "gateway_messages", metrics };
  if (totalChars > config.gatewayMaxChars) return { ok: false, reason: "gateway_chars", metrics };
  if (estimatedInputTokens > available) return { ok: false, reason: "input_tokens", metrics };
  return { ok: true, metrics };
}
