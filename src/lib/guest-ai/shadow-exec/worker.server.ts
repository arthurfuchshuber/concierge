/**
 * F2-B · B3.3 — WORKER SHADOW: uma conversa candidata, ponta a ponta, sob o prazo absoluto de 15 s.
 *
 * Sequência (§13 da diretriz da Entrega 2):
 *   1 prazo global → 2 chave mestra + estado global + configuração + medição dos disjuntores →
 *   3 manifesto → 4 escopo (`validateTurnScope`, dono esperado = tenant do manifesto) → 5 tenant/imóvel →
 *   6–7 janela do coletor + debounce/reconciliação (pausa lida para o coletor) → 8 lease
 *   (observe → [acknowledge do que antecede a resposta da equipe] → mark_ready → claim → start) →
 *   9 pausa humana RELIDA depois do claim + posse humana → 10–13 cadeia com contexto, composição,
 *   estimativa, orçamento e reserva (no gerador) → 14 estado relido → 15 Gateway só com tudo autorizado →
 *   16 parser/validadores → 17 descarte (o outcome nunca sai do executor) → 18 registro tipado →
 *   19 liquidação → 20 lease finalizado → 21 telemetria.
 * Nota de ordem: o lease é finalizado ANTES de gravar a telemetria para que o registro diga a verdade
 * sobre a integridade do lease (falha ⇒ `lease_integrity_failure`); a finalização e a gravação usam
 * o sinal de FINALIZAÇÃO (1,5 s reservados), nunca um relógio novo.
 *
 * Nunca lança, nunca envia, nunca escreve fora das RPCs do lease e do Shadow. Nenhum texto sai daqui.
 */
import { evaluateCollectorWindow, type CollectorDecision } from "@/lib/guest-ai/batch/collector";
import type { DistributedLeaseStore } from "@/lib/guest-ai/batch/lease";
import { deriveHumanPause, type HumanPauseState } from "@/lib/guest-ai/policy/human-pause";
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import type { ShadowReadPorts } from "@/lib/guest-ai/shadow/harness";
import { TURN_CHAIN_VERSION } from "@/lib/guest-ai/turn-chain";
import type { LlmProvider } from "@/lib/guest-ai/llm/providers/types";
import type { LlmLogger } from "@/lib/guest-ai/llm/telemetry";
import type { ManifestSnapshot, ShadowStore } from "@/lib/guest-ai/data/shadow-store.server";
import type { OwnershipLoad } from "@/lib/guest-ai/data/conversation-ownership.server";
import type { CollectorWindowSource } from "@/lib/guest-ai/data/collector.server";
import type { HumanPauseSource } from "@/lib/guest-ai/policy/human-pause";
import type { ShadowCandidate } from "@/lib/guest-ai/data/shadow-candidates.server";
import { actualUsageViolation, isIntegrityCode, validateShadowControl } from "./breakers";
import { type IntegrityCode, type ShadowBlockCode, type ShadowChannel, type ShadowDecision, type ShadowExecutionRecord, type ShadowLimits, type ShadowPauseState, type ShadowTechnicalCode } from "./contracts";
import { ShadowDeadline } from "./deadline";
import { buildExecutionRecord, NO_GATEWAY, validateExecutionRecord, type ExecutionMeta, type NarrowOutcome } from "./extract";
import { runShadowExecution } from "./executor";
import { createShadowGatewayGenerator, defaultMasterSwitch, issueShadowPreflight } from "./gateway-generator.server";

/** Erros do escopo que indicam divergência de identidade (⇒ integridade global). */
const SCOPE_INTEGRITY = ["tenant_mismatch", "property_unresolved", "surface_mismatch", "message_conversation_mismatch"] as const;

