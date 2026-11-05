/**
 * F2-B · B3.3 — WORKER SHADOW: uma conversa candidata, ponta a ponta, sob o prazo absoluto de 15 s.
 *
 * Sequência (§13 da diretriz da Entrega 2, revista na Entrega 3.1):
 *   1 prazo global → 2 chave mestra + estado global + configuração + medição dos disjuntores (a leitura
 *   do estado traz o INSTANTE DO BANCO: todo instante de parede do worker — pausa, coletor, posse, cadeia,
 *   registro — é ancorado nele, F-09/F-03) → 3 PORTA DO IMÓVEL no banco (E4 global: escopo, dono,
 *   interruptores, elegibilidade — antes de ler qualquer dado) → 4 escopo → 5 tenant/imóvel → 6–7 pausa +
 *   janela do coletor → 8 lease (sela sobras de lote encerrado → observe → [acknowledge do que antecede a
 *   equipe] → mark_ready → `shadow_claim_execution`, que reivindica E inicia numa transação, só a partir
 *   de `ready` e só com a trava do tick) → 9 pausa RELIDA + posse humana → 10–15 cadeia, orçamento e
 *   Gateway → 16–17 parser/validadores/descarte → 18 RECHECAGEM de soberania humana imediatamente antes de
 *   persistir um candidato (F-06) → 19 `shadow_finalize_execution`: lease (com cerca de versão/token/prazo)
 *   + liquidação pelo uso real + registro + disjuntores numa ÚNICA transação idempotente (F-01/F-02/F-11).
 *
 * D8 REVISADA (Entrega 3.1 · F-05): lote encerrado — concluído, em falha ou descartado — NUNCA é
 * reprocessado. A falha sela o lote (mensagens vão para as processadas; o identificador do lote e o
 * registro ficam no histórico). Não há nova tentativa por varredura, reinício de worker, recuperação de
 * lease (o lote de worker perdido é selado pela reconciliação, não reivindicado de novo) nem recuperação
 * de orçamento. Uma nova avaliação só acontece quando entra uma NOVA mensagem do hóspede.
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
import type { ShadowStore } from "@/lib/guest-ai/data/shadow-store.server";
import type { OwnershipLoad } from "@/lib/guest-ai/data/conversation-ownership.server";
import type { CollectorWindowSource } from "@/lib/guest-ai/data/collector.server";
import type { HumanPauseSource } from "@/lib/guest-ai/policy/human-pause";
import type { ShadowCandidate } from "@/lib/guest-ai/data/shadow-candidates.server";
import { actualUsageViolation, isIntegrityCode, validateShadowControl } from "./breakers";
import { blockCodeForGate, type IntegrityCode, type ShadowBlockCode, type ShadowChannel, type ShadowDecision, type ShadowExecutionRecord, type ShadowLimits, type ShadowPauseState, type ShadowTechnicalCode } from "./contracts";
import { ShadowDeadline } from "./deadline";
import { buildExecutionRecord, NO_GATEWAY, validateExecutionRecord, type ExecutionMeta, type NarrowOutcome } from "./extract";
import { runShadowExecution } from "./executor";
import { parseUsd8 } from "./money";
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
  /** Portas de leitura da cadeia (a de posse humana devolve a linha já conferida); `dbClock` = relógio do banco. */
  portsFor(turn: ValidatedTurn, ownershipRow: Extract<OwnershipLoad, { row: unknown }>["row"], dbClock: () => number): ShadowReadPorts;
  /** Token da trava GLOBAL do tick (F-07); sem ele nenhuma execução é reivindicada. */
  tickToken: string | null;
  masterSwitchOn?: () => boolean;
  provider?: LlmProvider;
  log?: LlmLogger;
  /** Relógio monotônico (ms) do prazo; o relógio de parede é sempre o do BANCO + deslocamento monotônico. */
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => () => void;
  newId?: () => string;
}

