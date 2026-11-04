/**
 * F2-B · B3.3 — REGRAS PURAS DOS DISJUNTORES (orçamento, taxa de erro técnico, integridade).
 *
 * Determinísticas, sem banco, rede ou relógio. As mesmas regras rodam no SQL (fonte da verdade
 * transacional: `shadow_reserve_budget`, `shadow_record_execution`); o teste `b33-pg` confere a paridade.
 * Valor ausente, nulo, não finito, ≤ 0 ou acima de um teto aprovado ⇒ bloqueio (nunca "ilimitado").
 */
import type { ModelSpec } from "@/lib/guest-ai/llm/models";
import { costUnits, parseUsd8, type Usd8 } from "./money";
import {
  APPROVED_BUDGET_TIMEZONE,
  APPROVED_DAILY_COST_CEILING_USD,
  APPROVED_ERROR_MIN_SAMPLE,
  APPROVED_MAX_CONVERSATIONS_PER_TICK,
  APPROVED_MAX_TURN_COST_USD,
  APPROVED_TICK_INTERVAL_SECONDS,
  GATEWAY_WORST_CASE_ATTEMPTS,
  IANA_ZONE_RE,
  INTEGRITY_CODES,
  NON_EVALUABLE_DECISIONS,
  SHADOW_ALLOWED_MODELS,
  SHADOW_REASONING_EFFORTS,
  SHADOW_STATES,
  RETENTION_SCOPES,
  type BudgetLimitId,
  type IntegrityCode,
  type ShadowControl,
  type ShadowDecision,
  type ShadowLimits,
} from "./contracts";

/** Teto de saída do Gateway (F2-A `LIMITS.maxOutputTokens`), espelhado na CHECK da migration. */
export const GATEWAY_MAX_OUTPUT_TOKENS = 4_096;

const posInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;
const posNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

export type ControlVerdict =
  | { ok: true; limits: ShadowLimits }
  | { ok: false; code: "limits_missing" | "limits_invalid" | "retention_not_authorized" | "model_not_allowed" | "state_unreadable" };

/**
 * Confere a configuração completa exigida para `ready`/`running` e para qualquer chamada ao Gateway.
 * Ordem: estado legível → retenção → modelo → presença dos limites → validade dos limites.
 */