/** Tudo que o worker toca lá fora — injetável (testes) e montado com os loaders reais (produção). */
export interface ShadowWorkerIo {
  /** Adaptador Shadow ligado ao sinal dado (processamento ou finalização). */
  storeFor(signal: AbortSignal): ShadowStore;
  /** Lease ligado ao sinal dado. */
  leaseFor(signal: AbortSignal): DistributedLeaseStore;
  validateTurnScope(input: { surface: ValidatedTurn["surface"]; conversationId: string; messageId: string; expectedOwnerId: string }, signal: AbortSignal): Promise<ValidatedTurn>;
  fetchCollectorWindow(turn: ValidatedTurn, signal: AbortSignal, nowMs: number): Promise<CollectorWindowSource>;
  loadHumanPauseSource(turn: ValidatedTurn, signal: AbortSignal, nowMs: number): Promise<HumanPauseSource>;
  loadOwnership(turn: ValidatedTurn, signal: AbortSignal, nowIso: string): Promise<OwnershipLoad>;
  /** Portas de leitura da cadeia (a de posse humana devolve a linha já conferida). */
  portsFor(turn: ValidatedTurn, ownershipRow: Extract<OwnershipLoad, { row: unknown }>["row"]): ShadowReadPorts;
  masterSwitchOn?: () => boolean;
  provider?: LlmProvider;
  log?: LlmLogger;
  /** Relógio monotônico (ms) do prazo. */
  now?: () => number;
  /** Relógio de parede (ms epoch) para instantes gravados e para o coletor. */
  wallNow?: () => number;
  schedule?: (fn: () => void, ms: number) => () => void;
  newId?: () => string;
}

export type ShadowWorkerOutcome =
  | { status: "skipped"; code: ShadowBlockCode | "collector_not_ready" | "lease_concurrency" | "lease_overflow" | "measurement_unavailable" | "breaker_open" }
  | { status: "recorded"; decision: ShadowDecision }
  | { status: "record_failed"; decision: ShadowDecision };

const CHANNEL: Record<ValidatedTurn["surface"], ShadowChannel> = { airbnb: "airbnb", whatsapp: "whatsapp", guide_chat: "web" };

function pauseStateOf(p: HumanPauseState): ShadowPauseState {
  if (p.state === "active") return "inactive";
  if (p.state === "unknown") return "unknown";
  return p.indefinite ? "indefinite" : "active";
}

export async function runShadowWorker(candidate: ShadowCandidate, io: ShadowWorkerIo): Promise<ShadowWorkerOutcome> {
  const deadline = new ShadowDeadline({ now: io.now, schedule: io.schedule });
  try {
    return await work(candidate, io, deadline);
  } catch {
    // Defesa final: nenhuma exceção (nem seu texto) escapa do worker.
    return { status: "skipped", code: "state_unreadable" };
  } finally {
    deadline.dispose();
  }
}

