/**
 * B3.3 · utilitários de teste do Shadow com Gateway real (NENHUMA chamada externa):
 * store Shadow em memória (mesmas regras do SQL), lease falso dirigido pelo MODELO de referência B3.1
 * (`applyLeaseEvent`), transporte falso do Gateway, `io` do worker com captura de tudo que sai.
 */
import { issue } from "@/lib/guest-ai/trust";
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import { applyLeaseEvent, newLeaseRecord, type DistributedLeaseStore, type LeaseRecord, type StoreClaimResult, type StoreTransitionResult } from "@/lib/guest-ai/batch/lease";
import type { LlmProvider, ProviderOutcome } from "@/lib/guest-ai/llm/providers/types";
import type { LlmCallLogEvent } from "@/lib/guest-ai/llm/telemetry";
import type { CandidatesListResult, ClaimArgs, ClaimResult, FinalizeArgs, FinalizeResult, PropertyStatusResult, RecordResult, ReserveResult, ShadowCandidateRow, ShadowStore, TickResult } from "@/lib/guest-ai/data/shadow-store.server";
import type { OwnershipLoad } from "@/lib/guest-ai/data/conversation-ownership.server";
import type { CollectorWindowSource } from "@/lib/guest-ai/data/collector.server";
import type { ShadowCandidate } from "@/lib/guest-ai/data/shadow-candidates.server";
import type { PropertyGateReason, ShadowControl, ShadowExecutionRecord, ShadowFailureState, ShadowTransitionReason } from "@/lib/guest-ai/shadow-exec/contracts";
import { evaluateErrorBreaker, isEvaluable, isTechnicalError, type ErrorBreakerVerdict, type TurnReservation } from "@/lib/guest-ai/shadow-exec/breakers";
import { parseUsd8 } from "@/lib/guest-ai/shadow-exec/money";
import type { ShadowWorkerIo } from "@/lib/guest-ai/shadow-exec/worker.server";
import { conversationContext } from "./b21-fixtures";
import { CONV, MSG, TURN_FIELDS, history } from "./b23-chain";
import { operationalPorts, ownershipRow, staySource } from "./b25-fixtures";

export const T_ID = "7a000000-0000-4000-8000-000000000001";
export const P_ID = "7b000000-0000-4000-8000-000000000002";
export const OTHER_T = "7a000000-0000-4000-8000-0000000000ff";
export const OTHER_P = "7b000000-0000-4000-8000-0000000000ff";
export const EXEC_ID = "7e000000-0000-4000-8000-000000000003";
export { CONV, MSG };

/** Canário: se aparecer em QUALQUER destino proibido, o teste falha. */
export const CANARY = "CANARIO-SHADOW-9f3e7c21";

export const shadowTurn = (over: Partial<ValidatedTurn> = {}): ValidatedTurn => issue("turn", { ...TURN_FIELDS, tenantId: T_ID, propertyId: P_ID, ...over }) as ValidatedTurn;

export function shadowCtx() {
  const base = conversationContext();
  return conversationContext({ property: { ...base.guest.property, id: P_ID, tenantId: T_ID } });
}

export const candidate = (over: Partial<ShadowCandidate> = {}): ShadowCandidate => ({ conversationId: CONV, propertyId: P_ID, tenantId: T_ID, surface: "guide_chat", messageId: MSG, ...over });

export const T0 = Date.parse("2026-11-03T10:01:00Z");
/** Token da trava do tick nos testes em memória. */
export const TICK = "c".repeat(64);

/** Configuração completa com os parâmetros HOMOLOGADOS da Entrega 3.1 (pior caso US$ 0,13072/turno). */
export function fullControl(over: Partial<ShadowControl> = {}): ShadowControl {
  return {
    state: "running",
    stateVersion: 7,
    modelId: "openai/gpt-5.6-sol",
    reasoningEffort: "low",
    maxInputTokens: 40_000,
    maxOutputTokens: 1_536,
    maxTotalTokens: 42_000,
    maxTurnCostUsd: 0.15,
    dailyCostLimitUsd: 1,
    maxDailyTokens: 5_000_000,
    maxDailyCalls: 500,
    errorWindowMinutes: 60,
    errorMinSample: 20,
    budgetDayTimezone: "UTC",
    telemetryRetentionDays: 30,
    tickIntervalSeconds: 60,
    maxConversationsPerTick: 3,
    propertyScope: "all_eligible",
    retentionAuthorized: true,
    retentionScope: "openai_responses",
    dbNowMs: T0,
    ...over,
  };
}

