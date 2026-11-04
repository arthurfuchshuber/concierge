/**
 * B3.3 · Entrega 2 — testes unitários: disjuntores, prazo global, extrator/descartador, adaptador do
 * store, gerador emitido (barreiras antes da rede), loader real de posse humana, candidatas, portas RPC.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actualUsageViolation, costUsd, evaluateErrorBreaker, evaluateTurnBudget, GATEWAY_MAX_OUTPUT_TOKENS, isEvaluable, isIntegrityCode, isTechnicalError, validateShadowControl } from "@/lib/guest-ai/shadow-exec/breakers";
import { ShadowDeadline } from "@/lib/guest-ai/shadow-exec/deadline";
import { buildExecutionRecord, classifyNarrow, EMPTY_TIMINGS, narrowOutcome, NO_GATEWAY, validateExecutionRecord, type ExecutionMeta, type NarrowOutcome } from "@/lib/guest-ai/shadow-exec/extract";
import { SHADOW_DEADLINE_MS, SHADOW_FINALIZATION_RESERVE_MS, SHADOW_RECORD_KEYS, SHADOW_VERSION, type ShadowLimits } from "@/lib/guest-ai/shadow-exec/contracts";
import { createShadowGatewayGenerator, defaultMasterSwitch, isShadowGatewayGenerator, issueShadowPreflight, ShadowGeneratorStop } from "@/lib/guest-ai/shadow-exec/gateway-generator.server";
import { checkExecutorBarrier, runShadowExecution } from "@/lib/guest-ai/shadow-exec/executor";
import { createShadowStore, parseControl, parseManifest, recordToRow, getShadowStore } from "@/lib/guest-ai/data/shadow-store.server";
import { loadConversationOwnership } from "@/lib/guest-ai/data/conversation-ownership.server";
import { candidateLookbackMs, listShadowCandidates } from "@/lib/guest-ai/data/shadow-candidates.server";
import { leaseRpcFrom, shadowRpcFrom, SHADOW_RPC_FUNCTIONS } from "@/lib/guest-ai/data/client.server";
import { modelSpec } from "@/lib/guest-ai/llm/models";
import type { ChainOutcome } from "@/lib/guest-ai/turn-chain";
import { fakeDb } from "./helpers/b3-fake-db";
import { operationalPorts } from "./helpers/b25-fixtures";
import { CANARY, CONV, EXEC_ID, MSG, MemoryShadowStore, OTHER_P, OTHER_T, P_ID, T_ID, fakeProvider, fullControl, manifestOf, okJson, shadowTurn } from "./helpers/b33-shadow";

const SPEC = modelSpec("openai/gpt-5.6-sol")!;
const limits = (): ShadowLimits => {
  const v = validateShadowControl(fullControl());
  if (!v.ok) throw new Error("fixture");
  return v.limits;
};

describe("B3.3 · disjuntores (puros)", () => {
  it("configuração completa ⇒ limites congelados; cada problema tem código próprio, na ordem", () => {
    const v = validateShadowControl(fullControl());
    expect(v.ok && Object.isFrozen(v.limits)).toBe(true);
    expect(validateShadowControl(null)).toEqual({ ok: false, code: "state_unreadable" });
    expect(validateShadowControl({ ...fullControl(), state: "x" as never })).toEqual({ ok: false, code: "state_unreadable" });
    expect(validateShadowControl({ ...fullControl(), stateVersion: 1.5 })).toEqual({ ok: false, code: "state_unreadable" });
    expect(validateShadowControl(fullControl({ retentionAuthorized: false }))).toEqual({ ok: false, code: "retention_not_authorized" });
    expect(validateShadowControl(fullControl({ retentionScope: null }))).toEqual({ ok: false, code: "retention_not_authorized" });
    expect(validateShadowControl(fullControl({ retentionScope: "google" as never }))).toEqual({ ok: false, code: "retention_not_authorized" });
    expect(validateShadowControl(fullControl({ modelId: null }))).toEqual({ ok: false, code: "model_not_allowed" });
    expect(validateShadowControl(fullControl({ modelId: "google/gemini-3.8-flash" as never }))).toEqual({ ok: false, code: "model_not_allowed" });
    for (const k of ["reasoningEffort", "maxInputTokens", "maxOutputTokens", "maxTotalTokens", "maxTurnCostUsd", "dailyCostLimitUsd", "maxDailyTokens", "maxDailyCalls", "errorWindowMinutes", "errorMinSample", "budgetDayTimezone", "telemetryRetentionDays", "tickIntervalSeconds", "maxConversationsPerTick", "manifestVersion"] as const) {
      expect(validateShadowControl(fullControl({ [k]: null })), k).toEqual({ ok: false, code: "limits_missing" });
    }
    const invalid: Array<Partial<ReturnType<typeof fullControl>>> = [
      { reasoningEffort: "max" as never }, { maxInputTokens: 0 }, { maxOutputTokens: GATEWAY_MAX_OUTPUT_TOKENS + 1 }, { maxOutputTokens: -1 }, { maxTotalTokens: 1.5 },
      { maxTurnCostUsd: 0 }, { maxTurnCostUsd: Number.POSITIVE_INFINITY }, { dailyCostLimitUsd: 1.01 }, { dailyCostLimitUsd: -1 }, { maxDailyTokens: 0 }, { maxDailyCalls: -1 },
      { errorWindowMinutes: 0 }, { errorMinSample: 1 }, { budgetDayTimezone: "UTC+3" }, { telemetryRetentionDays: 0 }, { tickIntervalSeconds: 0 }, { maxConversationsPerTick: 0 }, { manifestVersion: 0 },
    ];
    for (const o of invalid) expect(validateShadowControl(fullControl(o)), JSON.stringify(o)).toEqual({ ok: false, code: "limits_invalid" });
  });
  it("E3.1 · parâmetros homologados são TETOS: acima deles (ou fora do valor fixo) ⇒ limits_invalid; instante do banco ilegível ⇒ ilegível", () => {
    const over: Array<Partial<ReturnType<typeof fullControl>>> = [
      { maxTurnCostUsd: 0.15000001 }, { maxTurnCostUsd: 0.2 }, { maxTurnCostUsd: 0.123456789 }, { dailyCostLimitUsd: 0.000000001 }, { maxConversationsPerTick: 4 }, { tickIntervalSeconds: 30 }, { tickIntervalSeconds: 61 },
      { errorMinSample: 19 }, { errorMinSample: 21 }, { budgetDayTimezone: "UTC" }, { budgetDayTimezone: "America/New_York" },
    ];
    for (const o of over) expect(validateShadowControl(fullControl(o)), JSON.stringify(o)).toEqual({ ok: false, code: "limits_invalid" });
    for (const o of [{ maxTurnCostUsd: 0.15 }, { maxTurnCostUsd: 0.01 }, { maxConversationsPerTick: 1 }, { dailyCostLimitUsd: 0.5 }]) expect(validateShadowControl(fullControl(o)).ok, JSON.stringify(o)).toBe(true);
    expect(validateShadowControl(fullControl({ dbNowMs: Number.NaN }))).toEqual({ ok: false, code: "state_unreadable" });
    const v = validateShadowControl(fullControl());
    expect(v.ok && [v.limits.maxTurnCostUsd8, v.limits.dailyCostLimitUsd8]).toEqual([15_000_000n, 100_000_000n]);
  });
  it("orçamento por turno (E3.1 · F-04): pior caso ESTRITO = tetos configurados × 2 tentativas, em unidades exatas; cada limite tem código", () => {
    const l = limits();
    // aprovado: 2 × (40.000 × 125 + 1.536 × 1.000) = 13.072.000 unidades = US$ 0,13072 ≤ 0,15
    const ok = evaluateTurnBudget(l, SPEC, 1000);
    expect(ok).toEqual({ ok: true, reservation: { tokens: (40_000 + 1_536) * 2, costUsd8: 13_072_000n, calls: 2 } });
    // a reserva NÃO depende do tamanho do prompt (nunca subestima)
    expect(evaluateTurnBudget(l, SPEC, 39_999)).toEqual(ok);
    expect(evaluateTurnBudget(l, SPEC, l.maxInputTokens)).toEqual(ok);
    expect(evaluateTurnBudget(l, SPEC, 0)).toEqual({ ok: false, limit: "turn_input_tokens" });
    expect(evaluateTurnBudget(l, SPEC, 1.5)).toEqual({ ok: false, limit: "turn_input_tokens" });
    expect(evaluateTurnBudget(l, SPEC, l.maxInputTokens + 1)).toEqual({ ok: false, limit: "turn_input_tokens" });
    expect(evaluateTurnBudget({ ...l, maxOutputTokens: 5000 }, SPEC, 10)).toEqual({ ok: false, limit: "turn_output_tokens" });
    expect(evaluateTurnBudget({ ...l, maxTotalTokens: 41_535 }, SPEC, 100)).toEqual({ ok: false, limit: "turn_total_tokens" });
    expect(evaluateTurnBudget({ ...l, maxTotalTokens: 41_536 }, SPEC, 100).ok).toBe(true);
    expect(evaluateTurnBudget({ ...l, maxTurnCostUsd8: 13_071_999n }, SPEC, 100)).toEqual({ ok: false, limit: "turn_cost" });
    // limite EXATO é permitido (≤)
    expect(evaluateTurnBudget({ ...l, maxTurnCostUsd8: 13_072_000n }, SPEC, 100).ok).toBe(true);
    // preço sem representação exata em 1e-8 por token ⇒ bloqueio (nunca arredonda dinheiro)
    expect(evaluateTurnBudget(l, { pricePerMTok: { input: 1.255, output: 10 } }, 100)).toEqual({ ok: false, limit: "turn_cost" });
    expect(costUsd(SPEC, 900, 120)).toBe(0.002325);
  });
  it("uso real acima do limite ⇒ violação; dentro ⇒ nada (custo em unidades exatas)", () => {
    const l = limits();
    expect(actualUsageViolation(l, { inputTokens: 10, outputTokens: 10, totalTokens: 20 }, 1, 100_000n)).toBeNull();
    expect(actualUsageViolation(l, { inputTokens: l.maxInputTokens + 1, outputTokens: 0, totalTokens: 0 }, 1, 0n)).toBe("turn_input_tokens");
    expect(actualUsageViolation(l, { inputTokens: l.maxInputTokens * 2, outputTokens: 0, totalTokens: 0 }, 2, 0n)).toBeNull();
    expect(actualUsageViolation(l, { inputTokens: 0, outputTokens: l.maxOutputTokens + 1, totalTokens: 0 }, 0, 0n)).toBe("turn_output_tokens");
    expect(actualUsageViolation(l, { inputTokens: 0, outputTokens: 0, totalTokens: l.maxTotalTokens + 1 }, 1, 0n)).toBe("turn_total_tokens");
    expect(actualUsageViolation(l, { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, 1, 15_000_001n)).toBe("turn_cost");
    expect(actualUsageViolation(l, { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, 1, 15_000_000n)).toBeNull();
    expect(actualUsageViolation(l, { inputTokens: Number.NaN, outputTokens: 0, totalTokens: 0 }, 1, 0n)).toBe("turn_input_tokens");
    expect(actualUsageViolation(l, { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, 1, null)).toBe("turn_cost"); // custo ilegível ⇒ fail-closed
  });
  const win = (errors: number, ok: number, extra: Array<{ evaluable: boolean; technicalError: boolean }> = []) => [
    ...Array.from({ length: errors }, () => ({ evaluable: true, technicalError: true })),
    ...Array.from({ length: ok }, () => ({ evaluable: true, technicalError: false })),
    ...extra,
  ];
  it("taxa EXATAMENTE 5 % não dispara; acima dispara (amostra ≥ mínimo)", () => {
    expect(evaluateErrorBreaker([...win(0, 19), ...win(1, 0)], 20)).toBe("ok"); // 1/20 = 5 %
    expect(evaluateErrorBreaker([...win(0, 38), ...win(2, 0)], 20)).toBe("ok"); // 2/40 = 5 %
    expect(evaluateErrorBreaker([...win(0, 18), ...win(2, 0)], 20)).toBe("error_rate_exceeded"); // 2/20 = 10 %
    expect(evaluateErrorBreaker([...win(0, 37), ...win(2, 0)], 20)).toBe("error_rate_exceeded"); // 2/39 > 5 %
  });
  it("amostra pequena: duas falhas consecutivas (as mais recentes) disparam; não consecutivas não", () => {
    expect(evaluateErrorBreaker(win(2, 3), 20)).toBe("consecutive_failures");
    expect(evaluateErrorBreaker([{ evaluable: true, technicalError: true }, { evaluable: true, technicalError: false }, { evaluable: true, technicalError: true }], 20)).toBe("ok");
    expect(evaluateErrorBreaker(win(1, 0), 20)).toBe("ok");
    expect(evaluateErrorBreaker([], 20)).toBe("ok");
  });
  it("bloqueios legítimos não entram no denominador; medição ilegível bloqueia", () => {
    const nonEval = Array.from({ length: 100 }, () => ({ evaluable: false, technicalError: false }));
    expect(evaluateErrorBreaker([...win(2, 0), ...nonEval], 20)).toBe("consecutive_failures");
    expect(evaluateErrorBreaker(null, 20)).toBe("measurement_unavailable");
    expect(evaluateErrorBreaker(win(0, 1), 1)).toBe("measurement_unavailable");
    expect(evaluateErrorBreaker(win(0, 1), 2.5)).toBe("measurement_unavailable");
    for (const d of ["human_pause_active", "budget_blocked", "blocked_not_authorized", "aborted_by_shutdown"] as const) expect(isEvaluable(d)).toBe(false);
    for (const d of ["answer_candidate", "technical_failure", "integrity_violation", "operational_restriction"] as const) expect(isEvaluable(d)).toBe(true);
    expect(isTechnicalError("technical_failure")).toBe(true);
    expect(isTechnicalError("integrity_violation")).toBe(false);
    expect(isIntegrityCode("cross_tenant")).toBe(true);
    expect(isIntegrityCode("structural_block")).toBe(false);
    expect(isIntegrityCode(7)).toBe(false);
  });
});

describe("B3.3 · prazo global (ShadowDeadline)", () => {
  const harness = () => {
    let t = 1000;
    const timers: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
    const d = new ShadowDeadline({
      now: () => t,
      schedule: (fn, ms) => {
        const x = { fn, ms, cancelled: false };
        timers.push(x);
        return () => (x.cancelled = true);
      },
    });
    return { d, timers, advance: (ms: number) => (t += ms) };
  };
  it("uma origem de tempo, dois marcos (13,5 s e 15 s), o tempo nunca reinicia", () => {
    const { d, timers, advance } = harness();
    expect(timers.map((x) => x.ms)).toEqual([SHADOW_DEADLINE_MS - SHADOW_FINALIZATION_RESERVE_MS, SHADOW_DEADLINE_MS]);
    expect(d.processingRemainingMs()).toBe(13_500);
    advance(4_000);
    expect(d.processingRemainingMs()).toBe(9_500);
    expect(d.totalRemainingMs()).toBe(11_000);
    advance(9_500);
    expect(d.processingRemainingMs()).toBe(0);
    expect(d.totalRemainingMs()).toBe(1_500); // reserva de finalização preservada
  });
  it("fim do processamento aborta SÓ o sinal de processamento; o absoluto aborta os dois", () => {
    const { d, timers } = harness();
    timers[0]!.fn();
    expect(d.signal.aborted).toBe(true);
    expect(d.finalizationSignal.aborted).toBe(false);
    expect(d.reason).toBe("processing_deadline");
    expect(d.processingRemainingMs()).toBe(0);
    timers[1]!.fn();
    expect(d.finalizationSignal.aborted).toBe(true);
    expect(d.totalRemainingMs()).toBe(0);
    expect(d.reason).toBe("processing_deadline");
  });
  it("cancelamento explícito e externo param tudo; dispose cancela os marcos", () => {
    const { d, timers } = harness();
    d.cancel();
    expect(d.signal.aborted && d.finalizationSignal.aborted).toBe(true);
    expect(d.reason).toBe("cancelled");
    d.dispose();
    expect(timers.every((x) => x.cancelled)).toBe(true);
    const ext = new AbortController();
    const e = new ShadowDeadline({ now: () => 0, schedule: () => () => undefined, external: ext.signal });
    ext.abort();
    expect(e.signal.aborted && e.finalizationSignal.aborted).toBe(true);
    e.dispose();
    const pre = new AbortController();
    pre.abort();
    const p = new ShadowDeadline({ now: () => 0, schedule: () => () => undefined, external: pre.signal });
    expect(p.reason).toBe("cancelled");
    p.dispose();
  });
  it("relógio inválido ou que lança ⇒ prazo esgotado (fail-closed)", () => {
    const a = new ShadowDeadline({ now: () => Number.NaN, schedule: () => () => undefined });
    expect(a.signal.aborted && a.finalizationSignal.aborted).toBe(true);
    expect(a.processingRemainingMs()).toBe(0);
    let calls = 0;
    const b = new ShadowDeadline({
      now: () => {
        calls++;
        if (calls > 1) throw new Error("clock");
        return 0;
      },
      schedule: () => () => undefined,
    });
    expect(b.elapsedMs()).toBe(Number.POSITIVE_INFINITY);
    expect(b.processingRemainingMs()).toBe(0);
    expect(b.totalRemainingMs()).toBe(0);
    const c = new ShadowDeadline({ now: () => 0, schedule: () => { return () => { throw new Error("x"); }; } });
    expect(() => c.dispose()).not.toThrow();
    const real = new ShadowDeadline();
    expect(real.processingRemainingMs()).toBeGreaterThan(13_000);
    real.dispose();
  });
});

describe("B3.3 · extrator / descartador", () => {
  const audit = (over: Record<string, unknown> = {}) => ({
    chainVersion: "chain.2026-11-03.3",
    composerVersion: "composer.2026-11-03.5",
    interruption: "none",
    timings: { context: 3, parse: 1, guard: 2.5, compose: -1 },
    decision: { strategy: "answer", intents: ["informational_query", "bogus"], commitmentKinds: ["team_relay", "bogus"], handoff: { needed: true, urgency: "low" }, shouldReply: true, milestone: CANARY, unauthorizedKinds: [CANARY] },
    checks: { context: "ok", senderIdentity: null },
    ...over,
  });
  const outcome = (kind: string, extra: Record<string, unknown> = {}, a: Record<string, unknown> = {}) =>
    ({ kind, text: CANARY, question: CANARY, decision: { reply: CANARY, commitments: [CANARY] }, audit: audit(a), delivery: "not_sent", effectsExecuted: false, ...extra }) as unknown as ChainOutcome;

  it("a projeção nunca copia texto, pergunta ou decisão (só enums/números/versões)", () => {
    const n = narrowOutcome(outcome("reply"));
    expect(JSON.stringify(n)).not.toContain(CANARY);
    expect(Object.keys(n).sort()).toEqual(["chainVersion", "commitmentKinds", "composerVersion", "contextCheck", "handoffNeeded", "handoffUrgency", "intents", "interruption", "kind", "refusalCode", "senderIntegrityCode", "strategy", "technicalCode", "timings"]);
    expect(n.intents).toEqual(["informational_query"]);
    expect(n.commitmentKinds).toEqual(["team_relay"]);
    expect(n.timings.context).toBe(3);
    expect(n.timings.guard).toBeNull();
    expect(n.timings.compose).toBeNull();
    expect(Object.isFrozen(n) && Object.isFrozen(n.timings)).toBe(true);
  });
  it("projeção de auditoria ausente/estranha ⇒ valores neutros (nunca texto)", () => {
    const n = narrowOutcome({ kind: "silence", audit: undefined } as unknown as ChainOutcome);
    expect(n).toMatchObject({ strategy: null, intents: [], commitmentKinds: [], handoffNeeded: false, handoffUrgency: null, contextCheck: "not_run", interruption: "none", composerVersion: null, chainVersion: null, senderIntegrityCode: null });
    const weird = narrowOutcome(outcome("refused", { code: CANARY }, { chainVersion: CANARY, composerVersion: "UPPER", interruption: "timeout", checks: { context: "property_tenant_mismatch", senderIdentity: { reason: "listing_other_tenant" } }, decision: { strategy: "x", handoff: { urgency: "x" } } }));
    expect(weird).toMatchObject({ refusalCode: null, chainVersion: null, composerVersion: null, interruption: "timeout", contextCheck: "refused", senderIntegrityCode: "listing_other_tenant", strategy: null, handoffUrgency: null });
    expect(narrowOutcome(outcome("technical_error", { code: "stage_timeout" }, { interruption: "aborted" }))).toMatchObject({ technicalCode: "stage_timeout", interruption: "aborted" });
    expect(narrowOutcome(outcome("refused", { code: "semantic_block" })).refusalCode).toBe("semantic_block");
  });
  it("classificação §6.1 a partir da projeção", () => {
    const k = (kind: string, extra: Record<string, unknown> = {}, a: Record<string, unknown> = {}) => classifyNarrow(narrowOutcome(outcome(kind, extra, a)));
    expect(k("reply")).toBe("answer_candidate");
    expect(k("silence")).toBe("silence");
    expect(k("human_action")).toBe("human_intervention");
    expect(k("paused")).toBe("human_pause_active");
    expect(k("urgent_internal_alert")).toBe("urgent_internal_alert");
    expect(k("technical_error", { code: "stage_failed" })).toBe("technical_failure");
    expect(k("refused", { code: "property_tenant_mismatch" })).toBe("integrity_violation");
    expect(k("refused", { code: "reservation_conversation_mismatch" })).toBe("integrity_violation");
    expect(k("refused", { code: "history_unavailable" })).toBe("insufficient_context");
    expect(k("refused", { code: "semantic_block" })).toBe("operational_restriction");
    expect(k("reply", {}, { checks: { context: "ok", senderIdentity: { reason: "channel_other_tenant" } } })).toBe("integrity_violation");
  });
  const meta = (over: Partial<ExecutionMeta> = {}): ExecutionMeta => ({
    executionId: EXEC_ID, tenantId: T_ID, propertyId: P_ID, conversationId: CONV, channel: "web", batchId: null, leaseVersion: null, modelId: "openai/gpt-5.6-sol",
    startedAt: "2026-11-03T10:00:00.000Z", finishedAt: "2026-11-03T10:00:01.000Z", totalMs: 10, leaseMs: 1, contextMs: 2, gatewayMs: 3, validationMs: 4,
    gateway: NO_GATEWAY, estimatedInputTokens: null, pauseState: "inactive", executionState: "completed", technicalCode: null, blockCode: null, integrityCode: null,
    budgetExceeded: null, tokenLimitViolation: false, concurrencyDetected: false, forcedDecision: null, ...over,
  });
  it("registro: chaves EXATAS e fechadas; recursivamente só primitivos, arrays de enum e o mapa fechado de tempos", () => {
    const r = validateExecutionRecord(buildExecutionRecord(narrowOutcome(outcome("reply")), meta(), "chain.x"))!;
    expect(r).not.toBeNull();
    expect(Object.keys(r).sort()).toEqual([...SHADOW_RECORD_KEYS].sort());
    const walk = (v: unknown, path: string): void => {
      if (v === null || ["string", "number", "boolean"].includes(typeof v)) return;
      if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${path}[${i}]`));
      expect(path === "timings", `objeto aninhado só em timings (achei em ${path})`).toBe(true);
      for (const [k, x] of Object.entries(v as object)) walk(x, `${path}.${k}`);
    };
    for (const [k, v] of Object.entries(r)) walk(v, k);
    expect(r.shadowVersion).toBe(SHADOW_VERSION);
    expect(JSON.stringify(r)).not.toContain(CANARY);
    // nenhuma chave do registro tem nome de texto livre
    const FREE = new Set(["text", "reply", "prompt", "message", "messages", "question", "content", "reason", "note", "answer", "draft", "explanation", "justification", "body", "history", "transcript", "error"]);
    const words = (k: string) => k.split(/(?=[A-Z])/).map((w) => w.toLowerCase());
    expect(SHADOW_RECORD_KEYS.filter((k) => words(k).some((w) => FREE.has(w)) && k !== "gatewayError")).toEqual([]);
    // `gatewayError` é o CÓDIGO fechado do Gateway (LLM_ERROR_CODES), nunca mensagem — conferido pela validação de valor
  });
  it("forçada > integridade > cadeia; sem cadeia ⇒ falha técnica; erro do Gateway ⇒ gateway_error", () => {
    expect(buildExecutionRecord(null, meta({ forcedDecision: "budget_blocked" }), "c").decision).toBe("budget_blocked");
    expect(buildExecutionRecord(null, meta({ integrityCode: "cross_tenant" }), "c")).toMatchObject({ decision: "integrity_violation", integrityCode: "cross_tenant" });
    expect(buildExecutionRecord(null, meta(), "c")).toMatchObject({ decision: "technical_failure", chainVersion: "c", timings: EMPTY_TIMINGS, intents: [], strategy: null });
    expect(buildExecutionRecord(narrowOutcome(outcome("technical_error", { code: "model_call_failed" })), meta({ gateway: { ...NO_GATEWAY, error: "timeout" } }), "c")).toMatchObject({ technicalCode: "model_call_failed", gatewayError: "timeout" });
    expect(buildExecutionRecord(narrowOutcome(outcome("reply")), meta({ gateway: { ...NO_GATEWAY, error: "network" } }), "c").technicalCode).toBe("gateway_error");
    expect(buildExecutionRecord(narrowOutcome(outcome("refused", { code: "dossier_out_of_scope" })), meta(), "c").integrityCode).toBe("dossier_out_of_scope");
    expect(buildExecutionRecord(narrowOutcome(outcome("reply", {}, { checks: { context: "ok", senderIdentity: { reason: "twin_inconsistent" } } })), meta(), "c").integrityCode).toBe("twin_inconsistent");
    expect(buildExecutionRecord(null, meta({ executionState: "timed_out", forcedDecision: "technical_failure", technicalCode: "shadow_timeout" }), "c").timeout).toBe(true);
    expect(buildExecutionRecord(narrowOutcome(outcome("human_action")), meta(), "c").humanInterventionNeeded).toBe(true);
  });
  it("validação rejeita QUALQUER desvio (texto em campo de enum, chave a mais, formato)", () => {
    const good = buildExecutionRecord(narrowOutcome(outcome("reply")), meta(), "chain.x");
    expect(validateExecutionRecord(good)).not.toBeNull();
    const bad: Array<Record<string, unknown>> = [
      { decision: CANARY }, { channel: CANARY }, { strategy: CANARY }, { intents: [CANARY] }, { commitmentKinds: [CANARY] }, { refusalCode: CANARY },
      { technicalCode: CANARY }, { blockCode: CANARY }, { integrityCode: CANARY }, { gatewayError: CANARY }, { budgetExceeded: CANARY }, { pauseState: CANARY },
      { contextCheck: CANARY }, { executionState: CANARY }, { usageSource: CANARY }, { handoffUrgency: CANARY }, { modelId: CANARY },
      { chainVersion: CANARY }, { composerVersion: CANARY }, { shadowVersion: "x" }, { executionId: CANARY }, { tenantId: "t1" }, { batchId: CANARY },
      { startedAt: CANARY }, { finishedAt: "2026-11-03" }, { totalMs: -1 }, { gatewayCalls: 3 }, { costUsd: -0.1 }, { costUsd: Number.NaN }, { leaseVersion: 1.5 },
      { estimatedInputTokens: -2 }, { candidateAvailable: false }, { intentCount: 7 }, { responseDiscarded: false }, { timeout: "yes" },
      { humanInterventionNeeded: 1 }, { timings: { ...good.timings, extra: 1 } }, { timings: { ...good.timings, context: -1 } }, { timings: [] },
      { decision: "integrity_violation", candidateAvailable: false }, { decision: "technical_failure", candidateAvailable: false }, { extraKey: 1 },
    ];
    for (const b of bad) expect(validateExecutionRecord({ ...good, ...b }), JSON.stringify(b)).toBeNull();
    const missing: Record<string, unknown> = { ...good };
    delete missing.decision;
    expect(validateExecutionRecord(missing)).toBeNull();
    expect(validateExecutionRecord(null)).toBeNull();
    expect(validateExecutionRecord([good])).toBeNull();
  });
});

describe("B3.3 · adaptador do store (respostas lidas por lista branca)", () => {
  const rawControl = (over: Record<string, unknown> = {}) => ({
    result: "ok", state: "running", state_version: 3, model_id: "openai/gpt-6-astra", reasoning_effort: "low", max_input_tokens: 1, max_output_tokens: 2, max_total_tokens: 3,
    max_turn_cost_usd: "0.5", daily_cost_limit_usd: 1, max_daily_tokens: 4, max_daily_calls: 5, error_window_minutes: 6, error_min_sample: 7, budget_day_timezone: "America/Sao_Paulo",
    telemetry_retention_days: 8, tick_interval_seconds: 9, max_conversations_per_tick: 10, manifest_version: 11, retention_scope: "openai_responses", retention_authorized: true,
    db_now: "2026-11-04T12:00:00.123456Z", ...over,
  });
  it("estado lido; qualquer campo fora do formato ⇒ ilegível (null)", () => {
    expect(parseControl(rawControl())).toMatchObject({ state: "running", maxTurnCostUsd: 0.5, retentionAuthorized: true, retentionScope: "openai_responses", dbNowMs: Date.parse("2026-11-04T12:00:00.123Z") });
    // E3.1: sem o instante do banco (ou fora do formato UTC) ⇒ ilegível
    for (const db_now of [undefined, null, "2026-11-04 12:00:00", "2026-11-04T12:00:00+03:00", "2026-13-40T99:00:00Z", 1730721600000]) expect(parseControl(rawControl({ db_now })), String(db_now)).toBeNull();
    expect(parseControl(rawControl({ retention_scope: null, retention_authorized: true }))!.retentionAuthorized).toBe(false);
    for (const o of [{ result: "x" }, { state: "on" }, { state_version: "3" }, { max_input_tokens: 1.5 }, { max_turn_cost_usd: "abc" }, { daily_cost_limit_usd: {} }, { model_id: "google/gemini-3.8-flash" }, { reasoning_effort: "x" }, { budget_day_timezone: 5 }, { retention_scope: "x" }, { retention_authorized: "true" }]) {
      expect(parseControl(rawControl(o)), JSON.stringify(o)).toBeNull();
    }
    expect(parseControl(null)).toBeNull();
    expect(parseControl([])).toBeNull();
    expect(parseControl(rawControl({ model_id: null, reasoning_effort: null, budget_day_timezone: null, max_turn_cost_usd: null }))).toMatchObject({ modelId: null, maxTurnCostUsd: null });
  });
  it("manifesto: uma entrada inválida (ou repetida) invalida o manifesto inteiro", () => {
    const e = { tenant_id: T_ID, property_id: P_ID, selection_reason: "highest_volume", twin_status: "verified", history_status: "verified" };
    expect(parseManifest({ result: "ok", manifest_version: 2, entries: [e] })!.entries).toHaveLength(1);
    expect(parseManifest({ result: "ok", manifest_version: null, entries: [] })).toEqual({ manifestVersion: null, entries: [] });
    for (const bad of [{ ...e, tenant_id: "x" }, { ...e, property_id: 1 }, { ...e, selection_reason: CANARY }, { ...e, twin_status: "ok" }, { ...e, history_status: null }, null]) {
      expect(parseManifest({ result: "ok", manifest_version: 2, entries: [bad] })).toBeNull();
    }
    expect(parseManifest({ result: "ok", manifest_version: null, entries: [e] })).toBeNull();
    expect(parseManifest({ result: "ok", manifest_version: 2, entries: [e, e] })).toBeNull();
    expect(parseManifest({ result: "ok", manifest_version: "2", entries: [] })).toBeNull();
    expect(parseManifest({ result: "no", entries: [] })).toBeNull();
  });
  it("cada RPC: resposta inesperada/erro/exceção ⇒ erro (nunca autorização)", async () => {
    const replies: Record<string, unknown> = {};
    const rpc = { call: vi.fn(async (fn: string) => (fn in replies ? (replies[fn] instanceof Error ? Promise.reject(replies[fn]) : { data: replies[fn], error: null }) : { data: null, error: { code: "x" } })) };
    const s = createShadowStore(rpc as never);
    expect(await s.readControl()).toBeNull();
    expect(await s.readManifest()).toBeNull();
    expect(await s.trip("circuit_open", "error_rate_exceeded")).toBe("error");
    expect(await s.reserve(EXEC_ID, { tokens: 1, costUsd8: 1n, calls: 1 })).toEqual({ kind: "error" });
    // valor monetário impossível (negativo) nunca sai do processo
    expect(await s.reserve(EXEC_ID, { tokens: 1, costUsd8: -1n, calls: 1 })).toEqual({ kind: "error" });
    expect(await s.evaluateBreakers()).toBe("measurement_unavailable");
    expect(await s.record({} as never)).toEqual({ kind: "invalid" });
    replies.shadow_trip = { result: "applied" };
    expect(await s.trip("circuit_open", "error_rate_exceeded")).toBe("applied");
    replies.shadow_trip = { result: "noop" };
    expect(await s.trip("circuit_open", "error_rate_exceeded")).toBe("noop");
    replies.shadow_trip = new Error(CANARY);
    expect(await s.trip("circuit_open", "error_rate_exceeded")).toBe("error");
    const rid = "7f000000-0000-4000-8000-000000000001";
    for (const [reply, expected] of [
      [{ result: "reserved", reservation_id: rid }, { kind: "reserved", reservationId: rid }],
      [{ result: "reserved", reservation_id: "x" }, { kind: "error" }],
      [{ result: "exceeded", limit: "daily_cost" }, { kind: "exceeded", limit: "daily_cost" }],
      [{ result: "exceeded", limit: CANARY }, { kind: "error" }],
      [{ result: "state_not_running" }, { kind: "blocked", code: "state_not_running" }],
      [{ result: "config_incomplete" }, { kind: "blocked", code: "config_incomplete" }],
      [{ result: "duplicate" }, { kind: "blocked", code: "duplicate" }],
      [{ result: "invalid_argument" }, { kind: "blocked", code: "invalid_argument" }],
      [{ result: "not_claimed" }, { kind: "blocked", code: "not_claimed" }],
      [{ result: CANARY }, { kind: "error" }],
    ] as const) {
      replies.shadow_reserve_budget = reply;
      expect(await s.reserve(EXEC_ID, { tokens: 1, costUsd8: 13_072_000n, calls: 1 })).toEqual(expected);
    }
    // o custo sai como decimal EXATO de 8 casas (nunca ponto flutuante)
    expect(rpc.call).toHaveBeenLastCalledWith("shadow_reserve_budget", { p_execution_id: EXEC_ID, p_tokens: 1, p_cost: "0.13072000", p_calls: 1 });
    replies.shadow_evaluate_breakers = { result: "consecutive_failures" };
    expect(await s.evaluateBreakers()).toBe("consecutive_failures");
    replies.shadow_evaluate_breakers = { result: CANARY };
    expect(await s.evaluateBreakers()).toBe("measurement_unavailable");
    for (const [reply, expected] of [
      [{ result: "recorded", breaker: "ok" }, { kind: "recorded", breaker: "ok" }],
      [{ result: "recorded", breaker: "integrity_violation" }, { kind: "recorded", breaker: "integrity_violation" }],
      [{ result: "recorded", breaker: CANARY }, { kind: "error" }],
      [{ result: "duplicate" }, { kind: "duplicate" }],
      [{ result: "invalid_argument" }, { kind: "invalid" }],
    ] as const) {
      replies.shadow_record_execution = reply;
      const rec = buildExecutionRecord(null, { executionId: EXEC_ID, tenantId: T_ID, propertyId: P_ID, conversationId: CONV, channel: "web", batchId: null, leaseVersion: null, modelId: null, startedAt: "2026-11-03T10:00:00.000Z", finishedAt: "2026-11-03T10:00:00.000Z", totalMs: 0, leaseMs: 0, contextMs: 0, gatewayMs: 0, validationMs: 0, gateway: NO_GATEWAY, estimatedInputTokens: null, pauseState: "not_evaluated", executionState: "blocked", technicalCode: null, blockCode: "not_in_manifest", integrityCode: null, budgetExceeded: null, tokenLimitViolation: false, concurrencyDetected: false, forcedDecision: "blocked_not_authorized" }, "chain.x");
      expect(await s.record(rec)).toEqual(expected);
    }
  });
  it("linha gravada = colunas snake_case exatas (tempos achatados em timing_*)", () => {
    const rec = buildExecutionRecord(null, { executionId: EXEC_ID, tenantId: T_ID, propertyId: P_ID, conversationId: CONV, channel: "web", batchId: null, leaseVersion: null, modelId: null, startedAt: "2026-11-03T10:00:00.000Z", finishedAt: "2026-11-03T10:00:00.000Z", totalMs: 0, leaseMs: 0, contextMs: 0, gatewayMs: 0, validationMs: 0, gateway: NO_GATEWAY, estimatedInputTokens: null, pauseState: "not_evaluated", executionState: "blocked", technicalCode: null, blockCode: "not_in_manifest", integrityCode: null, budgetExceeded: null, tokenLimitViolation: false, concurrencyDetected: false, forcedDecision: "blocked_not_authorized" }, "chain.x");
    const row = recordToRow(rec);
    expect(Object.keys(row)).toHaveLength(62);
    expect(row).toMatchObject({ timing_context: null, timing_final_decision: null, decision: "blocked_not_authorized" });
    expect(Object.keys(row).every((k) => /^[a-z_]+$/.test(k))).toBe(true);
  });
  it("fábrica do servidor usa a porta de lista fechada", async () => {
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { rpc: vi.fn(async () => ({ data: { result: "x" }, error: null })) } }));
    const s = await getShadowStore();
    expect(await s.readControl()).toBeNull();
    vi.doUnmock("@/integrations/supabase/client.server");
  });
});

describe("B3.3 · portas RPC de lista fechada (lease com sinal retrocompatível + Shadow)", () => {
  const client = () => {
    const calls: Array<{ fn: string; signal: AbortSignal | null }> = [];
    return {
      calls,
      rpc(fn: string) {
        const entry = { fn, signal: null as AbortSignal | null };
        calls.push(entry);
        const p = Promise.resolve({ data: { result: "ok" }, error: null });
        return Object.assign(p, { abortSignal: (s: AbortSignal) => { entry.signal = s; return p; } });
      },
    };
  };
  it("sem sinal: idêntico ao B3.1; com sinal: anexado; abortado: nenhuma requisição", async () => {
    const c = client();
    expect(await leaseRpcFrom(c).call("claim_conversation_lease", {})).toEqual({ data: { result: "ok" }, error: null });
    expect(c.calls[0]).toEqual({ fn: "claim_conversation_lease", signal: null });
    const ac = new AbortController();
    await leaseRpcFrom(c, ac.signal).call("transition_conversation_lease", {});
    expect(c.calls[1]!.signal).toBe(ac.signal);
    ac.abort();
    expect(await leaseRpcFrom(c, ac.signal).call("transition_conversation_lease", {})).toEqual({ data: null, error: { code: "aborted" } });
    expect(c.calls).toHaveLength(2);
    expect(await leaseRpcFrom(c).call("shadow_trip" as never, {})).toEqual({ data: null, error: { code: "lease_rpc_not_allowed" } });
    // construtor sem abortSignal (cliente mínimo) continua funcionando
    const plain = { rpc: async () => ({ data: 1, error: null }) };
    expect(await leaseRpcFrom(plain, new AbortController().signal).call("claim_conversation_lease", {})).toEqual({ data: 1, error: null });
  });
  it("porta do Shadow: só as 7 funções do worker; administrativas recusadas antes de sair", async () => {
    expect(SHADOW_RPC_FUNCTIONS).toEqual([
      "shadow_get_control", "shadow_get_manifest", "shadow_trip", "shadow_reserve_budget", "shadow_evaluate_breakers", "shadow_record_execution",
      "shadow_acquire_tick", "shadow_release_tick", "shadow_claim_execution", "shadow_finalize_execution", "shadow_reconcile",
    ]);
    // a liquidação avulsa não existe mais na porta: só dentro da finalização atômica do banco
    expect(await shadowRpcFrom(client()).call("shadow_settle_budget" as never, {})).toEqual({ data: null, error: { code: "shadow_rpc_not_allowed" } });
    const c = client();
    const ac = new AbortController();
    await shadowRpcFrom(c, ac.signal).call("shadow_get_control", {});
    expect(c.calls[0]!.signal).toBe(ac.signal);
    for (const fn of ["shadow_transition", "shadow_configure", "shadow_authorize_retention", "shadow_manifest_add", "shadow_report", "shadow_purge_expired", "transition_conversation_lease"]) {
      expect(await shadowRpcFrom(c).call(fn as never, {})).toEqual({ data: null, error: { code: "shadow_rpc_not_allowed" } });
    }
    ac.abort();
    expect(await shadowRpcFrom(c, ac.signal).call("shadow_get_control", {})).toEqual({ data: null, error: { code: "aborted" } });
    expect(await shadowRpcFrom(c).call("shadow_get_manifest", {})).toEqual({ data: { result: "ok" }, error: null });
    expect(c.calls).toHaveLength(2);
  });
});

describe("B3.3 · gerador emitido (barreiras antes da rede, transporte falso)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchSpy = vi.fn(() => { throw new Error("rede proibida"); });
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => vi.unstubAllGlobals());
  const pf = (stateVersion = 7) => issueShadowPreflight({ executionId: EXEC_ID, tenantId: T_ID, propertyId: P_ID, conversationId: CONV, stateVersion, manifestOk: true, integrityOk: true, pauseInactive: true, ownershipOk: true })!;
  const prompt = { system: "s", messages: [{ role: "user" as const, content: "u" }], sourceIds: new Set(["x"]) } as never;
  const deadline = () => new ShadowDeadline({ now: () => 0, schedule: () => () => undefined });
  it("pré-autorização só com todas as provas e ids válidos; gerador só com pré-autorização emitida e modelo /responses", () => {
    expect(issueShadowPreflight({ executionId: EXEC_ID, tenantId: T_ID, propertyId: P_ID, conversationId: CONV, stateVersion: 1, manifestOk: false as never, integrityOk: true, pauseInactive: true, ownershipOk: true })).toBeNull();
    expect(issueShadowPreflight({ executionId: "x", tenantId: T_ID, propertyId: P_ID, conversationId: CONV, stateVersion: 1, manifestOk: true, integrityOk: true, pauseInactive: true, ownershipOk: true })).toBeNull();
    expect(issueShadowPreflight({ executionId: EXEC_ID, tenantId: T_ID, propertyId: P_ID, conversationId: CONV, stateVersion: 1.2, manifestOk: true, integrityOk: true, pauseInactive: true, ownershipOk: true })).toBeNull();
    const store = new MemoryShadowStore();
    const forged = { executionId: EXEC_ID, tenantId: T_ID, propertyId: P_ID, conversationId: CONV, stateVersion: 7 };
    expect(createShadowGatewayGenerator({ preflight: forged, limits: limits(), deadline: deadline(), store })).toBeNull();
    expect(createShadowGatewayGenerator({ preflight: pf(), limits: { ...limits(), modelId: "google/gemini-3.8-flash" as never }, deadline: deadline(), store })).toBeNull();
    expect(createShadowGatewayGenerator(null as never)).toBeNull();
    vi.doMock("@/lib/guest-ai/llm/models", async (orig) => ({ ...(await orig()), modelSpec: () => null }));
    const g = createShadowGatewayGenerator({ preflight: pf(), limits: limits(), deadline: deadline(), store })!;
    expect(isShadowGatewayGenerator(g)).toBe(true);
    expect(isShadowGatewayGenerator({ ...g })).toBe(false);
    expect(isShadowGatewayGenerator(null)).toBe(false);
    vi.doUnmock("@/lib/guest-ai/llm/models");
  });
  const run = async (store: MemoryShadowStore, over: Record<string, unknown> = {}, signal = new AbortController().signal) => {
    const provider = fakeProvider(okJson({ ok: true, note: CANARY }));
    const g = createShadowGatewayGenerator({ preflight: pf(), limits: limits(), deadline: deadline(), store, provider, masterSwitchOn: () => true, ...over })!;
    let out: string | null = null;
    let err: unknown = null;
    try {
      out = await g.generate(prompt, signal);
    } catch (e) {
      err = e;
    }
    return { g, provider, out, err: err as ShadowGeneratorStop | null };
  };
  it("sucesso: devolve só o JSON re-serializado; telemetria só números; texto bruto não fica", async () => {
    const { g, out, provider } = await run(new MemoryShadowStore());
    expect(out).toBe(JSON.stringify({ ok: true, note: CANARY }));
    expect(provider.calls).toBe(1);
    expect(JSON.stringify(g.telemetry())).not.toContain(CANARY);
    expect(g.telemetry()).toMatchObject({ status: "called", calls: 1, inputTokens: 900, usageSource: "provider", error: null });
    expect(fetchSpy).not.toHaveBeenCalled();
    // uma chamada por execução
    await expect(g.generate(prompt, new AbortController().signal)).rejects.toMatchObject({ code: "generator_not_issued" });
  });
  it("cada barreira fecha ANTES da rede, com código fechado", async () => {
    const cases: Array<[string, (s: MemoryShadowStore) => Record<string, unknown> | void, AbortSignal?]> = [
      ["master_switch_off", () => ({ masterSwitchOn: () => false })],
      ["state_unreadable", (s) => void (s.fail.readControl = true)],
      ["shutdown_requested", (s) => void (s.control = fullControl({ state: "paused" }))],
      ["shutdown_requested", (s) => void (s.control = fullControl({ stateVersion: 8 }))],
      ["retention_not_authorized", (s) => void (s.control = fullControl({ retentionAuthorized: false }))],
      ["limits_missing", (s) => void (s.control = fullControl({ maxDailyCalls: null }))],
      ["budget_turn_exceeded", () => ({ limits: { ...limits(), maxInputTokens: 0.5 } })],
      ["budget_daily_exceeded", (s) => void (s.settledCost = 1)],
      ["budget_reservation_failed", (s) => void (s.fail.reserve = true)],
    ];
    for (const [code, setup] of cases) {
      const store = new MemoryShadowStore();
      const over = setup(store) ?? {};
      const { err, provider, g } = await run(store, over);
      expect(err, code).toBeInstanceOf(ShadowGeneratorStop);
      expect(err!.code).toBe(code);
      expect(provider.calls, code).toBe(0);
      expect(g.telemetry().status).toBe("blocked");
    }
    const ac = new AbortController();
    ac.abort();
    const aborted = await run(new MemoryShadowStore(), {}, ac.signal);
    expect(aborted.err!.code).toBe("deadline_expired");
    const expired = new ShadowDeadline({ now: () => Number.NaN, schedule: () => () => undefined });
    expect((await run(new MemoryShadowStore(), { deadline: expired })).err!.code).toBe("deadline_expired");
  });
  it("reserva recusada por estado ⇒ shutdown; chave desligada ENTRE a reserva e a rede ⇒ nenhuma rede", async () => {
    const s = new MemoryShadowStore();
    s.reserve = async () => ({ kind: "blocked", code: "state_not_running" });
    expect((await run(s)).err!.code).toBe("shutdown_requested");
    let n = 0;
    const r = await run(new MemoryShadowStore(), { masterSwitchOn: () => ++n === 1 });
    expect(r.err!.code).toBe("master_switch_off");
    expect(r.provider.calls).toBe(0);
    let m = 0;
    const d = deadline();
    const late = await run(new MemoryShadowStore(), { deadline: { ...d, signal: d.signal, processingRemainingMs: () => (++m === 1 ? 5000 : 0) } });
    expect(late.err!.code).toBe("deadline_expired");
  });
  it("falha do Gateway ⇒ sem texto, código; desligamento depois da resposta ⇒ descartada", async () => {
    const store = new MemoryShadowStore();
    const provider = fakeProvider({ kind: "error", error: { code: "auth", retryable: false, httpStatus: 401 }, usage: null, requestId: null });
    const g = createShadowGatewayGenerator({ preflight: pf(), limits: limits(), deadline: deadline(), store, provider, masterSwitchOn: () => true })!;
    await expect(g.generate(prompt, new AbortController().signal)).rejects.toMatchObject({ code: "gateway_failed" });
    expect(g.telemetry()).toMatchObject({ status: "failed", error: "auth" });
    const s2 = new MemoryShadowStore();
    const p2 = fakeProvider(() => { s2.control = fullControl({ state: "paused" }); return okJson({ x: CANARY }); });
    const g2 = createShadowGatewayGenerator({ preflight: pf(), limits: limits(), deadline: deadline(), store: s2, provider: p2, masterSwitchOn: () => true })!;
    await expect(g2.generate(prompt, new AbortController().signal)).rejects.toMatchObject({ code: "response_discarded" });
    expect(g2.telemetry()).toMatchObject({ status: "discarded", blockCode: "shutdown_requested" });
    const ac = new AbortController();
    const p3 = fakeProvider(() => { ac.abort(); return okJson({}); });
    const g3 = createShadowGatewayGenerator({ preflight: pf(), limits: limits(), deadline: deadline(), store: new MemoryShadowStore(), provider: p3, masterSwitchOn: () => true })!;
    // cancelado DURANTE a chamada: o próprio Gateway devolve `aborted` (falha, nada parcial sai)
    await expect(g3.generate(prompt, ac.signal)).rejects.toMatchObject({ code: "gateway_failed" });
    expect(g3.telemetry()).toMatchObject({ status: "failed", error: "aborted" });
  });
  it("prompt sem mensagens/sistema ⇒ estimativa 0 ⇒ bloqueio por orçamento (nunca chamada vazia)", async () => {
    const g = createShadowGatewayGenerator({ preflight: pf(), limits: limits(), deadline: deadline(), store: new MemoryShadowStore(), provider: fakeProvider(okJson({})), masterSwitchOn: () => true })!;
    await expect(g.generate({ messages: "x" } as never, new AbortController().signal)).rejects.toMatchObject({ code: "budget_turn_exceeded" });
    const g2 = createShadowGatewayGenerator({ preflight: pf(), limits: limits(), deadline: deadline(), store: new MemoryShadowStore(), provider: fakeProvider(okJson({})), masterSwitchOn: () => true })!;
    await expect(g2.generate({ system: "", messages: [{ role: "user", content: 5 }] } as never, new AbortController().signal)).rejects.toMatchObject({ code: "budget_turn_exceeded" });
  });
  it("chave mestra padrão = ambiente", () => {
    vi.stubEnv("GUEST_AI_SHADOW", "on");
    expect(defaultMasterSwitch()).toBe(true);
    vi.stubEnv("GUEST_AI_SHADOW", "ON");
    expect(defaultMasterSwitch()).toBe(false);
    vi.unstubAllEnvs();
  });
});

describe("B3.3 · executor (barreira estrutural)", () => {
  const issued = () => {
    const pf = issueShadowPreflight({ executionId: EXEC_ID, tenantId: T_ID, propertyId: P_ID, conversationId: CONV, stateVersion: 7, manifestOk: true, integrityOk: true, pauseInactive: true, ownershipOk: true })!;
    return createShadowGatewayGenerator({ preflight: pf, limits: limits(), deadline: new ShadowDeadline({ now: () => 0, schedule: () => () => undefined }), store: new MemoryShadowStore(), provider: fakeProvider(okJson({})), masterSwitchOn: () => true })!;
  };
  it("recusa dependência extra, porta desconhecida/ausente/não função, gerador não emitido e sinal ausente", () => {
    const base = { ports: operationalPorts(), generator: issued(), signal: new AbortController().signal, remainingMs: () => 1000 };
    expect(checkExecutorBarrier(base)).toBeNull();
    expect(checkExecutorBarrier(null)).toBe("missing_port");
    expect(checkExecutorBarrier({ ...base, send: () => 1 })).toBe("unexpected_dependency");
    expect(checkExecutorBarrier({ ...base, ports: null })).toBe("missing_port");
    expect(checkExecutorBarrier({ ...base, ports: { ...operationalPorts(), deliver: () => 1 } })).toBe("unexpected_port");
    expect(checkExecutorBarrier({ ...base, ports: { ...operationalPorts(), loadContext: 1 } })).toBe("port_not_function");
    const missing: Record<string, unknown> = { ...operationalPorts() };
    delete missing.loadHumanPause;
    expect(checkExecutorBarrier({ ...base, ports: missing })).toBe("missing_port");
    expect(checkExecutorBarrier({ ...base, generator: { generate: async () => "{}" } })).toBe("generator_not_issued");
    expect(checkExecutorBarrier({ ...base, signal: {} })).toBe("signal_missing");
    expect(checkExecutorBarrier({ ...base, remainingMs: 5 })).toBe("signal_missing");
  });
  it("violação ⇒ nada executa; prazo esgotado ⇒ nada executa", async () => {
    expect(await runShadowExecution({ turn: shadowTurn(), traceId: "x" }, { ports: operationalPorts(), generator: { generate: async () => "{}" } as never, signal: new AbortController().signal, remainingMs: () => 1000 })).toEqual({ kind: "barrier_violation", reason: "generator_not_issued" });
    expect(await runShadowExecution({ turn: shadowTurn(), traceId: "x" }, { ports: operationalPorts(), generator: issued(), signal: new AbortController().signal, remainingMs: () => 0 })).toEqual({ kind: "barrier_violation", reason: "deadline_expired" });
    const ac = new AbortController();
    ac.abort();
    expect(await runShadowExecution({ turn: shadowTurn(), traceId: "x" }, { ports: operationalPorts(), generator: issued(), signal: ac.signal, remainingMs: () => 1000 })).toEqual({ kind: "barrier_violation", reason: "deadline_expired" });
  });
});

describe("B3.3 · loader REAL da posse humana", () => {
  const conv = (over: Record<string, unknown> = {}) => ({ id: CONV, property_id: P_ID, status: "ai", assigned_to: null, handoff_reason: null, handoff_urgency: null, handoff_at: null, resolved_at: null, ai_paused: false, paused_until: null, ...over });
  const prop = (over: Record<string, unknown> = {}) => ({ id: P_ID, owner_id: T_ID, ...over });
  const load = (tables: Record<string, Array<Record<string, unknown>>>, opts: Parameters<typeof fakeDb>[1] = {}, signal?: AbortSignal) => {
    const f = fakeDb(tables, opts);
    return { f, p: loadConversationOwnership(shadowTurn(), { db: f.db, signal, nowIso: "2026-11-03T10:00:00Z" }) };
  };
  it("ausência COMPROVADA (status conhecido e fechado) ⇒ none, com projeção explícita e sinal em toda consulta", async () => {
    const ac = new AbortController();
    const { f, p } = load({ property_chat_conversations: [conv()], properties: [prop()] }, {}, ac.signal);
    expect(await p).toMatchObject({ status: "none", row: { id: CONV, status: "ai" } });
    expect(f.calls.map((c) => c.table)).toEqual(["property_chat_conversations", "properties"]);
    const colsOf = (x: string | null) => (x ?? "").split(",").map((c) => c.trim());
    expect(colsOf(f.calls[0]!.select)).toEqual(["id", "status", "assigned_to", "handoff_reason", "handoff_urgency", "handoff_at", "resolved_at", "ai_paused", "paused_until", "property_id"]);
    expect(colsOf(f.calls[1]!.select)).toEqual(["id", "owner_id"]);
    expect(f.calls.every((c) => c.signal === ac.signal)).toBe(true);
    expect(f.writes).toEqual([]);
  });
  it("posse identificada (chamado aberto) ⇒ identified", async () => {
    expect((await load({ property_chat_conversations: [conv({ status: "needs_human", handoff_at: "2026-11-03T09:00:00Z" })], properties: [prop()] }).p).status).toBe("identified");
  });
  it("status desconhecido ou pausa ilegível ⇒ indeterminate (nunca 'sem posse')", async () => {
    expect((await load({ property_chat_conversations: [conv({ status: "weird" })], properties: [prop()] }).p).status).toBe("indeterminate");
    expect((await load({ property_chat_conversations: [conv({ ai_paused: "sim" })], properties: [prop()] }).p).status).toBe("indeterminate");
    expect((await load({ property_chat_conversations: [conv({ status: null })], properties: [prop()] }).p).status).toBe("indeterminate");
  });
  it("falha de banco, exceção ou cancelamento ⇒ read_failed (nunca resultado vazio)", async () => {
    expect((await load({}, { fail: { property_chat_conversations: true } }).p).status).toBe("read_failed");
    expect((await load({ property_chat_conversations: [conv()] }, { fail: { properties: true } }).p).status).toBe("read_failed");
    expect((await load({}, { throwOn: ["property_chat_conversations"] }).p).status).toBe("read_failed");
    const ac = new AbortController();
    ac.abort();
    expect((await load({ property_chat_conversations: [conv()], properties: [prop()] }, {}, ac.signal).p).status).toBe("read_failed");
  });
  it("divergências: imóvel, tenant e identidade (linha ausente, duplicada ou com outro id)", async () => {
    expect((await load({ property_chat_conversations: [conv({ property_id: OTHER_P })], properties: [prop()] }).p).status).toBe("property_mismatch");
    expect((await load({ property_chat_conversations: [conv()], properties: [prop({ owner_id: OTHER_T })] }).p).status).toBe("tenant_mismatch");
    expect((await load({ property_chat_conversations: [conv()], properties: [prop({ owner_id: null })] }).p).status).toBe("tenant_mismatch");
    expect((await load({ property_chat_conversations: [], properties: [prop()] }).p).status).toBe("identity_inconsistent");
    expect((await load({ property_chat_conversations: [conv(), conv()], properties: [prop()] }).p).status).toBe("identity_inconsistent");
    expect((await load({ property_chat_conversations: [conv()], properties: [] }).p).status).toBe("identity_inconsistent");
    expect((await load({ property_chat_conversations: [conv()], properties: [prop(), prop()] }).p).status).toBe("identity_inconsistent");
  });
  it("dado incompleto/formato inesperado não vira ausência de posse", async () => {
    const weird = fakeDb({});
    const db = { from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: { not: "array" }, error: null }) }) }) }) };
    expect((await loadConversationOwnership(shadowTurn(), { db: db as never, nowIso: "2026-11-03T10:00:00Z" })).status).toBe("read_failed");
    const db2 = { from: (t: string) => ({ select: () => ({ eq: () => ({ limit: async () => (t === "properties" ? { data: "x", error: null } : { data: [conv({ id: "other" })], error: null }) }) }) }) };
    expect((await loadConversationOwnership(shadowTurn(), { db: db2 as never, nowIso: "2026-11-03T10:00:00Z" })).status).toBe("identity_inconsistent");
    const db3 = { from: (t: string) => ({ select: () => ({ eq: () => ({ limit: async () => (t === "properties" ? { data: "x", error: null } : { data: [conv()], error: null }) }) }) }) };
    expect((await loadConversationOwnership(shadowTurn(), { db: db3 as never, nowIso: "2026-11-03T10:00:00Z" })).status).toBe("read_failed");
    const db4 = { from: (t: string) => ({ select: () => ({ eq: () => ({ limit: async () => (t === "properties" ? { data: [{ id: OTHER_P, owner_id: T_ID }], error: null } : { data: [conv()], error: null }) }) }) }) };
    expect((await loadConversationOwnership(shadowTurn(), { db: db4 as never, nowIso: "2026-11-03T10:00:00Z" })).status).toBe("identity_inconsistent");
    void weird;
  });
  it("turno não emitido é recusado (exceção de confiança, não resultado)", async () => {
    await expect(loadConversationOwnership({ ...shadowTurn() } as never, { db: fakeDb({}).db, nowIso: "x" })).rejects.toThrow();
  });
  it("sem `db` usa o cliente administrativo (fábrica do servidor)", async () => {
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeDb({ property_chat_conversations: [conv()], properties: [prop()] }).db }));
    expect((await loadConversationOwnership(shadowTurn(), { nowIso: "2026-11-03T10:00:00Z" })).status).toBe("none");
    vi.doUnmock("@/integrations/supabase/client.server");
  });
});

describe("B3.3 · candidatas (só imóveis do manifesto, só leitura)", () => {
  const entries = manifestOf().entries;
  const conv = (over: Record<string, unknown> = {}) => ({ id: CONV, property_id: P_ID, guest_session_id: "airbnb:th1", last_message_at: "2026-11-03T10:00:00Z", ...over });
  const msg = (over: Record<string, unknown> = {}) => ({ id: MSG, conversation_id: CONV, created_at: "2026-11-03T10:00:00Z", sender_type: "guest", role: "user", ...over });
  const now = Date.parse("2026-11-03T10:01:00Z");
  it("janela derivada SÓ de valores aprovados (coletor + cadência)", () => {
    expect(candidateLookbackMs(60)).toBe(120_000 + 60_000 + 60_000);
  });
  it("lista conversas do manifesto com a última mensagem de hóspede; superfície pelo prefixo da sessão", async () => {
    const ac = new AbortController();
    const f = fakeDb({ property_chat_conversations: [conv(), conv({ id: "22222222-0000-4000-8000-000000000009", guest_session_id: "wa:55", property_id: P_ID })], property_chat_messages: [msg(), msg({ id: "33333333-0000-4000-8000-000000000001", conversation_id: "22222222-0000-4000-8000-000000000009" })] });
    const r = await listShadowCandidates(entries, { limit: 5, tickIntervalSeconds: 60, nowMs: now, db: f.db, signal: ac.signal });
    expect(r.ok && r.candidates.map((c) => c.surface)).toEqual(["airbnb", "whatsapp"]);
    expect(r.ok && r.candidates[0]).toMatchObject({ conversationId: CONV, propertyId: P_ID, tenantId: T_ID, messageId: MSG });
    expect(f.calls[0]!.filters).toContainEqual(["in", "property_id", [P_ID]]);
    expect(f.calls[0]!.limit).toBe(5);
    expect(f.calls.every((c) => c.signal === ac.signal)).toBe(true);
    expect(f.calls.map((c) => (c.select ?? "").replace(/\s/g, ""))).toEqual(["id,property_id,guest_session_id,last_message_at", "id,conversation_id,created_at", "id,conversation_id,created_at"]);
    expect(f.writes).toEqual([]);
  });
  it("guia (sem prefixo) ⇒ guide_chat; conversa sem mensagem de hóspede é ignorada", async () => {
    const f = fakeDb({ property_chat_conversations: [conv({ guest_session_id: "sess-1" })], property_chat_messages: [msg()] });
    const r = await listShadowCandidates(entries, { limit: 5, tickIntervalSeconds: 60, nowMs: now, db: f.db });
    expect(r.ok && r.candidates[0]!.surface).toBe("guide_chat");
    const f2 = fakeDb({ property_chat_conversations: [conv()], property_chat_messages: [] });
    expect(await listShadowCandidates(entries, { limit: 5, tickIntervalSeconds: 60, nowMs: now, db: f2.db })).toEqual({ ok: true, candidates: [] });
  });
  it("entradas/limites inválidos, erro de leitura ou formato ⇒ falha (nada executa)", async () => {
    const f = fakeDb({ property_chat_conversations: [conv()], property_chat_messages: [msg()] });
    expect(await listShadowCandidates([], { limit: 5, tickIntervalSeconds: 60, nowMs: now, db: f.db })).toEqual({ ok: false, integrity: false });
    expect(await listShadowCandidates(entries, { limit: 0, tickIntervalSeconds: 60, nowMs: now, db: f.db })).toEqual({ ok: false, integrity: false });
    expect(await listShadowCandidates(entries, { limit: 5, tickIntervalSeconds: 60, nowMs: Number.NaN, db: f.db })).toEqual({ ok: false, integrity: false });
    expect(await listShadowCandidates(entries, { limit: 5, tickIntervalSeconds: 60, nowMs: now, db: fakeDb({}, { fail: { property_chat_conversations: true } }).db })).toEqual({ ok: false, integrity: false });
    expect(await listShadowCandidates(entries, { limit: 5, tickIntervalSeconds: 60, nowMs: now, db: fakeDb({ property_chat_conversations: [conv()] }, { fail: { property_chat_messages: true } }).db })).toEqual({ ok: false, integrity: false });
    expect(await listShadowCandidates(entries, { limit: 5, tickIntervalSeconds: 60, nowMs: now, db: fakeDb({ property_chat_conversations: [conv({ id: "x" })] }).db })).toEqual({ ok: false, integrity: false });
    expect(await listShadowCandidates(entries, { limit: 5, tickIntervalSeconds: 60, nowMs: now, db: fakeDb({ property_chat_conversations: [conv({ guest_session_id: null })] }).db })).toEqual({ ok: false, integrity: false });
    expect(await listShadowCandidates(entries, { limit: 5, tickIntervalSeconds: 60, nowMs: now, db: fakeDb({}, { throwOn: ["property_chat_conversations"] }).db })).toEqual({ ok: false, integrity: false });
  });
  it("linha de imóvel fora do manifesto ou mensagem de outra conversa ⇒ integridade", async () => {
    const wrongProp = { from: () => ({ select: () => ({ in: () => ({ gte: () => ({ order: () => ({ limit: async () => ({ data: [conv({ property_id: OTHER_P })], error: null }) }) }) }) }) }) };
    expect(await listShadowCandidates(entries, { limit: 5, tickIntervalSeconds: 60, nowMs: now, db: wrongProp as never })).toEqual({ ok: false, integrity: true });
    const f = fakeDb({ property_chat_conversations: [conv()], property_chat_messages: [msg({ id: "x" })] });
    expect(await listShadowCandidates(entries, { limit: 5, tickIntervalSeconds: 60, nowMs: now, db: f.db })).toEqual({ ok: false, integrity: true });
  });
  it("sem `db` usa o cliente administrativo", async () => {
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeDb({}).db }));
    expect(await listShadowCandidates(entries, { limit: 5, tickIntervalSeconds: 60, nowMs: now })).toEqual({ ok: true, candidates: [] });
    vi.doUnmock("@/integrations/supabase/client.server");
  });
});