async function work(candidate: ShadowCandidate, io: ShadowWorkerIo, deadline: ShadowDeadline): Promise<ShadowWorkerOutcome> {
  const wall = io.wallNow ?? (() => Date.now());
  const switchOn = io.masterSwitchOn ?? defaultMasterSwitch;
  const executionId = (io.newId ?? (() => crypto.randomUUID()))();
  const startedAt = new Date(wall()).toISOString();
  const store = io.storeFor(deadline.signal);

  // 2) chave mestra + estado global + configuração + medição
  if (switchOn() !== true) return { status: "skipped", code: "master_switch_off" };
  const control = await store.readControl();
  if (!control) return { status: "skipped", code: "state_unreadable" };
  if (control.state !== "running") return { status: "skipped", code: "state_not_running" };
  const verdict = validateShadowControl(control);
  if (!verdict.ok) return { status: "skipped", code: verdict.code };
  const limits: ShadowLimits = verdict.limits;
  const breaker = await store.evaluateBreakers();
  if (breaker === "measurement_unavailable") {
    await store.trip("technical_failure", "measurement_unavailable");
    return { status: "skipped", code: "measurement_unavailable" };
  }
  if (breaker !== "ok") {
    await store.trip("circuit_open", breaker);
    return { status: "skipped", code: "breaker_open" };
  }

  // metadados acumulados (só números/códigos)
  let leaseMs = 0;
  let contextMs = 0;
  const meta = (over: Partial<ExecutionMeta> & Pick<ExecutionMeta, "executionState">, turn: ValidatedTurn | null): ExecutionMeta => ({
    executionId,
    tenantId: turn?.tenantId ?? candidate.tenantId,
    propertyId: turn?.propertyId ?? candidate.propertyId,
    conversationId: candidate.conversationId,
    channel: CHANNEL[turn?.surface ?? candidate.surface],
    batchId: null,
    leaseVersion: null,
    modelId: limits.modelId,
    startedAt,
    finishedAt: new Date(wall()).toISOString(),
    totalMs: Math.min(2_147_483_647, Math.round(deadline.elapsedMs())),
    leaseMs: Math.round(leaseMs),
    contextMs: Math.round(contextMs),
    gatewayMs: 0,
    validationMs: 0,
    gateway: NO_GATEWAY,
    estimatedInputTokens: null,
    pauseState: "not_evaluated",
    technicalCode: null,
    blockCode: null,
    integrityCode: null,
    budgetExceeded: null,
    tokenLimitViolation: false,
    concurrencyDetected: false,
    forcedDecision: null,
    ...over,
  });
  const fin = () => io.storeFor(deadline.finalizationSignal);
  const finish = async (narrow: NarrowOutcome | null, m: ExecutionMeta): Promise<ShadowWorkerOutcome> => {
    const record = validateExecutionRecord(buildExecutionRecord(narrow, m, TURN_CHAIN_VERSION));
    const finalStore = fin();
    if (!record) {
      await finalStore.trip("technical_failure", "telemetry_failure");
      return { status: "record_failed", decision: m.forcedDecision ?? "technical_failure" };
    }
    const r = await finalStore.record(record as ShadowExecutionRecord);
    if (r.kind === "recorded" || r.kind === "duplicate") return { status: "recorded", decision: record.decision };
    await finalStore.trip("technical_failure", "telemetry_failure");
    return { status: "record_failed", decision: record.decision };
  };
  const integrity = async (code: IntegrityCode, turn: ValidatedTurn | null, extra: Partial<ExecutionMeta> = {}): Promise<ShadowWorkerOutcome> => {
    await fin().trip("integrity_violation", "integrity_divergence");
    return finish(null, meta({ executionState: "blocked", forcedDecision: "integrity_violation", integrityCode: code, ...extra }, turn));
  };
  const technical = (code: ShadowTechnicalCode, turn: ValidatedTurn | null, extra: Partial<ExecutionMeta> = {}) =>
    finish(null, meta({ executionState: deadline.reason ? "timed_out" : "failed", forcedDecision: "technical_failure", technicalCode: deadline.reason ? "shadow_timeout" : code, ...extra }, turn));

  // 3) manifesto
  const manifest: ManifestSnapshot | null = await store.readManifest();
  if (!manifest || manifest.manifestVersion !== limits.manifestVersion) return { status: "skipped", code: "manifest_unreadable" };
  const entry = manifest.entries.find((e) => e.propertyId === candidate.propertyId);
  if (!entry) return finish(null, meta({ executionState: "blocked", forcedDecision: "blocked_not_authorized", blockCode: "not_in_manifest" }, null));
  if (entry.tenantId !== candidate.tenantId) return integrity("manifest_tenant_mismatch", null);

  // 4) escopo, conferido no banco, com o dono esperado = tenant do manifesto
  let turn: ValidatedTurn;
  const tScope = deadline.elapsedMs();
  try {
    turn = await io.validateTurnScope({ surface: candidate.surface, conversationId: candidate.conversationId, messageId: candidate.messageId, expectedOwnerId: entry.tenantId }, deadline.signal);
  } catch (e) {
    const code = (e as { code?: unknown })?.code;
    if ((SCOPE_INTEGRITY as readonly unknown[]).includes(code)) return integrity(code as IntegrityCode, null);
    return technical("read_failed", null);
  }
  contextMs += deadline.elapsedMs() - tScope;
  // 5) tenant e imóvel do turno = os do manifesto
  if (turn.tenantId !== entry.tenantId) return integrity("manifest_tenant_mismatch", turn);
  if (turn.propertyId !== entry.propertyId || turn.conversationId !== candidate.conversationId) return integrity("manifest_property_mismatch", turn);

  // 6–7) pausa (para o coletor) + janela do coletor
  const nowMs = wall();
  let pause: HumanPauseState;
  let window: CollectorWindowSource;
  try {
    pause = deriveHumanPause({ ...(await io.loadHumanPauseSource(turn, deadline.signal, nowMs)), now: new Date(nowMs).toISOString() });
    window = await io.fetchCollectorWindow(turn, deadline.signal, nowMs);
  } catch {
    return technical("read_failed", turn);
  }
  if (window.scope.conversationId !== turn.conversationId || window.scope.propertyId !== turn.propertyId || window.scope.tenantId !== turn.tenantId) return integrity("batch_scope_mismatch", turn);
  const evaluate = (alreadyAnswered: readonly string[]): CollectorDecision => evaluateCollectorWindow({ ...window, alreadyAnswered, pause, now: new Date(nowMs).toISOString() });
  let decision = evaluate([]);
  if (decision.state === "blocked") {
    const code: ShadowBlockCode = decision.reason === "pause_unknown" ? "pause_unreadable" : decision.reason === "pause_indefinite" ? "pause_indefinite" : "pause_active";
    return finish(null, meta({ executionState: "blocked", forcedDecision: "human_pause_active", blockCode: code, pauseState: pauseStateOf(pause) }, turn));
  }
  if (decision.state === "rejected") {
    if (isIntegrityCode(decision.reason)) return integrity(decision.reason, turn);
    return { status: "skipped", code: decision.reason === "pending_overflow" ? "lease_overflow" : "collector_not_ready" };
  }
  if (decision.state !== "ready") return { status: "skipped", code: "collector_not_ready" };

  // 8) lease (sinal único; semântica B3.1 intacta)
  const lease = io.leaseFor(deadline.signal);
  const tLease = deadline.elapsedMs();
  const conv = turn.conversationId;
  let snap = await lease.load(conv).catch(() => undefined);
  if (snap === undefined) return technical("lease_integrity_failure", turn);
  const batchIds = decision.batch.messages.map((m) => m.id);
  const obs = await lease.transition(conv, "observe", snap?.version ?? 0, { messageIds: batchIds });
  if (obs.result === "deferred" || obs.result === "stale_version") return { status: "skipped", code: "lease_concurrency" };
  if (obs.result === "pending_overflow") return { status: "skipped", code: "lease_overflow" };
  if (obs.result !== "applied" && obs.result !== "noop") return technical("lease_integrity_failure", turn);
  snap = await lease.load(conv).catch(() => undefined);
  if (!snap) return technical("lease_integrity_failure", turn);
  if (snap.conversationId !== conv) return integrity("lease_conversation_mismatch", turn);
  if (snap.state === "claimed" || snap.state === "processing") return { status: "skipped", code: "lease_concurrency" };
  // completed/failed/cancelled/expired depois do observe ⇒ nada novo pendente (tudo já concluído/dispensado)
  if (snap.state !== "collecting" && snap.state !== "ready") return { status: "skipped", code: "collector_not_ready" };
  const pending = [...snap.messageIds, ...snap.deferredMessageIds];
  // ids da cauda que o lease já concluiu/dispensou ⇒ já respondidos; pendentes fora da cauda antecedem
  // a última mensagem da equipe ⇒ dispensados explicitamente (acknowledge), nunca descartados em silêncio
  const answered = batchIds.filter((id) => !pending.includes(id));
  const beforeTeam = pending.filter((id) => !batchIds.includes(id));
  if (beforeTeam.length > 0) {
    if (snap.state !== "collecting") return { status: "skipped", code: "lease_concurrency" };
    const ack = await lease.transition(conv, "acknowledge", snap.version, { messageIds: beforeTeam });
    if (ack.result !== "applied" && ack.result !== "noop") return { status: "skipped", code: "lease_concurrency" };
    snap = await lease.load(conv).catch(() => undefined);
    if (!snap) return technical("lease_integrity_failure", turn);
  }
  if (answered.length > 0) {
    decision = evaluate(answered);
    if (decision.state !== "ready") return { status: "skipped", code: "collector_not_ready" };
  }
  const lote = decision.batch.messages.map((m) => m.id);
  if (snap.state === "collecting") {
    const mr = await lease.transition(conv, "mark_ready", snap.version, { messageIds: lote });
    if (mr.result !== "applied") return { status: "skipped", code: "lease_concurrency" };
    snap = { ...snap, state: "ready", version: mr.version };
  } else if (snap.state !== "ready" || snap.messageIds.join() !== lote.join()) {
    return { status: "skipped", code: "lease_concurrency" };
  }
  const claim = await lease.claim(conv, snap.version);
  if (claim.result !== "acquired" && claim.result !== "recovered") return { status: "skipped", code: "lease_concurrency" };
  if (claim.messageIds.join() !== lote.join()) return technical("lease_integrity_failure", turn, { batchId: claim.batchId, leaseVersion: claim.version });
  const started = await lease.transition(conv, "start", claim.version, { ownerToken: claim.ownerToken });
  if (started.result !== "applied") return technical("lease_integrity_failure", turn, { batchId: claim.batchId, leaseVersion: claim.version });
  let leaseVersion = started.version;
  const batchId = claim.batchId;
  leaseMs += deadline.elapsedMs() - tLease;

  /** Finaliza o lease (sinal de finalização). Sucesso/política/pausa ⇒ complete; técnico ⇒ fail definitivo. */
  const finalizeLease = async (ok: boolean): Promise<boolean> => {
    const l = io.leaseFor(deadline.finalizationSignal);
    const r = ok
      ? await l.transition(conv, "complete", leaseVersion, { ownerToken: claim.ownerToken })
      : await l.transition(conv, "fail", leaseVersion, { ownerToken: claim.ownerToken, retryable: false });
    const applied = r.result === "applied";
    leaseVersion = applied ? r.version : leaseVersion;
    return applied;
  };
  const close = async (narrow: NarrowOutcome | null, m: ExecutionMeta): Promise<ShadowWorkerOutcome> => {
    // complete SÓ quando a cadeia avaliou o lote (ou bloqueio por pausa, D8); qualquer outro desfecho
    // (técnico, orçamento, desligamento, integridade, posse indeterminada) ⇒ fail definitivo: nenhuma
    // mensagem é marcada como processada sem ter sido avaliada.
    const evaluated = m.forcedDecision === "human_pause_active" || (m.forcedDecision === null && narrow !== null && narrow.kind !== "technical_error" && m.gateway.error === null);
    const leaseOk = await finalizeLease(evaluated);
    const merged = leaseOk ? m : { ...m, forcedDecision: "technical_failure" as const, technicalCode: "lease_integrity_failure" as const, executionState: "failed" as const };
    return finish(narrow, { ...merged, batchId, leaseVersion });
  };

  // 9) pausa RELIDA depois do claim + posse humana
  const nowMs2 = wall();
  let pause2: HumanPauseState;
  let ownership: OwnershipLoad;
  const tCtx = deadline.elapsedMs();
  try {
    pause2 = deriveHumanPause({ ...(await io.loadHumanPauseSource(turn, deadline.signal, nowMs2)), now: new Date(nowMs2).toISOString() });
    ownership = await io.loadOwnership(turn, deadline.signal, new Date(nowMs2).toISOString());
  } catch {
    return close(null, meta({ executionState: "failed", forcedDecision: "technical_failure", technicalCode: "read_failed" }, turn));
  }
  contextMs += deadline.elapsedMs() - tCtx;
  const pauseState = pauseStateOf(pause2);
  if (pause2.state !== "active") {
    const code: ShadowBlockCode = pause2.state === "unknown" ? "pause_unreadable" : pause2.indefinite ? "pause_indefinite" : "pause_active";
    return close(null, meta({ executionState: "blocked", forcedDecision: "human_pause_active", blockCode: code, pauseState }, turn));
  }
  if (ownership.status === "tenant_mismatch") return integrityAfterClaim("ownership_tenant_mismatch");
  if (ownership.status === "property_mismatch") return integrityAfterClaim("ownership_property_mismatch");
  if (ownership.status === "identity_inconsistent") return integrityAfterClaim("ownership_identity_inconsistent");
  if (ownership.status === "read_failed") return close(null, meta({ executionState: "failed", forcedDecision: "technical_failure", technicalCode: "read_failed", pauseState }, turn));
  if (ownership.status === "indeterminate") return close(null, meta({ executionState: "blocked", forcedDecision: "operational_restriction", blockCode: "ownership_indeterminate", pauseState }, turn));

  async function integrityAfterClaim(code: IntegrityCode): Promise<ShadowWorkerOutcome> {
    await fin().trip("integrity_violation", "integrity_divergence");
    return close(null, meta({ executionState: "blocked", forcedDecision: "integrity_violation", integrityCode: code, pauseState }, turn));
  }

  // 10–15) pré-autorização → gerador emitido → cadeia (o Gateway só roda com todas as barreiras)
  const preflight = issueShadowPreflight({ executionId, tenantId: turn.tenantId, propertyId: turn.propertyId, conversationId: conv, stateVersion: control.stateVersion, manifestOk: true, integrityOk: true, pauseInactive: true, ownershipOk: true });
  const generator = preflight
    ? createShadowGatewayGenerator({ preflight, limits, deadline, store, masterSwitchOn: io.masterSwitchOn, provider: io.provider, log: io.log, now: io.now })
    : null;
  if (!generator) return close(null, meta({ executionState: "blocked", forcedDecision: "technical_failure", technicalCode: "postprocess_failed", pauseState }, turn));
  const tChain = deadline.elapsedMs();
  const exec = await runShadowExecution(
    { turn, traceId: executionId, batch: decision.batch },
    { ports: io.portsFor(turn, ownership.row), generator, signal: deadline.signal, remainingMs: () => deadline.processingRemainingMs(), now: io.now, schedule: io.schedule },
  );
  const g = generator.telemetry();
  const gateway: ExecutionMeta["gateway"] = { calls: g.calls, inputTokens: g.inputTokens, outputTokens: g.outputTokens, reasoningTokens: g.reasoningTokens, totalTokens: g.totalTokens, usageSource: g.usageSource, costUsd: g.costUsd, error: g.error };
  const chainMs = Math.max(0, deadline.elapsedMs() - tChain);

  // 19) liquidação do orçamento (uso real; reserva aberta continua contada se falhar)
  let tokenViolation = false;
  let budgetExceeded: ExecutionMeta["budgetExceeded"] = g.budgetLimit;
  if (g.reservationId) {
    await fin().settle(g.reservationId, { tokens: g.totalTokens, costUsd: g.costUsd, calls: g.calls });
    const violation = actualUsageViolation(limits, g, g.calls, g.costUsd);
    if (violation) {
      tokenViolation = true;
      budgetExceeded = violation;
      await fin().trip("budget_exhausted", "token_limit_violation");
    }
  }

  // classificação do que o worker impõe sobre o resultado da cadeia
  let forced: ShadowDecision | null = null;
  let technicalCode: ShadowTechnicalCode | null = null;
  let executionState: ExecutionMeta["executionState"] = "completed";
  let blockCode: ShadowBlockCode | null = null;
  if (exec.kind === "barrier_violation") {
    forced = "technical_failure";
    technicalCode = exec.reason === "deadline_expired" ? "shadow_timeout" : "postprocess_failed";
    executionState = exec.reason === "deadline_expired" ? "timed_out" : "failed";
  } else if (deadline.reason !== null) {
    forced = "technical_failure";
    technicalCode = "shadow_timeout";
    executionState = "timed_out";
  } else if (g.status === "blocked" || g.status === "discarded") {
    blockCode = g.blockCode;
    if (g.blockCode === "budget_turn_exceeded" || g.blockCode === "budget_daily_exceeded" || g.blockCode === "budget_reservation_failed") forced = "budget_blocked";
    else if (g.blockCode === "deadline_expired") {
      forced = "technical_failure";
      technicalCode = "shadow_timeout";
      executionState = "timed_out";
    } else forced = "aborted_by_shutdown";
    if (forced !== "technical_failure") executionState = g.status === "discarded" ? "aborted" : "blocked";
  } else if (g.status === "failed") {
    technicalCode = "gateway_error";
    executionState = "failed";
  } else if (exec.narrow.kind === "technical_error") {
    executionState = "failed";
    // código fechado da cadeia (a projeção já o validou); ausente ⇒ o registro é recusado pela validação (fail-closed)
    technicalCode = exec.narrow.technicalCode;
  }
  const narrow = exec.kind === "executed" ? exec.narrow : null;
  if (narrow && !forced && (narrow.senderIntegrityCode || (narrow.refusalCode && isIntegrityCode(narrow.refusalCode)))) {
    await fin().trip("integrity_violation", "integrity_divergence");
  }
  return close(
    narrow,
    meta(
      {
        executionState,
        forcedDecision: forced,
        technicalCode,
        blockCode,
        pauseState,
        gateway,
        gatewayMs: g.latencyMs,
        validationMs: Math.max(0, Math.round(chainMs - g.latencyMs)),
        estimatedInputTokens: g.estimatedInputTokens,
        budgetExceeded,
        tokenLimitViolation: tokenViolation,
      },
      turn,
    ),
  );
}