/** E4 global: linha de candidata como o banco devolve (`shadow_list_candidates`). */
export const candidateRow = (over: Partial<ShadowCandidateRow> = {}): ShadowCandidateRow => ({ conversationId: CONV, propertyId: P_ID, tenantId: T_ID, surface: "guide_chat", messageId: MSG, ...over });

const usd = (u: bigint) => Number(u) / 1e8;

/**
 * Store Shadow em memória com as MESMAS regras do SQL (reserva atômica e idempotente, reivindicação só de
 * `ready` com a trava do tick, finalização atômica com cerca, disjuntores, CAS de estado).
 */
export class MemoryShadowStore implements ShadowStore {
  control: ShadowControl | null = fullControl();
  /** E4 global: dono de cada imóvel e bloqueios da porta (mesma regra de `guest_ai_shadow_property_gate`). */
  owners = new Map<string, string>([[P_ID, T_ID]]);
  gateBlocked = new Map<string, PropertyGateReason>();
  candidates: CandidatesListResult = { kind: "ok", candidates: [] };
  records: ShadowExecutionRecord[] = [];
  trips: Array<{ to: ShadowFailureState; reason: ShadowTransitionReason }> = [];
  reservations = new Map<string, { executionId: string; tokens: number; cost: number; calls: number; settled: boolean; settledCost: number | null }>();
  reservedCost = 0;
  settledCost = 0;
  breaker: ErrorBreakerVerdict | null = null;
  fail: Partial<Record<"readControl" | "propertyStatus" | "listCandidates" | "reserve" | "finalize" | "record" | "evaluate" | "trip" | "claim" | "tick" | "reconcile", boolean>> = {};
  calls: string[] = [];
  /** Lease usado pela reivindicação/finalização (o mesmo do worker). */
  lease: ModelLeaseStore | null = null;
  tickToken: string | null = TICK;
  inflight = new Map<string, { conversationId: string; version: number; batchId: string; status: "running" | "finalized" | "reconciled" }>();
  finalizations: FinalizeArgs[] = [];
  private n = 0;
  async readControl() {
    this.calls.push("readControl");
    return this.fail.readControl ? null : this.control;
  }
  gate(tenantId: string, propertyId: string): PropertyGateReason | null {
    if (this.control?.propertyScope !== "all_eligible") return "scope_off";
    const owner = this.owners.get(propertyId);
    if (!owner) return "property_not_found";
    if (owner !== tenantId) return "tenant_mismatch";
    return this.gateBlocked.get(propertyId) ?? null;
  }
  async propertyStatus(tenantId: string, propertyId: string): Promise<PropertyStatusResult> {
    this.calls.push("propertyStatus");
    if (this.fail.propertyStatus) return { kind: "error" };
    const g = this.gate(tenantId, propertyId);
    return g === null ? { kind: "active" } : { kind: "blocked", reason: g };
  }
  async listCandidates(tickToken: string, _lookbackSeconds: number, limit: number): Promise<CandidatesListResult> {
    this.calls.push("listCandidates");
    if (this.fail.listCandidates) return { kind: "error", integrity: false };
    if (tickToken !== this.tickToken) return { kind: "blocked", code: "tick_not_held" };
    if (this.candidates.kind !== "ok") return this.candidates;
    return { kind: "ok", candidates: this.candidates.candidates.slice(0, limit) };
  }
  async trip(to: ShadowFailureState, reason: ShadowTransitionReason) {
    this.calls.push(`trip:${to}`);
    if (this.fail.trip) return "error" as const;
    this.trips.push({ to, reason });
    if (this.control && (this.control.state === "running" || to === "integrity_violation")) this.control = { ...this.control, state: to, stateVersion: this.control.stateVersion + 1 };
    return "applied" as const;
  }
  async reserve(executionId: string, r: TurnReservation): Promise<ReserveResult> {
    this.calls.push("reserve");
    if (this.fail.reserve) return { kind: "error" };
    const existing = [...this.reservations.entries()].find(([, x]) => x.executionId === executionId);
    if (existing) return { kind: "reserved", reservationId: existing[0] };
    if (this.inflight.size > 0 && this.inflight.get(executionId)?.status !== "running") return { kind: "blocked", code: "not_claimed" };
    if (!this.control || this.control.state !== "running") return { kind: "blocked", code: "state_not_running" };
    const cost = usd(r.costUsd8);
    if (r.costUsd8 > (parseUsd8(this.control.maxTurnCostUsd) ?? 0n)) return { kind: "exceeded", limit: "turn_cost" };
    // A1 (espelho do banco): cota diária esgotada recusa a reserva SEM desarmar
    if (this.settledCost + this.reservedCost + cost > (this.control.dailyCostLimitUsd ?? 0) + 1e-12) return { kind: "exceeded", limit: "daily_cost" };
    this.n++;
    const id = `7f000000-0000-4000-8000-${String(this.n).padStart(12, "0")}`;
    this.reservations.set(id, { executionId, tokens: r.tokens, cost, calls: r.calls, settled: false, settledCost: null });
    this.reservedCost += cost;
    return { kind: "reserved", reservationId: id };
  }
  async evaluateBreakers(): Promise<ErrorBreakerVerdict> {
    this.calls.push("evaluate");
    if (this.fail.evaluate) return "measurement_unavailable";
    if (this.breaker) return this.breaker;
    return evaluateErrorBreaker(
      [...this.records].reverse().map((r) => ({ evaluable: isEvaluable(r.decision), technicalError: isTechnicalError(r.decision) })),
      this.control?.errorMinSample ?? 0,
    );
  }
  async record(r: ShadowExecutionRecord): Promise<RecordResult> {
    this.calls.push("record");
    if (this.fail.record) return { kind: "error" };
    if (r.batchId !== null) return { kind: "invalid" };
    if (this.records.some((x) => x.executionId === r.executionId)) return { kind: "duplicate" };
    this.records.push(r);
    return { kind: "recorded", breaker: "ok" };
  }
  async acquireTick(): Promise<TickResult> {
    this.calls.push("acquireTick");
    if (this.fail.tick) return { kind: "error" };
    if (!this.control || this.control.state !== "running") return { kind: "blocked", code: "state_not_running" };
    return { kind: "acquired", token: TICK, dbNowMs: this.control.dbNowMs, expiresMs: this.control.dbNowMs + 55_000 };
  }
  async releaseTick() {
    this.calls.push("releaseTick");
    return "released" as const;
  }
  async reconcile() {
    this.calls.push("reconcile");
    return this.fail.reconcile ? { kind: "error" as const } : { kind: "ok" as const, reconciled: 0 };
  }
  async claimExecution(a: ClaimArgs): Promise<ClaimResult> {
    this.calls.push("claim");
    if (this.fail.claim) return { kind: "error" };
    const prev = this.inflight.get(a.executionId);
    if (prev) return { kind: "rejected", code: "duplicate" };
    if (!this.control || this.control.state !== "running") return { kind: "rejected", code: "state_not_running" };
    if (a.tickToken !== this.tickToken) return { kind: "rejected", code: "tick_not_held" };
    const g = this.gate(a.tenantId, a.propertyId);
    if (g !== null) return { kind: "property_blocked", reason: g };
    if (!this.lease) return { kind: "error" };
    const c = await this.lease.claim(a.conversationId, a.expectedVersion);
    if (c.result !== "acquired") return { kind: "rejected", code: c.result === "stale_version" ? "stale_version" : "not_claimable" };
    const st = await this.lease.transition(a.conversationId, "start", c.version, { ownerToken: c.ownerToken });
    if (st.result !== "applied") return { kind: "error" };
    this.inflight.set(a.executionId, { conversationId: a.conversationId, version: st.version!, batchId: c.batchId, status: "running" });
    return { kind: "claimed", version: st.version!, ownerToken: c.ownerToken, batchId: c.batchId, messageIds: c.messageIds, repeated: false };
  }
  async finalizeExecution(a: FinalizeArgs): Promise<FinalizeResult> {
    this.calls.push("finalize");
    this.finalizations.push(a);
    if (this.fail.finalize) return { kind: "error" };
    const f = this.inflight.get(a.executionId);
    if (!f) return { kind: "not_claimed" };
    if (f.status === "finalized") return { kind: "duplicate" };
    if (f.status === "reconciled") return { kind: "reconciled" };
    const t = await this.lease!.transition(f.conversationId, a.outcome, f.version, { ownerToken: a.ownerToken, retryable: false });
    const live = t.result === "applied";
    if (live && a.outcome === "fail" && this.lease!.rec) this.lease!.rec = { ...this.lease!.rec, processedMessageIds: [...this.lease!.rec.processedMessageIds, ...this.lease!.rec.messageIds], messageIds: [] };
    const rec = live ? a.record : a.fencedRecord;
    this.records.push(rec);
    const res = [...this.reservations.values()].find((x) => x.executionId === a.executionId && !x.settled);
    if (res) {
      res.settled = true;
      res.settledCost = Number(a.settlement.costUsd);
      this.reservedCost -= res.cost;
      this.settledCost += res.settledCost;
    }
    f.status = "finalized";
    return { kind: "finalized", lease: live ? (a.outcome === "complete" ? "completed" : "failed") : "fenced_foreign", decision: rec.decision };
  }
}

