/**
 * F2-B · B3.3 — Adaptador do Shadow para as funções do banco (`20261104120000_guest_ai_shadow.sql`).
 *
 * ÚNICA escrita do Shadow, e só pela porta de lista fechada `SHADOW_RPC_FUNCTIONS` (client.server.ts).
 * Nenhum `.insert/.update/.upsert/.delete` (teste estático). As RPCs administrativas (configurar,
 * transicionar, manifesto, retenção, relatório, expurgo) NÃO estão na porta: o worker nunca se ativa,
 * nunca autoriza retenção nem altera o manifesto. Toda resposta é lida por lista branca; formato
 * inesperado ⇒ resultado de erro (fail-closed), nunca autorização.
 *
 * E3.1: trava do tick (`acquireTick`/`releaseTick`), reivindicação+início atômicos (`claimExecution`),
 * finalização atômica (`finalizeExecution`: lease + liquidação + registro + disjuntores numa transação) e
 * reconciliação (`reconcile`). A liquidação avulsa deixou de existir na porta (só dentro do banco).
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
import { toDecimal8 } from "@/lib/guest-ai/shadow-exec/money";

const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
const TOKEN_RE = /^[0-9a-f]{64}$/;
const isoMs = (v: unknown): number | null => (typeof v === "string" && ISO_Z.test(v) && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null);

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
  const dbNowMs = isoMs(d.db_now);
  if (dbNowMs === null) return null;
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
    dbNowMs,
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
  | { kind: "blocked"; code: "state_not_running" | "config_incomplete" | "duplicate" | "invalid_argument" | "not_claimed" }
  | { kind: "error" };

export type TickResult = { kind: "acquired"; token: string; dbNowMs: number; expiresMs: number } | { kind: "busy" } | { kind: "blocked"; code: "state_not_running" | "config_incomplete" } | { kind: "error" };

export interface ClaimArgs {
  tickToken: string;
  executionId: string;
  conversationId: string;
  expectedVersion: number;
  tenantId: string;
  propertyId: string;
  channel: ShadowExecutionRecord["channel"];
}
export type ClaimResult =
  | { kind: "claimed"; version: number; ownerToken: string; batchId: string; messageIds: readonly string[]; repeated: boolean }
  | { kind: "rejected"; code: "state_not_running" | "tick_not_held" | "not_in_manifest" | "not_found" | "stale_version" | "not_claimable" | "attempts_exhausted" | "conflict" | "duplicate" | "invalid_argument" }
  | { kind: "error" };
const CLAIM_REJECTIONS = ["state_not_running", "tick_not_held", "not_in_manifest", "not_found", "stale_version", "not_claimable", "attempts_exhausted", "conflict", "duplicate", "invalid_argument"] as const;

export interface FinalizeArgs {
  executionId: string;
  ownerToken: string;
  outcome: "complete" | "fail";
  /** Uso REAL liquidado (zeros quando o Gateway não foi chamado). */
  settlement: { tokens: number; costUsd: string; calls: number };
  record: ShadowExecutionRecord;
  /** Registro que substitui o normal se a cerca do lease falhar (`lease_integrity_failure`). */
  fencedRecord: ShadowExecutionRecord;
}
export type FinalizeResult =
  | { kind: "finalized"; lease: "completed" | "failed" | "fenced_expired" | "fenced_foreign"; decision: string }
  | { kind: "duplicate" }
  | { kind: "reconciled" }
  | { kind: "not_claimed" }
  | { kind: "invalid" }
  | { kind: "error" };