// ─────────────────────────── Ligação de produção (só usada pelo tick LIBERADO) ───────────────────────────

/**
 * `io` de produção com os loaders reais, todos só leitura e com o sinal da execução. Imports
 * dinâmicos: enquanto o portão do tick estiver fechado, nada disto é sequer carregado.
 */
export async function productionWorkerIo(): Promise<ShadowWorkerIo> {
  const [client, scope, collector, pauseLoader, ownershipLoader, store, leaseStore, ctxLoader, history, dossier, access, stay, sender] = await Promise.all([
    import("@/lib/guest-ai/data/client.server"),
    import("@/lib/guest-ai/data/scope.server"),
    import("@/lib/guest-ai/data/collector.server"),
    import("@/lib/guest-ai/data/human-pause.server"),
    import("@/lib/guest-ai/data/conversation-ownership.server"),
    import("@/lib/guest-ai/data/shadow-store.server"),
    import("@/lib/guest-ai/data/lease-store.server"),
    import("@/lib/guest-ai/context/conversation-context.server"),
    import("@/lib/guest-ai/data/history.server"),
    import("@/lib/guest-ai/data/property-dossier.server"),
    import("@/lib/guest-ai/data/property-access.server"),
    import("@/lib/guest-ai/data/stay-authorization.server"),
    import("@/lib/guest-ai/data/sender-identity.server"),
  ]);
  const db = await client.getGuestAiDb();
  return {
    storeFor: (signal) => store.createShadowStore({ call: async (fn, args) => (await client.getGuestAiShadowRpc(signal)).call(fn, args) }),
    leaseFor: (signal) => leaseStore.createDistributedLeaseStore({ rpc: { call: async (fn, args) => (await client.getGuestAiLeaseRpc(signal)).call(fn, args) }, db: client.abortableDb(db, signal) }),
    validateTurnScope: (input, signal) => scope.validateTurnScope(input, { db: client.abortableDb(db, signal) }),
    fetchCollectorWindow: (turn, signal, nowMs) => collector.fetchCollectorWindow(turn, { db, signal, nowMs }),
    loadHumanPauseSource: (turn, signal, nowMs) => pauseLoader.loadHumanPauseSource(turn, { db, signal, nowMs }),
    loadOwnership: (turn, signal, nowIso) => ownershipLoader.loadConversationOwnership(turn, { db, signal, nowIso }),
    portsFor: (_turn, ownershipRow) => {
      // o contexto carregado pela cadeia (etapa 2) informa as audiências do dossiê (etapa 3)
      let audiences: readonly string[] | null = null;
      return {
        loadContext: async (t, s) => {
          const ctx = await ctxLoader.loadConversationContext(
            { surface: t.surface, conversationId: t.conversationId, messageId: t.messageId, expectedOwnerId: t.tenantId, mode: "shadow", traceId: t.conversationId },
            { db },
            s,
          );
          audiences = ctx.guest.audiences;
          return ctx;
        },
        loadHistory: (t, s) => history.fetchConversationHistory(t, { db, signal: s }),
        loadDossiers: async (t, s) => {
          if (!audiences) throw new Error("context_not_loaded");
          return { primary: await dossier.fetchPropertyDossier(access.primaryDossierTarget(t, audiences), { db, signal: s }) };
        },
        loadStayAuthorizationSource: (t, s) => stay.loadStayAuthorizationSource(t, { db, signal: s }),
        loadConversationOwnership: async (t) => (t.conversationId === ownershipRow.id ? ownershipRow : null),
        loadSenderIdentitySource: (t, s) => sender.loadSenderIdentitySource(t, { db, signal: s }),
        loadHumanPause: (t, s) => pauseLoader.loadHumanPauseSource(t, { db, signal: s, nowMs: Date.now() }),
      };
    },
  };
}
