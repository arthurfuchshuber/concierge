/**
 * F2-B · B3.3 — Adaptador do Shadow para as funções do banco (`20261104120000_guest_ai_shadow.sql`).
 *
 * ÚNICA escrita do Shadow, e só pela porta de lista fechada `SHADOW_RPC_FUNCTIONS` (client.server.ts).
 * Nenhum `.insert/.update/.upsert/.delete` (teste estático). As RPCs administrativas (configurar,
 * transicionar, manifesto, retenção, relatório, expurgo) NÃO estão na porta: o worker nunca se ativa,
 * nunca autoriza retenção nem altera o manifesto. Toda resposta é lida por lista branca; formato
 * inesperado ⇒ resultado de erro (fail-closed), nunca autorização.
 */
import type { GuestAiShadowRpc } from "./client.server";
import {
  BUDGET_LIMIT_IDS,
  MANIFEST_CHECK_STATUSES,
  MANIFEST_SELECTION_REASONS,
  RETENTION_SCOPES,
  SHADOW_ALLOWED_MODELS,
  SHADOW_REASONING_EFFORTS,
  SHADOW_STATES,
  UUID_RE,
  type BudgetLimitId,
  type ManifestEntry,
  type ShadowControl,
  type ShadowExecutionRecord,
  type ShadowFailureState,
  type ShadowTransitionReason,
} from "@/lib/guest-ai/shadow-exec/contracts";
import type { ErrorBreakerVerdict, TurnReservation } from "@/lib/guest-ai/shadow-exec/breakers";