const FINAL_LEASES = ["completed", "failed", "fenced_expired", "fenced_foreign"] as const;

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
  evaluateBreakers(): Promise<ErrorBreakerVerdict>;
  /** Registro SEM lote (desfechos anteriores à reivindicação). */
  record(record: ShadowExecutionRecord): Promise<RecordResult>;
  acquireTick(): Promise<TickResult>;
  releaseTick(token: string): Promise<"released" | "noop" | "error">;
  claimExecution(args: ClaimArgs): Promise<ClaimResult>;
  finalizeExecution(args: FinalizeArgs): Promise<FinalizeResult>;
  reconcile(tickToken: string): Promise<{ kind: "ok"; reconciled: number } | { kind: "tick_not_held" } | { kind: "error" }>;
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
      let cost: string;
      try {
        cost = toDecimal8(r.costUsd8);
      } catch {
        return { kind: "error" };
      }
      const d = await call("shadow_reserve_budget", { p_execution_id: executionId, p_tokens: r.tokens, p_cost: cost, p_calls: r.calls });
      if (!d) return { kind: "error" };
      if (d.result === "reserved" && typeof d.reservation_id === "string" && UUID_RE.test(d.reservation_id)) return { kind: "reserved", reservationId: d.reservation_id };
      if (d.result === "exceeded" && inList(BUDGET_LIMIT_IDS, d.limit)) return { kind: "exceeded", limit: d.limit };
      if (d.result === "state_not_running" || d.result === "config_incomplete" || d.result === "duplicate" || d.result === "invalid_argument" || d.result === "not_claimed") return { kind: "blocked", code: d.result };
      return { kind: "error" };
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
    async acquireTick() {
      const d = await call("shadow_acquire_tick", {});
      if (!d) return { kind: "error" };
      if (d.result === "acquired") {
        const now = isoMs(d.db_now);
        const exp = isoMs(d.tick_expires_at);
        if (typeof d.tick_token === "string" && TOKEN_RE.test(d.tick_token) && now !== null && exp !== null && exp > now) return { kind: "acquired", token: d.tick_token, dbNowMs: now, expiresMs: exp };
        return { kind: "error" };
      }
      if (d.result === "busy") return { kind: "busy" };
      if (d.result === "state_not_running" || d.result === "config_incomplete") return { kind: "blocked", code: d.result };
      return { kind: "error" };
    },
    async releaseTick(token) {
      const d = await call("shadow_release_tick", { p_tick_token: token });
      return d?.result === "released" ? "released" : d?.result === "noop" ? "noop" : "error";
    },
    async claimExecution(a) {
      const d = await call("shadow_claim_execution", {
        p_tick_token: a.tickToken, p_execution_id: a.executionId, p_conversation_id: a.conversationId, p_expected_version: a.expectedVersion,
        p_tenant_id: a.tenantId, p_property_id: a.propertyId, p_channel: a.channel,
      });
      if (!d) return { kind: "error" };
      if (d.result === "claimed") {
        const ids = d.message_ids;
        if (
          typeof d.version === "number" && Number.isInteger(d.version) && typeof d.owner_token === "string" && TOKEN_RE.test(d.owner_token) &&
          typeof d.batch_id === "string" && UUID_RE.test(d.batch_id) && Array.isArray(ids) && ids.length > 0 && ids.every((x) => typeof x === "string" && UUID_RE.test(x))
        ) return { kind: "claimed", version: d.version, ownerToken: d.owner_token, batchId: d.batch_id, messageIds: Object.freeze([...(ids as string[])]), repeated: d.repeated === true };
        return { kind: "error" };
      }
      if (inList(CLAIM_REJECTIONS, d.result)) return { kind: "rejected", code: d.result };
      return { kind: "error" };
    },
    async finalizeExecution(a) {
      let record: Record<string, unknown>;
      let fenced: Record<string, unknown>;
      try {
        record = recordToRow(a.record);
        fenced = recordToRow(a.fencedRecord);
      } catch {
        return { kind: "invalid" };
      }
      const d = await call("shadow_finalize_execution", {
        p_execution_id: a.executionId, p_owner_token: a.ownerToken, p_outcome: a.outcome,
        p_settlement: { tokens: a.settlement.tokens, cost_usd: a.settlement.costUsd, calls: a.settlement.calls }, p_record: record, p_fenced_record: fenced,
      });
      if (!d) return { kind: "error" };
      if (d.result === "finalized" && inList(FINAL_LEASES, d.lease) && typeof d.decision === "string") return { kind: "finalized", lease: d.lease, decision: d.decision };
      if (d.result === "duplicate") return { kind: "duplicate" };
      if (d.result === "reconciled") return { kind: "reconciled" };
      if (d.result === "not_claimed") return { kind: "not_claimed" };
      if (d.result === "invalid_argument") return { kind: "invalid" };
      return { kind: "error" };
    },
    async reconcile(tickToken) {
      const d = await call("shadow_reconcile", { p_tick_token: tickToken });
      if (d?.result === "ok" && typeof d.reconciled === "number" && Number.isInteger(d.reconciled) && d.reconciled >= 0) return { kind: "ok", reconciled: d.reconciled };
      if (d?.result === "tick_not_held") return { kind: "tick_not_held" };
      return { kind: "error" };
    },
  };
}

/** Fábrica do servidor, com o sinal ÚNICO da execução. Não é importada por produção. */
export async function getShadowStore(signal?: AbortSignal): Promise<ShadowStore> {
  const { getGuestAiShadowRpc } = await import("./client.server");
  return createShadowStore(await getGuestAiShadowRpc(signal));
}