/** Lease falso: o MODELO de referência B3.1 (mesma semântica do SQL), com tokens determinísticos. */
export class ModelLeaseStore implements DistributedLeaseStore {
  readonly guarantee = "postgres_transactional_row_lock" as const;
  rec: LeaseRecord | null = null;
  events: string[] = [];
  failLoad = false;
  private tok = 0;
  constructor(private readonly nowIso = () => new Date().toISOString()) {}
  async load(conversationId: string) {
    if (this.failLoad) throw new Error("lease_load_failed");
    const r = this.rec;
    return r ? { conversationId, state: r.state, version: r.version, batchId: r.batchId, messageIds: r.messageIds, deferredMessageIds: r.deferredMessageIds, attempts: r.attempts, leaseExpiresAt: r.leaseExpiresAt } : null;
  }
  async claim(conversationId: string, expectedVersion: number): Promise<StoreClaimResult> {
    this.events.push("claim");
    const r = this.rec ?? newLeaseRecord(conversationId, this.nowIso());
    const token = (++this.tok).toString(16).padStart(64, "a");
    const o = applyLeaseEvent(r, { type: "claim", token, ttlMs: 30_000, expectedVersion, now: this.nowIso() });
    if (!o.ok) return { result: o.reason === "lease_held" ? "conflict" : o.reason === "version_conflict" ? "stale_version" : "not_claimable", version: r.version };
    this.rec = o.record;
    return { result: "acquired", version: o.record.version, ownerToken: token, leaseExpiresAt: o.record.leaseExpiresAt!, attempts: o.record.attempts, batchId: o.record.batchId!, messageIds: o.record.messageIds };
  }
  async transition(conversationId: string, event: string, expectedVersion: number, opts: { ownerToken?: string | null; messageIds?: readonly string[]; retryable?: boolean } = {}): Promise<StoreTransitionResult> {
    this.events.push(event);
    const r = this.rec ?? newLeaseRecord(conversationId, this.nowIso());
    const now = this.nowIso();
    const token = opts.ownerToken ?? "";
    const ev =
      event === "observe" ? { type: "observe" as const, messageIds: opts.messageIds ?? [], now, expectedVersion }
      : event === "mark_ready" ? { type: "mark_ready" as const, batchId: "b0000000-0000-4000-8000-000000000001", messageIds: opts.messageIds ?? [], expectedVersion, now }
      : event === "acknowledge" ? { type: "acknowledge" as const, messageIds: opts.messageIds ?? [], expectedVersion, now }
      : event === "fail" ? { type: "fail" as const, token, retryable: !!opts.retryable, expectedVersion, now }
      : ({ type: event, token, expectedVersion, now } as never);
    const o = applyLeaseEvent(r, ev);
    if (!o.ok) return { result: o.reason === "version_conflict" ? "stale_version" : o.reason === "pending_overflow" ? "pending_overflow" : o.reason === "stale_owner" ? "stale_owner" : "invalid_transition", version: r.version };
    this.rec = o.record;
    return { result: o.effect, version: o.record.version, state: o.record.state };
  }
}