export function validateShadowControl(c: ShadowControl | null | undefined): ControlVerdict {
  if (!c || !(SHADOW_STATES as readonly string[]).includes(c.state) || !Number.isInteger(c.stateVersion) || !Number.isFinite(c.dbNowMs)) return { ok: false, code: "state_unreadable" };
  if (c.retentionAuthorized !== true || c.retentionScope === null || !(RETENTION_SCOPES as readonly string[]).includes(c.retentionScope)) return { ok: false, code: "retention_not_authorized" };
  if (c.modelId === null || !(SHADOW_ALLOWED_MODELS as readonly string[]).includes(c.modelId)) return { ok: false, code: "model_not_allowed" };
  const required = [
    c.reasoningEffort, c.maxInputTokens, c.maxOutputTokens, c.maxTotalTokens, c.maxTurnCostUsd, c.dailyCostLimitUsd, c.maxDailyTokens, c.maxDailyCalls,
    c.errorWindowMinutes, c.errorMinSample, c.budgetDayTimezone, c.telemetryRetentionDays, c.tickIntervalSeconds, c.maxConversationsPerTick, c.manifestVersion,
  ];
  if (required.some((v) => v === null || v === undefined)) return { ok: false, code: "limits_missing" };
  const turnCost8 = parseUsd8(c.maxTurnCostUsd);
  const daily8 = parseUsd8(c.dailyCostLimitUsd);
  const valid =
    turnCost8 !== null &&
    daily8 !== null &&
    turnCost8 > 0n &&
    daily8 > 0n &&
    (c.maxTurnCostUsd as number) <= APPROVED_MAX_TURN_COST_USD &&
    c.errorMinSample === APPROVED_ERROR_MIN_SAMPLE &&
    c.tickIntervalSeconds === APPROVED_TICK_INTERVAL_SECONDS &&
    (c.maxConversationsPerTick as number) <= APPROVED_MAX_CONVERSATIONS_PER_TICK &&
    c.budgetDayTimezone === APPROVED_BUDGET_TIMEZONE &&
    (SHADOW_REASONING_EFFORTS as readonly string[]).includes(c.reasoningEffort as string) &&
    posInt(c.maxInputTokens) &&
    posInt(c.maxOutputTokens) &&
    (c.maxOutputTokens as number) <= GATEWAY_MAX_OUTPUT_TOKENS &&
    posInt(c.maxTotalTokens) &&
    posNum(c.maxTurnCostUsd) &&
    posNum(c.dailyCostLimitUsd) &&
    (c.dailyCostLimitUsd as number) <= APPROVED_DAILY_COST_CEILING_USD &&
    posInt(c.maxDailyTokens) &&
    posInt(c.maxDailyCalls) &&
    posInt(c.errorWindowMinutes) &&
    posInt(c.errorMinSample) &&
    (c.errorMinSample as number) >= 2 &&
    typeof c.budgetDayTimezone === "string" &&
    IANA_ZONE_RE.test(c.budgetDayTimezone) &&
    posInt(c.telemetryRetentionDays) &&
    posInt(c.tickIntervalSeconds) &&
    posInt(c.maxConversationsPerTick) &&
    posInt(c.manifestVersion);
  if (!valid) return { ok: false, code: "limits_invalid" };
  return {
    ok: true,
    limits: Object.freeze({
      modelId: c.modelId,
      reasoningEffort: c.reasoningEffort as ShadowLimits["reasoningEffort"],
      maxInputTokens: c.maxInputTokens as number,
      maxOutputTokens: c.maxOutputTokens as number,
      maxTotalTokens: c.maxTotalTokens as number,
      maxTurnCostUsd: c.maxTurnCostUsd as number,
      dailyCostLimitUsd: c.dailyCostLimitUsd as number,
      maxDailyTokens: c.maxDailyTokens as number,
      maxDailyCalls: c.maxDailyCalls as number,
      errorWindowMinutes: c.errorWindowMinutes as number,
      errorMinSample: c.errorMinSample as number,
      budgetDayTimezone: c.budgetDayTimezone as string,
      telemetryRetentionDays: c.telemetryRetentionDays as number,
      tickIntervalSeconds: c.tickIntervalSeconds as number,
      maxConversationsPerTick: c.maxConversationsPerTick as number,
      manifestVersion: c.manifestVersion as number,
      maxTurnCostUsd8: turnCost8 as Usd8,
      dailyCostLimitUsd8: daily8 as Usd8,
    }),
  };
}

/** Custo (USD) arredondado a 1e-8, como o Gateway (`estimateCostUsd`). */
export function costUsd(spec: Pick<ModelSpec, "pricePerMTok">, inputTokens: number, outputTokens: number): number {
  const raw = (inputTokens / 1_000_000) * spec.pricePerMTok.input + (outputTokens / 1_000_000) * spec.pricePerMTok.output;
  return Math.round(raw * 1e8) / 1e8;
}

export interface TurnReservation {
  /** Tokens reservados no dia: pior caso das tentativas do Gateway. */
  tokens: number;
  /** Custo reservado em unidades exatas de 1e-8 US$. */
  costUsd8: Usd8;
  calls: number;
}

export type TurnBudgetVerdict = { ok: true; reservation: TurnReservation } | { ok: false; limit: BudgetLimitId };

/**
 * Orçamento POR TURNO, antes da rede, no PIOR caso ESTRITO (E3.1 · F-04): a reserva usa os TETOS
 * configurados (entrada máxima + saída máxima enviada ao provedor) × tentativas máximas do Gateway —
 * nunca uma estimativa. `inputBound` é um limite SUPERIOR da entrada (bytes UTF-8 + moldura: cada token
 * cobre ≥ 1 byte); acima do teto de entrada ⇒ bloqueio antes da rede. Assim o uso real nunca passa do
 * reservado enquanto o provedor respeitar o teto de saída — e, se passar, a liquidação desarma o Shadow.
 */