export type ShadowWorkerOutcome =
  | { status: "skipped"; code: ShadowBlockCode | "collector_not_ready" | "lease_concurrency" | "lease_overflow" | "measurement_unavailable" | "breaker_open" | "tick_not_held" | "property_not_active" | "property_status_unreadable" }
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
  const mono = io.now ?? (() => performance.now());
  const switchOn = io.masterSwitchOn ?? defaultMasterSwitch;
  const executionId = (io.newId ?? (() => crypto.randomUUID()))();
  const monoStart = mono();
  const store = io.storeFor(deadline.signal);

  // 2) chave mestra + estado global + configuração + medição
  if (switchOn() !== true) return { status: "skipped", code: "master_switch_off" };
  const control = await store.readControl();
  if (!control) return { status: "skipped", code: "state_unreadable" };
  // Relógio de PAREDE = instante do banco na leitura + deslocamento monotônico (F-09/F-03): nenhum
  // instante de pausa, coletor, posse, cadeia ou registro vem do relógio da máquina do worker.
  const monoAtRead = mono();
  const dbClock = (): number => control.dbNowMs + (mono() - monoAtRead);
  const startedAt = new Date(control.dbNowMs - Math.max(0, monoAtRead - monoStart)).toISOString();
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
    finishedAt: new Date(Math.max(dbClock(), Date.parse(startedAt))).toISOString(),
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
  /** Registro SEM lote (antes da reivindicação). Resposta perdida ⇒ UMA repetição idempotente. */
  const finish = async (narrow: NarrowOutcome | null, m: ExecutionMeta): Promise<ShadowWorkerOutcome> => {
    const built = buildExecutionRecord(narrow, { ...m, batchId: null, leaseVersion: null }, TURN_CHAIN_VERSION);
    const record = validateExecutionRecord(built);
    const finalStore = fin();
    if (!record) {
      await finalStore.trip("technical_failure", "telemetry_failure");
      return { status: "record_failed", decision: built.decision };
    }
    let r = await finalStore.record(record as ShadowExecutionRecord);
    if (r.kind === "error" && !deadline.finalizationSignal.aborted) r = await finalStore.record(record as ShadowExecutionRecord);
    if (r.kind === "recorded" || r.kind === "duplicate") return { status: "recorded", decision: record.decision };
    // registro recusado pelo banco (formato) ⇒ medição comprometida; erro de transporte repetido ⇒ só não grava
    if (r.kind === "invalid") await finalStore.trip("technical_failure", "telemetry_failure");
    return { status: "record_failed", decision: record.decision };
  };
  const integrity = async (code: IntegrityCode, turn: ValidatedTurn | null, extra: Partial<ExecutionMeta> = {}): Promise<ShadowWorkerOutcome> => {
    await fin().trip("integrity_violation", "integrity_divergence");
    return finish(null, meta({ executionState: "blocked", forcedDecision: "integrity_violation", integrityCode: code, ...extra }, turn));
  };
  const technical = (code: ShadowTechnicalCode, turn: ValidatedTurn | null, extra: Partial<ExecutionMeta> = {}) =>
    finish(null, meta({ executionState: deadline.reason ? "timed_out" : "failed", forcedDecision: "technical_failure", technicalCode: deadline.reason ? "shadow_timeout" : code, ...extra }, turn));

  // 3) porta do imóvel (E4 global): escopo global, dono, interruptores de tenant/imóvel e elegibilidade,
  //    conferidos AO VIVO no banco ANTES de ler qualquer dado da conversa. Ilegível ⇒ nada acontece.
  const gate = await store.propertyStatus(candidate.tenantId, candidate.propertyId);
  if (gate.kind === "error") return { status: "skipped", code: "property_status_unreadable" };
  if (gate.kind === "blocked") {
    // o dono do imóvel não é o tenant que o banco acabou de indicar: divergência, nunca adivinhar
    if (gate.reason === "tenant_mismatch") return integrity("candidate_tenant_mismatch", null);
    return finish(null, meta({ executionState: "blocked", forcedDecision: "blocked_not_authorized", blockCode: blockCodeForGate(gate.reason) }, null));
  }

  // 4) escopo, conferido no banco, com o dono esperado = tenant da candidata (derivado do dono do imóvel)
  let turn: ValidatedTurn;
  const tScope = deadline.elapsedMs();
  try {
    turn = await io.validateTurnScope({ surface: candidate.surface, conversationId: candidate.conversationId, messageId: candidate.messageId, expectedOwnerId: candidate.tenantId }, deadline.signal);
  } catch (e) {
    const code = (e as { code?: unknown })?.code;
    if ((SCOPE_INTEGRITY as readonly unknown[]).includes(code)) return integrity(code as IntegrityCode, null);
    return technical("read_failed", null);
  }
  contextMs += deadline.elapsedMs() - tScope;
  // 5) tenant e imóvel do turno = os da candidata
  if (turn.tenantId !== candidate.tenantId) return integrity("candidate_tenant_mismatch", turn);
  if (turn.propertyId !== candidate.propertyId || turn.conversationId !== candidate.conversationId) return integrity("candidate_property_mismatch", turn);

  // 6–7) pausa (para o coletor) + janela do coletor — instante do BANCO
  const nowMs = dbClock();
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

  // 8) lease (sinal único). F-05: sobras de um lote ENCERRADO (falha/descarte/expiração) são seladas
  //    antes de observar — nunca voltam a ser pendentes sem mensagem nova.
  const lease = io.leaseFor(deadline.signal);
  const tLease = deadline.elapsedMs();
  const conv = turn.conversationId;
  let snap = await lease.load(conv).catch(() => undefined);
  if (snap === undefined) return technical("lease_integrity_failure", turn);
  if (snap && (snap.state === "failed" || snap.state === "cancelled" || snap.state === "expired") && snap.batchId !== null && snap.messageIds.length > 0) {
    const seal = await lease.transition(conv, "acknowledge", snap.version, { messageIds: [...snap.messageIds] });
    if (seal.result !== "applied" && seal.result !== "noop") return { status: "skipped", code: "lease_concurrency" };
    snap = await lease.load(conv).catch(() => undefined);
    if (!snap) return technical("lease_integrity_failure", turn);
  }
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
  // reivindica E inicia numa transação (só de `ready`; trava do tick; porta do imóvel); resposta perdida ⇒
  // UMA repetição idempotente com a MESMA execução (devolve a mesma posse, nunca uma segunda)
  if (!io.tickToken) return { status: "skipped", code: "tick_not_held" };
  const claimArgs = { tickToken: io.tickToken, executionId, conversationId: conv, expectedVersion: snap.version, tenantId: turn.tenantId, propertyId: turn.propertyId, channel: CHANNEL[turn.surface] };
  let claim = await store.claimExecution(claimArgs);
  if (claim.kind === "error" && !deadline.signal.aborted) claim = await store.claimExecution(claimArgs);
  // E4 global: o imóvel deixou de estar ativo (escopo fechado, desligado, arquivado…) entre a porta e a
  // reivindicação — o banco recusou; nada executa (o lote fica pronto para quando voltar a estar ativo)
  if (claim.kind === "property_blocked") return { status: "skipped", code: "property_not_active" };
  if (claim.kind === "rejected") {
    if (claim.code === "tick_not_held") return { status: "skipped", code: "tick_not_held" };
    if (claim.code === "state_not_running") return { status: "skipped", code: "state_not_running" };
    return { status: "skipped", code: "lease_concurrency" };
  }
  // sem resposta legível: a posse pode ter sido confirmada; a reconciliação a sela (nunca reprocessa)
  if (claim.kind !== "claimed") return { status: "skipped", code: "lease_concurrency" };
  const ownerToken = claim.ownerToken;
  const leaseVersion = claim.version;
  const batchId = claim.batchId;
  leaseMs += deadline.elapsedMs() - tLease;

  /**
   * Finaliza a execução numa transação (lease + liquidação + registro + disjuntores). complete SÓ quando
   * a cadeia avaliou o lote (ou bloqueio por pausa/posse, D8); qualquer outro desfecho ⇒ fail SELADO.
   * Cerca violada no banco ⇒ o registro de fallback (`lease_integrity_failure`) é o que fica.
   */
  const close = async (narrow: NarrowOutcome | null, m0: ExecutionMeta): Promise<ShadowWorkerOutcome> => {
    const m: ExecutionMeta = { ...m0, batchId, leaseVersion };
    const evaluated = m.forcedDecision === "human_pause_active" || (m.forcedDecision === null && narrow !== null && narrow.kind !== "technical_error" && m.gateway.error === null);
    const record = validateExecutionRecord(buildExecutionRecord(narrow, m, TURN_CHAIN_VERSION));
    const fenced = validateExecutionRecord(
      buildExecutionRecord(null, { ...m, forcedDecision: "technical_failure", technicalCode: "lease_integrity_failure", executionState: "failed", integrityCode: null, blockCode: null }, TURN_CHAIN_VERSION),
    );
    const finalStore = fin();
    if (!record || !fenced) {
      await finalStore.trip("technical_failure", "telemetry_failure");
      return { status: "record_failed", decision: m.forcedDecision ?? "technical_failure" };
    }
    const args = {
      executionId,
      ownerToken,
      outcome: evaluated ? ("complete" as const) : ("fail" as const),
      settlement: { tokens: m.gateway.totalTokens, costUsd: m.gateway.costUsd, calls: m.gateway.calls },
      record: record as ShadowExecutionRecord,
      fencedRecord: fenced as ShadowExecutionRecord,
    };
    let r = await finalStore.finalizeExecution(args);
    // resposta perdida (F-11/F-12): UMA repetição idempotente; nunca um disparo de disjuntor por isso
    if (r.kind === "error" && !deadline.finalizationSignal.aborted) r = await finalStore.finalizeExecution(args);
    if (r.kind === "finalized") return { status: "recorded", decision: r.decision as ShadowDecision };
    if (r.kind === "duplicate") return { status: "recorded", decision: record.decision };
    if (r.kind === "reconciled") return { status: "recorded", decision: "technical_failure" };
    if (r.kind === "invalid") await finalStore.trip("technical_failure", "telemetry_failure");
    // sem confirmação: a execução segue em andamento no banco e a reconciliação a encerra (pior caso)
    return { status: "record_failed", decision: record.decision };
  };
  if (claim.messageIds.join() !== lote.join()) return close(null, meta({ executionState: "failed", forcedDecision: "technical_failure", technicalCode: "lease_integrity_failure" }, turn));

  // 9) pausa RELIDA depois do claim + posse humana — instante do BANCO
  const nowMs2 = dbClock();
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
  const preflight = issueShadowPreflight({ executionId, tenantId: turn.tenantId, propertyId: turn.propertyId, conversationId: conv, stateVersion: control.stateVersion, propertyActiveOk: true, integrityOk: true, pauseInactive: true, ownershipOk: true });
  const generator = preflight
    ? createShadowGatewayGenerator({ preflight, limits, deadline, store, masterSwitchOn: io.masterSwitchOn, provider: io.provider, log: io.log, now: mono })
    : null;
  if (!generator) return close(null, meta({ executionState: "blocked", forcedDecision: "technical_failure", technicalCode: "postprocess_failed", pauseState }, turn));
  const tChain = deadline.elapsedMs();
  const exec = await runShadowExecution(
    { turn, traceId: executionId, batch: decision.batch },
    { ports: io.portsFor(turn, ownership.row, dbClock), generator, signal: deadline.signal, remainingMs: () => deadline.processingRemainingMs(), now: dbClock, schedule: io.schedule },
  );
  const g = generator.telemetry();
  const gateway: ExecutionMeta["gateway"] = { calls: g.calls, inputTokens: g.inputTokens, outputTokens: g.outputTokens, reasoningTokens: g.reasoningTokens, totalTokens: g.totalTokens, usageSource: g.usageSource, costUsd: g.costUsd, error: g.error };
  const chainMs = Math.max(0, deadline.elapsedMs() - tChain);

  // uso real acima dos tetos por turno ⇒ violação (a liquidação, na finalização, conta o uso real)
  let tokenViolation = false;
  let budgetExceeded: ExecutionMeta["budgetExceeded"] = g.budgetLimit;
  // só uso INFORMADO pelo provedor é conferido contra os tetos; uso desconhecido já é liquidado pelo pior caso reservado
  if (g.calls > 0 && g.usageSource !== "none") {
    const violation = actualUsageViolation(limits, g, g.calls, parseUsd8(g.costUsd));
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
  } else if (deadline.reason !== null || (g.status === "failed" && g.error === "timeout")) {
    // o tempo-limite do Gateway É o prazo de processamento restante (`timeoutMs`): os dois relógios
    // disparam no mesmo instante e qualquer um que chegue primeiro é o mesmo desfecho (determinístico)
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
  // 18) F-06: RECHECAGEM de soberania humana imediatamente antes de persistir um candidato — pausa e posse
  //     relidas agora (instante do banco, sinal da finalização). Equipe assumiu ⇒ o candidato é descartado
  //     (pausa ⇒ `human_pause_active`; posse mudou ⇒ restrição operacional); leitura falhou ⇒ falha técnica.
  let finalPause = pauseState;
  if (!forced && narrow && narrow.kind !== "technical_error" && buildExecutionRecord(narrow, meta({ executionState: "completed" }, turn), TURN_CHAIN_VERSION).decision === "answer_candidate") {
    const nowMs3 = dbClock();
    try {
      const p3 = deriveHumanPause({ ...(await io.loadHumanPauseSource(turn, deadline.finalizationSignal, nowMs3)), now: new Date(nowMs3).toISOString() });
      const o3 = await io.loadOwnership(turn, deadline.finalizationSignal, new Date(nowMs3).toISOString());
      finalPause = pauseStateOf(p3);
      if (p3.state !== "active") {
        forced = "human_pause_active";
        blockCode = p3.state === "unknown" ? "pause_unreadable" : p3.indefinite ? "pause_indefinite" : "pause_active";
        executionState = "blocked";
      } else if (o3.status !== ownership.status) {
        forced = "operational_restriction";
        blockCode = "ownership_indeterminate";
        executionState = "blocked";
      }
    } catch {
      forced = "technical_failure";
      technicalCode = "read_failed";
      executionState = "failed";
    }
  }
  return close(
    narrow,
    meta(
      {
        executionState,
        forcedDecision: forced,
        technicalCode,
        blockCode,
        pauseState: finalPause,
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
    tickToken: null,
    portsFor: (_turn, ownershipRow, dbClock) => {
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
        loadHumanPause: (t, s) => pauseLoader.loadHumanPauseSource(t, { db, signal: s, nowMs: dbClock() }),
      };
    },
  };
}