/** Transporte falso do Gateway (nunca rede). Conta chamadas e guarda o último pedido. */
export function fakeProvider(outcome: ProviderOutcome | ((n: number) => ProviderOutcome | Promise<ProviderOutcome>)): LlmProvider & { calls: number } {
  const p = {
    id: "fake",
    calls: 0,
    async complete() {
      p.calls += 1;
      return typeof outcome === "function" ? outcome(p.calls) : outcome;
    },
  };
  return p;
}
export const okJson = (body: unknown, usage = { inputTokens: 900, outputTokens: 120, totalTokens: 1020 }): ProviderOutcome => ({ kind: "ok", text: JSON.stringify(body), finishReason: "stop", usage, requestId: "req-1" });

/** Janela do coletor com UMA mensagem do hóspede (a do histórico de teste), já fora do debounce. */
export function windowOf(turn: ValidatedTurn = shadowTurn(), over: Partial<CollectorWindowSource> = {}): CollectorWindowSource {
  return {
    scope: { conversationId: turn.conversationId, propertyId: turn.propertyId, tenantId: turn.tenantId, channel: "web", senderId: turn.guestSessionId },
    messages: [{ id: MSG, conversationId: turn.conversationId, propertyId: turn.propertyId, tenantId: turn.tenantId, channel: "web", senderRole: "guest", senderId: turn.guestSessionId, text: "Qual é o horário do check-in?", tPersisted: "2026-11-03T10:00:00Z", tChannel: null, tReceived: null, rawMatched: true }],
    unpersistedRawGuest: [],
    pendingOverflow: false,
    ...over,
  };
}
export const benignPause = () => ({ lookup: "ok" as const, column: { ai_paused: false, paused_until: null }, persisted: [], persistedComplete: true, raw: [], rawComplete: true, allowedSourcePropertyIds: null });