const inList = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const intOrNull = (v: unknown): number | null | undefined => (v === null ? null : typeof v === "number" && Number.isInteger(v) ? v : undefined);
const numOrNull = (v: unknown): number | null | undefined => {
  if (v === null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
};

/** Lê o estado global. Qualquer campo fora do formato ⇒ `null` (estado ilegível ⇒ bloqueio). */
export function parseControl(data: unknown): ShadowControl | null {
  const d = obj(data);
  if (!d || d.result !== "ok" || !inList(SHADOW_STATES, d.state) || typeof d.state_version !== "number" || !Number.isInteger(d.state_version)) return null;
  const ints = ["max_input_tokens", "max_output_tokens", "max_total_tokens", "max_daily_tokens", "max_daily_calls", "error_window_minutes", "error_min_sample", "telemetry_retention_days", "tick_interval_seconds", "max_conversations_per_tick", "manifest_version"] as const;
  const iv: Partial<Record<(typeof ints)[number], number | null>> = {};
  for (const k of ints) {
    const v = intOrNull(d[k]);
    if (v === undefined) return null;
    iv[k] = v;
  }
  const turnCost = numOrNull(d.max_turn_cost_usd);
  const dailyCost = numOrNull(d.daily_cost_limit_usd);
  if (turnCost === undefined || dailyCost === undefined) return null;
  if (d.model_id !== null && !inList(SHADOW_ALLOWED_MODELS, d.model_id)) return null;
  if (d.reasoning_effort !== null && !inList(SHADOW_REASONING_EFFORTS, d.reasoning_effort)) return null;
  if (d.budget_day_timezone !== null && typeof d.budget_day_timezone !== "string") return null;
  if (d.retention_scope !== null && !inList(RETENTION_SCOPES, d.retention_scope)) return null;
  if (typeof d.retention_authorized !== "boolean") return null;
  return Object.freeze({
    state: d.state,
    stateVersion: d.state_version,
    modelId: d.model_id as ShadowControl["modelId"],
    reasoningEffort: d.reasoning_effort as ShadowControl["reasoningEffort"],
    maxInputTokens: iv.max_input_tokens ?? null,
    maxOutputTokens: iv.max_output_tokens ?? null,
    maxTotalTokens: iv.max_total_tokens ?? null,
    maxTurnCostUsd: turnCost,
    dailyCostLimitUsd: dailyCost,
    maxDailyTokens: iv.max_daily_tokens ?? null,
    maxDailyCalls: iv.max_daily_calls ?? null,
    errorWindowMinutes: iv.error_window_minutes ?? null,
    errorMinSample: iv.error_min_sample ?? null,
    budgetDayTimezone: d.budget_day_timezone as string | null,
    telemetryRetentionDays: iv.telemetry_retention_days ?? null,
    tickIntervalSeconds: iv.tick_interval_seconds ?? null,
    maxConversationsPerTick: iv.max_conversations_per_tick ?? null,
    manifestVersion: iv.manifest_version ?? null,
    retentionAuthorized: d.retention_authorized === true && d.retention_scope !== null,
    retentionScope: d.retention_scope as ShadowControl["retentionScope"],
  });
}

export interface ManifestSnapshot {
  manifestVersion: number | null;
  entries: readonly ManifestEntry[];
}

/** Manifesto ativo: qualquer entrada fora do formato invalida o manifesto INTEIRO (`null`). */
export function parseManifest(data: unknown): ManifestSnapshot | null {
  const d = obj(data);
  if (!d || d.result !== "ok" || !Array.isArray(d.entries)) return null;
  const version = intOrNull(d.manifest_version);
  if (version === undefined) return null;
  const entries: ManifestEntry[] = [];
  for (const raw of d.entries) {
    const e = obj(raw);
    if (
      !e || version === null ||
      typeof e.tenant_id !== "string" || !UUID_RE.test(e.tenant_id) ||
      typeof e.property_id !== "string" || !UUID_RE.test(e.property_id) ||
      !inList(MANIFEST_SELECTION_REASONS, e.selection_reason) ||
      !inList(MANIFEST_CHECK_STATUSES, e.twin_status) || !inList(MANIFEST_CHECK_STATUSES, e.history_status)
    ) return null;
    entries.push(Object.freeze({ manifestVersion: version, tenantId: e.tenant_id, propertyId: e.property_id, selectionReason: e.selection_reason, twinStatus: e.twin_status, historyStatus: e.history_status }));
  }
  if (new Set(entries.map((e) => e.propertyId)).size !== entries.length) return null;
  return Object.freeze({ manifestVersion: version, entries: Object.freeze(entries) });
}

export type ReserveResult =
  | { kind: "reserved"; reservationId: string }
  | { kind: "exceeded"; limit: BudgetLimitId }
  | { kind: "blocked"; code: "state_not_running" | "config_incomplete" | "duplicate" | "invalid_argument" }
  | { kind: "error" };

export type RecordResult = { kind: "recorded"; breaker: ErrorBreakerVerdict | "integrity_violation" } | { kind: "duplicate" } | { kind: "invalid" } | { kind: "error" };

/** Registro camelCase → colunas snake_case EXATAS da tabela (as mesmas chaves que a RPC exige). */
export function recordToRow(r: ShadowExecutionRecord): Record<string, unknown> {
  const row: Record<string, unknown> = {
    execution_id: r.executionId, tenant_id: r.tenantId, property_id: r.propertyId, conversation_id: r.conversationId, batch_id: r.batchId,
    lease_version: r.leaseVersion, channel: r.channel, chain_version: r.chainVersion, shadow_version: r.shadowVersion, composer_version: r.composerVersion,
    model_id: r.modelId, started_at: r.startedAt, finished_at: r.finishedAt, total_ms: r.totalMs, lease_ms: r.leaseMs, context_ms: r.contextMs,
    gateway_ms: r.gatewayMs, validation_ms: r.validationMs, input_tokens: r.inputTokens, output_tokens: r.outputTokens, reasoning_tokens: r.reasoningTokens,
    total_tokens: r.totalTokens, usage_source: r.usageSource, cost_usd: r.costUsd, gateway_calls: r.gatewayCalls, estimated_input_tokens: r.estimatedInputTokens,
    candidate_available: r.candidateAvailable, decision: r.decision, strategy: r.strategy, intents: [...r.intents], intent_count: r.intentCount,
    commitment_kinds: [...r.commitmentKinds], human_intervention_needed: r.humanInterventionNeeded, handoff_urgency: r.handoffUrgency,
    pause_state: r.pauseState, context_check: r.contextCheck, execution_state: r.executionState, response_discarded: r.responseDiscarded,
    timeout: r.timeout, token_limit_violation: r.tokenLimitViolation, concurrency_detected: r.concurrencyDetected, gateway_error: r.gatewayError,
    budget_exceeded: r.budgetExceeded, refusal_code: r.refusalCode, technical_code: r.technicalCode, block_code: r.blockCode, integrity_code: r.integrityCode,
  };
  for (const [k, v] of Object.entries(r.timings)) row[`timing_${k}`] = v;
  return row;
}

export interface ShadowStore {
  readControl(): Promise<ShadowControl | null>;
  readManifest(): Promise<ManifestSnapshot | null>;
  trip(to: ShadowFailureState, reason: ShadowTransitionReason): Promise<"applied" | "noop" | "error">;
  reserve(executionId: string, reservation: TurnReservation): Promise<ReserveResult>;
  settle(reservationId: string, actual: { tokens: number; costUsd: number; calls: number }): Promise<"settled" | "exhausted" | "error">;
  evaluateBreakers(): Promise<ErrorBreakerVerdict>;
  record(record: ShadowExecutionRecord): Promise<RecordResult>;
}

const BREAKERS: readonly ErrorBreakerVerdict[] = ["ok", "error_rate_exceeded", "consecutive_failures", "measurement_unavailable"];

export function createShadowStore(rpc: GuestAiShadowRpc): ShadowStore {
  const call = async (fn: Parameters<GuestAiShadowRpc["call"]>[0], args: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
    try {
      const { data, error } = await rpc.call(fn, args);
      return error ? null : obj(data);
    } catch {
      return null;
    }
  };
  return {
    async readControl() {
      return parseControl(await call("shadow_get_control", {}));
    },
    async readManifest() {
      return parseManifest(await call("shadow_get_manifest", {}));
    },
    async trip(to, reason) {
      const d = await call("shadow_trip", { p_to: to, p_reason: reason });
      return d?.result === "applied" ? "applied" : d?.result === "noop" ? "noop" : "error";
    },
    async reserve(executionId, r) {
      const d = await call("shadow_reserve_budget", { p_execution_id: executionId, p_tokens: r.tokens, p_cost: r.costUsd, p_calls: r.calls });
      if (!d) return { kind: "error" };
      if (d.result === "reserved" && typeof d.reservation_id === "string" && UUID_RE.test(d.reservation_id)) return { kind: "reserved", reservationId: d.reservation_id };
      if (d.result === "exceeded" && inList(BUDGET_LIMIT_IDS, d.limit)) return { kind: "exceeded", limit: d.limit };
      if (d.result === "state_not_running" || d.result === "config_incomplete" || d.result === "duplicate" || d.result === "invalid_argument") return { kind: "blocked", code: d.result };
      return { kind: "error" };
    },
    async settle(reservationId, a) {
      const d = await call("shadow_settle_budget", { p_reservation_id: reservationId, p_tokens: a.tokens, p_cost: a.costUsd, p_calls: a.calls });
      if (d?.result !== "settled") return "error";
      return d.budget === "exhausted" ? "exhausted" : "settled";
    },
    async evaluateBreakers() {
      const d = await call("shadow_evaluate_breakers", {});
      return d && inList(BREAKERS, d.result) ? d.result : "measurement_unavailable";
    },
    async record(record) {
      let row: Record<string, unknown>;
      try {
        row = recordToRow(record);
      } catch {
        return { kind: "invalid" };
      }
      const d = await call("shadow_record_execution", { p_record: row });
      if (!d) return { kind: "error" };
      if (d.result === "duplicate") return { kind: "duplicate" };
      if (d.result === "invalid_argument") return { kind: "invalid" };
      if (d.result === "recorded" && (d.breaker === "integrity_violation" || inList(BREAKERS, d.breaker))) return { kind: "recorded", breaker: d.breaker as ErrorBreakerVerdict | "integrity_violation" };
      return { kind: "error" };
    },
  };
}

/** Fábrica do servidor, com o sinal ÚNICO da execução. Não é importada por produção. */
export async function getShadowStore(signal?: AbortSignal): Promise<ShadowStore> {
  const { getGuestAiShadowRpc } = await import("./client.server");
  return createShadowStore(await getGuestAiShadowRpc(signal));
}