export function evaluateTurnBudget(limits: ShadowLimits, spec: Pick<ModelSpec, "pricePerMTok">, inputBound: number): TurnBudgetVerdict {
  if (!posInt(inputBound) || inputBound > limits.maxInputTokens) return { ok: false, limit: "turn_input_tokens" };
  if (limits.maxOutputTokens > GATEWAY_MAX_OUTPUT_TOKENS) return { ok: false, limit: "turn_output_tokens" };
  const perAttempt = limits.maxInputTokens + limits.maxOutputTokens;
  if (perAttempt > limits.maxTotalTokens) return { ok: false, limit: "turn_total_tokens" };
  const one = costUnits(spec.pricePerMTok, limits.maxInputTokens, limits.maxOutputTokens);
  if (one === null) return { ok: false, limit: "turn_cost" };
  const worst = one * BigInt(GATEWAY_WORST_CASE_ATTEMPTS);
  if (!(worst <= limits.maxTurnCostUsd8)) return { ok: false, limit: "turn_cost" };
  return { ok: true, reservation: { tokens: perAttempt * GATEWAY_WORST_CASE_ATTEMPTS, costUsd8: worst, calls: GATEWAY_WORST_CASE_ATTEMPTS } };
}

/** Uso REAL acima do limite por turno (soma das tentativas) ⇒ violação (`token_limit_violation`). */
export function actualUsageViolation(limits: ShadowLimits, usage: { inputTokens: number; outputTokens: number; totalTokens: number }, calls: number, cost8: Usd8 | null): BudgetLimitId | null {
  const n = Math.max(1, calls);
  if (!(usage.inputTokens <= limits.maxInputTokens * n)) return "turn_input_tokens";
  if (!(usage.outputTokens <= limits.maxOutputTokens * n)) return "turn_output_tokens";
  if (!(usage.totalTokens <= limits.maxTotalTokens * n)) return "turn_total_tokens";
  // custo ilegível ⇒ violação (fail-closed; nunca comparação implícita com null)
  if (typeof cost8 !== "bigint" || !(cost8 <= limits.maxTurnCostUsd8)) return "turn_cost";
  return null;
}

/** Entra no denominador da taxa de erro? (mesma regra da coluna gerada `evaluable` no SQL). */
export function isEvaluable(decision: ShadowDecision): boolean {
  return !(NON_EVALUABLE_DECISIONS as readonly string[]).includes(decision);
}
export function isTechnicalError(decision: ShadowDecision): boolean {
  return decision === "technical_failure";
}

export type ErrorBreakerVerdict = "ok" | "error_rate_exceeded" | "consecutive_failures" | "measurement_unavailable";

/**
 * Disjuntor de erro técnico sobre as execuções AVALIÁVEIS da janela (mais recentes primeiro):
 *  - `n ≥ minSample`: dispara se `erros / n > 5 %` (estrito: exatamente 5 % NÃO dispara);
 *  - `n < minSample`: dispara se as DUAS avaliáveis mais recentes forem falhas técnicas.
 * Entrada ilegível ⇒ `measurement_unavailable` (bloqueio).
 */
export function evaluateErrorBreaker(window: ReadonlyArray<{ evaluable: boolean; technicalError: boolean }> | null | undefined, minSample: number): ErrorBreakerVerdict {
  if (!Array.isArray(window) || !posInt(minSample) || minSample < 2) return "measurement_unavailable";
  const ev = window.filter((r) => r && r.evaluable === true);
  const n = ev.length;
  const errors = ev.filter((r) => r.technicalError === true).length;
  if (n >= minSample) return errors * 100 > n * 5 ? "error_rate_exceeded" : "ok";
  return n >= 2 && ev[0]!.technicalError === true && ev[1]!.technicalError === true ? "consecutive_failures" : "ok";
}

export function isIntegrityCode(code: unknown): code is IntegrityCode {
  return typeof code === "string" && (INTEGRITY_CODES as readonly string[]).includes(code);
}