export interface Captured {
  logs: LlmCallLogEvent[];
  scopeCalls: number;
  ownershipCalls: number;
}

/** `io` completo do worker; cada peça pode ser trocada. Relógio monotônico controlado. */
export function makeIo(over: Partial<ShadowWorkerIo> & { store?: MemoryShadowStore; lease?: ModelLeaseStore; provider?: LlmProvider } = {}) {
  const store = over.store ?? new MemoryShadowStore();
  const lease = over.lease ?? new ModelLeaseStore(() => new Date(T0).toISOString());
  store.lease = lease;
  const captured: Captured = { logs: [], scopeCalls: 0, ownershipCalls: 0 };
  let mono = 0;
  const io: ShadowWorkerIo = {
    storeFor: () => store,
    leaseFor: () => lease,
    validateTurnScope: async () => {
      captured.scopeCalls++;
      return shadowTurn();
    },
    fetchCollectorWindow: async (turn) => windowOf(turn),
    loadHumanPauseSource: async () => benignPause(),
    loadOwnership: async (): Promise<OwnershipLoad> => {
      captured.ownershipCalls++;
      return { status: "none", row: ownershipRow({ id: CONV }) };
    },
    portsFor: () =>
      operationalPorts({
        loadContext: async () => shadowCtx(),
        loadHistory: async () => history(),
        loadStayAuthorizationSource: async () => staySource(),
      }),
    masterSwitchOn: () => true,
    provider: over.provider,
    log: (e) => void captured.logs.push(e),
    now: () => (mono += 5),
    tickToken: TICK,
    newId: () => EXEC_ID,
    ...over,
  };
  return { io, store, lease, captured };
}
