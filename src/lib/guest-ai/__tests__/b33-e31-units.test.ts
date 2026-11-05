/**
 * B3.3 · ENTREGA 3.1 — testes unitários das correções (sem banco, sem rede): aritmética monetária exata,
 * limite superior de entrada, liquidação do gerador (uso informado × desconhecido × sem chamada),
 * adaptador das novas RPCs (lista branca de respostas) e a rechecagem de soberania humana (F-06).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { costUnits, parseUsd8, toDecimal8, unitsPerToken, USD8_DECIMAL_RE, ZERO_USD8 } from "@/lib/guest-ai/shadow-exec/money";
import { createShadowGatewayGenerator, inputTokenBound, issueShadowPreflight, INPUT_FRAME_TOKENS_BASE, INPUT_FRAME_TOKENS_PER_MESSAGE } from "@/lib/guest-ai/shadow-exec/gateway-generator.server";
import { ShadowDeadline } from "@/lib/guest-ai/shadow-exec/deadline";
import { validateShadowControl } from "@/lib/guest-ai/shadow-exec/breakers";
import { createShadowStore } from "@/lib/guest-ai/data/shadow-store.server";
import { runShadowWorker } from "@/lib/guest-ai/shadow-exec/worker.server";
import { buildExecutionRecord, NO_GATEWAY } from "@/lib/guest-ai/shadow-exec/extract";
import type { ShadowExecutionRecord } from "@/lib/guest-ai/shadow-exec/contracts";
import { v4 } from "./helpers/b23-chain";
import { ownershipRow } from "./helpers/b25-fixtures";
import { CANARY, CONV, EXEC_ID, MemoryShadowStore, P_ID, T_ID, benignPause, candidate, fakeProvider, fullControl, makeIo, okJson } from "./helpers/b33-shadow";

const limits = () => {
  const v = validateShadowControl(fullControl());
  if (!v.ok) throw new Error("fixture");
  return v.limits;
};

describe("E3.1 · aritmética monetária exata (money.ts)", () => {
  it("preço por token em unidades inteiras de 1e-8; fração não representável ⇒ null (nunca arredonda dinheiro)", () => {
    expect(unitsPerToken(1.25)).toBe(125n);
    expect(unitsPerToken(10)).toBe(1000n);
    expect(unitsPerToken(0)).toBe(0n);
    for (const bad of [1.255, -1, Number.NaN, Number.POSITIVE_INFINITY, "1" as never, 1e300]) expect(unitsPerToken(bad), String(bad)).toBeNull();
  });
  it("custo de um uso: inteiro exato; tokens inválidos ou preço inválido ⇒ null", () => {
    expect(costUnits({ input: 1.25, output: 10 }, 900, 120)).toBe(232_500n);
    expect(costUnits({ input: 1.25, output: 10 }, 40_000, 1_536)).toBe(6_536_000n);
    expect(costUnits({ input: 1.255, output: 10 }, 1, 1)).toBeNull();
    expect(costUnits({ input: 1.25, output: -1 }, 1, 1)).toBeNull();
    for (const [i, o] of [[1.5, 1], [1, -1], [Number.NaN, 0], [2 ** 60, 0]]) expect(costUnits({ input: 1.25, output: 10 }, i!, o!), `${i}/${o}`).toBeNull();
  });
  it("decimal ⇄ unidades sem perda; formatos inválidos recusados", () => {
    expect(parseUsd8("0.13072000")).toBe(13_072_000n);
    expect(parseUsd8("1")).toBe(100_000_000n);
    expect(parseUsd8("0.5")).toBe(50_000_000n);
    expect(parseUsd8(0.15)).toBe(15_000_000n);
    expect(parseUsd8(0)).toBe(0n);
    for (const bad of ["-0.1", "0.123456789", "1e-3", "", "abc", "1234567.0", null, undefined, {}, -1, 0.123456789, Number.NaN]) expect(parseUsd8(bad), String(bad)).toBeNull();
    expect(toDecimal8(13_072_000n)).toBe("0.13072000");
    expect(toDecimal8(0n)).toBe(ZERO_USD8);
    expect(toDecimal8(123_400_000_005n)).toBe("1234.00000005");
    expect(() => toDecimal8(-1n)).toThrow(RangeError);
    for (const u of [0n, 1n, 13_072_000n, 99_999_999n, 100_000_000n]) expect(parseUsd8(toDecimal8(u))).toBe(u);
    expect(USD8_DECIMAL_RE.test("0.00232500")).toBe(true);
    expect(USD8_DECIMAL_RE.test("0.002325")).toBe(false);
  });
});

describe("E3.1 · limite superior de entrada (F-04)", () => {
  it("bytes UTF-8 + moldura; multibyte conta por byte; prompt ilegível ⇒ 0 (bloqueia)", () => {
    const frame = INPUT_FRAME_TOKENS_BASE + INPUT_FRAME_TOKENS_PER_MESSAGE * 2;
    expect(inputTokenBound({ system: "abc", messages: [{ role: "user", content: "de" }] } as never)).toBe(5 + frame);
    expect(inputTokenBound({ system: "ção", messages: [{ role: "user", content: "😀" }] } as never)).toBe(5 + 4 + frame);
    for (const bad of [null, {}, { system: 1, messages: [] }, { system: "s", messages: null }, { system: "s", messages: [{ role: "user", content: 7 }] }, { system: "s", messages: [null] }]) expect(inputTokenBound(bad as never), JSON.stringify(bad)).toBe(0);
  });
});

describe("E3.1 · liquidação do gerador (uso informado × desconhecido × sem chamada)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchSpy = vi.fn(() => { throw new Error("rede proibida"); });
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => vi.unstubAllGlobals());
  const pf = () => issueShadowPreflight({ executionId: EXEC_ID, tenantId: T_ID, propertyId: P_ID, conversationId: CONV, stateVersion: 7, manifestOk: true, integrityOk: true, pauseInactive: true, ownershipOk: true })!;
  const prompt = { system: "s", messages: [{ role: "user" as const, content: "u" }], sourceIds: new Set(["x"]) } as never;
  const gen = (provider: ReturnType<typeof fakeProvider>, store = new MemoryShadowStore()) => {
    store.inflight.set(EXEC_ID, { conversationId: CONV, version: 2, batchId: "b0000000-0000-4000-8000-000000000001", status: "running" });
    return createShadowGatewayGenerator({ preflight: pf(), limits: limits(), deadline: new ShadowDeadline({ now: () => 0, schedule: () => () => undefined }), store, provider, masterSwitchOn: () => true })!;
  };
  it("uso informado ⇒ custo EXATO pelo uso (900 × 125 + 120 × 1.000 = 0,00232500)", async () => {
    const g = gen(fakeProvider(okJson({ ok: true })));
    await g.generate(prompt, new AbortController().signal);
    expect(g.telemetry()).toMatchObject({ calls: 1, totalTokens: 1020, costUsd: "0.00232500", usageSource: "provider" });
  });
  it("chamada feita com uso DESCONHECIDO ⇒ liquida o pior caso reservado (nunca menos); uso fracionário também", async () => {
    const g = gen(fakeProvider({ kind: "error", error: { code: "auth", retryable: false, httpStatus: 401 }, usage: null, requestId: null }));
    await expect(g.generate(prompt, new AbortController().signal)).rejects.toMatchObject({ code: "gateway_failed" });
    expect(g.telemetry()).toMatchObject({ calls: 1, totalTokens: 83_072, costUsd: "0.13072000", usageSource: "none" });
    const g2 = gen(fakeProvider(okJson({ ok: true }, { inputTokens: 1.5, outputTokens: 1, totalTokens: 2.5 })));
    await g2.generate(prompt, new AbortController().signal).catch(() => null);
    expect(g2.telemetry()).toMatchObject({ costUsd: "0.13072000", totalTokens: 83_072, usageSource: "none" });
  });
  it("reserva sem resposta: UMA repetição idempotente; sinal abortado ⇒ sem repetição", async () => {
    const store = new MemoryShadowStore();
    const real = store.reserve.bind(store);
    let n = 0;
    store.reserve = async (id, r) => (++n === 1 ? { kind: "error" } : real(id, r));
    const g = gen(fakeProvider(okJson({ ok: true })), store);
    await g.generate(prompt, new AbortController().signal);
    expect(n).toBe(2);
    expect(g.telemetry().status).toBe("called");
    const s2 = new MemoryShadowStore();
    let m = 0;
    s2.reserve = async () => (++m, { kind: "error" });
    const ac = new AbortController();
    const g2 = gen(fakeProvider(okJson({ ok: true })), s2);
    const p = g2.generate(prompt, ac.signal).catch((e) => e);
    ac.abort();
    expect(await p).toMatchObject({ code: expect.any(String) });
    expect(m).toBeLessThanOrEqual(1);
  });
});

describe("E3.1 · adaptador das novas RPCs (respostas por lista branca)", () => {
  const TOKEN = "a".repeat(64);
  const BATCH = "b0000000-0000-4000-8000-000000000001";
  const M = "a3000000-0000-4000-8000-000000000001";
  const store = (replies: Record<string, unknown>) =>
    createShadowStore({ call: vi.fn(async (fn: string) => (fn in replies ? (replies[fn] instanceof Error ? Promise.reject(replies[fn]) : { data: replies[fn], error: null }) : { data: null, error: { code: "x" } })) } as never);
  const rec = buildExecutionRecord(null, { executionId: EXEC_ID, tenantId: T_ID, propertyId: P_ID, conversationId: CONV, channel: "web", batchId: BATCH, leaseVersion: 2, modelId: null, startedAt: "2026-11-03T10:00:00.000Z", finishedAt: "2026-11-03T10:00:00.000Z", totalMs: 0, leaseMs: 0, contextMs: 0, gatewayMs: 0, validationMs: 0, gateway: NO_GATEWAY, estimatedInputTokens: null, pauseState: "inactive", executionState: "failed", technicalCode: "lease_integrity_failure", blockCode: null, integrityCode: null, budgetExceeded: null, tokenLimitViolation: false, concurrencyDetected: false, forcedDecision: "technical_failure" }, "chain.x") as ShadowExecutionRecord;
  const fin = { executionId: EXEC_ID, ownerToken: TOKEN, outcome: "complete" as const, settlement: { tokens: 0, costUsd: ZERO_USD8, calls: 0 }, record: rec, fencedRecord: rec };
  it("trava do tick", async () => {
    const ok = { result: "acquired", tick_token: TOKEN, db_now: "2026-11-04T12:00:00.000000Z", tick_expires_at: "2026-11-04T12:00:55.000000Z" };
    expect(await store({ shadow_acquire_tick: ok }).acquireTick()).toEqual({ kind: "acquired", token: TOKEN, dbNowMs: Date.parse("2026-11-04T12:00:00Z"), expiresMs: Date.parse("2026-11-04T12:00:55Z") });
    for (const bad of [{ ...ok, tick_token: "x" }, { ...ok, db_now: null }, { ...ok, tick_expires_at: "2026-11-04T11:00:00Z" }, { ...ok, tick_expires_at: 5 }]) expect(await store({ shadow_acquire_tick: bad }).acquireTick(), JSON.stringify(bad)).toEqual({ kind: "error" });
    expect(await store({ shadow_acquire_tick: { result: "busy" } }).acquireTick()).toEqual({ kind: "busy" });
    expect(await store({ shadow_acquire_tick: { result: "state_not_running" } }).acquireTick()).toEqual({ kind: "blocked", code: "state_not_running" });
    expect(await store({ shadow_acquire_tick: { result: "config_incomplete" } }).acquireTick()).toEqual({ kind: "blocked", code: "config_incomplete" });
    expect(await store({ shadow_acquire_tick: { result: CANARY } }).acquireTick()).toEqual({ kind: "error" });
    expect(await store({}).acquireTick()).toEqual({ kind: "error" });
    expect(await store({ shadow_release_tick: { result: "released" } }).releaseTick(TOKEN)).toBe("released");
    expect(await store({ shadow_release_tick: { result: "noop" } }).releaseTick(TOKEN)).toBe("noop");
    expect(await store({ shadow_release_tick: { result: CANARY } }).releaseTick(TOKEN)).toBe("error");
  });
  it("reivindicação", async () => {
    const args = { tickToken: TOKEN, executionId: EXEC_ID, conversationId: CONV, expectedVersion: 2, tenantId: T_ID, propertyId: P_ID, channel: "web" as const };
    const ok = { result: "claimed", version: 3, owner_token: TOKEN, batch_id: BATCH, message_ids: [M] };
    expect(await store({ shadow_claim_execution: ok }).claimExecution(args)).toEqual({ kind: "claimed", version: 3, ownerToken: TOKEN, batchId: BATCH, messageIds: [M], repeated: false });
    expect(await store({ shadow_claim_execution: { ...ok, repeated: true } }).claimExecution(args)).toMatchObject({ kind: "claimed", repeated: true });
    for (const bad of [{ ...ok, version: 1.5 }, { ...ok, owner_token: "x" }, { ...ok, batch_id: "x" }, { ...ok, message_ids: [] }, { ...ok, message_ids: ["x"] }, { ...ok, message_ids: "x" }]) expect(await store({ shadow_claim_execution: bad }).claimExecution(args), JSON.stringify(bad)).toEqual({ kind: "error" });
    for (const code of ["state_not_running", "tick_not_held", "not_in_manifest", "not_found", "stale_version", "not_claimable", "attempts_exhausted", "conflict", "duplicate", "invalid_argument", "property_disabled"]) expect(await store({ shadow_claim_execution: { result: code } }).claimExecution(args)).toEqual({ kind: "rejected", code });
    expect(await store({ shadow_claim_execution: { result: CANARY } }).claimExecution(args)).toEqual({ kind: "error" });
    expect(await store({}).claimExecution(args)).toEqual({ kind: "error" });
  });
  it("finalização", async () => {
    for (const lease of ["completed", "failed", "fenced_expired", "fenced_foreign"]) expect(await store({ shadow_finalize_execution: { result: "finalized", lease, decision: "silence" } }).finalizeExecution(fin)).toEqual({ kind: "finalized", lease, decision: "silence" });
    expect(await store({ shadow_finalize_execution: { result: "finalized", lease: CANARY, decision: "silence" } }).finalizeExecution(fin)).toEqual({ kind: "error" });
    expect(await store({ shadow_finalize_execution: { result: "finalized", lease: "completed", decision: 7 } }).finalizeExecution(fin)).toEqual({ kind: "error" });
    for (const [r, k] of [["duplicate", "duplicate"], ["reconciled", "reconciled"], ["not_claimed", "not_claimed"], ["invalid_argument", "invalid"], [CANARY, "error"]]) expect(await store({ shadow_finalize_execution: { result: r } }).finalizeExecution(fin)).toEqual({ kind: k });
    expect(await store({}).finalizeExecution(fin)).toEqual({ kind: "error" });
    expect(await store({}).finalizeExecution({ ...fin, record: null as never })).toEqual({ kind: "invalid" });
  });
  it("reconciliação", async () => {
    expect(await store({ shadow_reconcile: { result: "ok", reconciled: 2 } }).reconcile(TOKEN)).toEqual({ kind: "ok", reconciled: 2 });
    for (const bad of [{ result: "ok", reconciled: -1 }, { result: "ok", reconciled: 1.5 }, { result: "ok" }, { result: CANARY }]) expect(await store({ shadow_reconcile: bad }).reconcile(TOKEN)).toEqual({ kind: "error" });
    expect(await store({ shadow_reconcile: { result: "tick_not_held" } }).reconcile(TOKEN)).toEqual({ kind: "tick_not_held" });
    expect(await store({}).reconcile(TOKEN)).toEqual({ kind: "error" });
  });
});

describe("E3.1 · F-06 rechecagem de soberania humana antes de persistir o candidato", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchSpy = vi.fn(() => { throw new Error("rede proibida"); });
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => vi.unstubAllGlobals());
  const good = () => okJson(v4({ reply: `O check-in começa às 15h. ${CANARY}`, groundedOn: ["ctx:checkin_oficial"] }));
  /** Leituras 1 e 2 benignas (antes e depois do claim); a 3ª (rechecagem) é a dada. */
  const third = (src: unknown) => {
    let n = 0;
    return async () => (++n >= 3 ? (src instanceof Error ? Promise.reject(src) : (src as never)) : benignPause());
  };
  it("pausa ativa/indeterminada/ilegível na rechecagem ⇒ human_pause_active com o código certo; lote concluído; candidato nunca gravado", async () => {
    const future = new Date(Date.parse("2026-11-03T10:01:00Z") + 3_600_000).toISOString();
    for (const [src, code] of [
      [{ ...benignPause(), column: { ai_paused: true, paused_until: future } }, "pause_active"],
      [{ ...benignPause(), column: { ai_paused: true, paused_until: null } }, "pause_indefinite"],
      [{ ...benignPause(), lookup: "failed" }, "pause_unreadable"],
    ] as const) {
      const provider = fakeProvider(good());
      const { io, store, lease } = makeIo({ provider, loadHumanPauseSource: third(src) });
      expect(await runShadowWorker(candidate(), io)).toEqual({ status: "recorded", decision: "human_pause_active" });
      expect(store.records[0]).toMatchObject({ decision: "human_pause_active", blockCode: code, executionState: "blocked", candidateAvailable: false });
      expect(provider.calls).toBe(1);
      expect(lease.rec?.state).toBe("completed");
      expect(JSON.stringify(store.records)).not.toContain(CANARY);
    }
  });
  it("posse muda entre a leitura pré-Gateway e a rechecagem ⇒ restrição operacional; leitura falha ⇒ falha técnica (lote selado); posse igual ⇒ candidato", async () => {
    let k = 0;
    const changing = makeIo({ provider: fakeProvider(good()), loadOwnership: async () => (++k >= 2 ? { status: "indeterminate" } : { status: "none", row: ownershipRow({ id: CONV }) }) as never });
    expect(await runShadowWorker(candidate(), changing.io)).toEqual({ status: "recorded", decision: "operational_restriction" });
    expect(changing.store.records[0]).toMatchObject({ blockCode: "ownership_indeterminate" });
    let j = 0;
    const failing = makeIo({ provider: fakeProvider(good()), loadOwnership: async () => { if (++j >= 2) throw new Error(CANARY); return { status: "none", row: ownershipRow({ id: CONV }) } as never; } });
    expect(await runShadowWorker(candidate(), failing.io)).toEqual({ status: "recorded", decision: "technical_failure" });
    expect(failing.store.records[0]).toMatchObject({ technicalCode: "read_failed", executionState: "failed" });
    expect(failing.lease.rec?.state).toBe("failed");
    const pauseFails = makeIo({ provider: fakeProvider(good()), loadHumanPauseSource: third(new Error(CANARY)) });
    expect(await runShadowWorker(candidate(), pauseFails.io)).toEqual({ status: "recorded", decision: "technical_failure" });
    const same = makeIo({ provider: fakeProvider(good()) });
    expect(await runShadowWorker(candidate(), same.io)).toEqual({ status: "recorded", decision: "answer_candidate" });
    expect(same.captured.ownershipCalls).toBe(2); // leitura pré-Gateway + rechecagem
  });
  it("decisão que não é candidato (silêncio/intervenção) não precisa de rechecagem; decisão forçada também não", async () => {
    const silence = makeIo({ provider: fakeProvider(okJson(v4({ strategy: "silence", reply: "" }))) });
    const r = await runShadowWorker(candidate(), silence.io);
    expect(r.status).toBe("recorded");
    expect(silence.captured.ownershipCalls).toBe(1);
    const st = new MemoryShadowStore();
    st.control = fullControl({ maxTurnCostUsd: 0.01 });
    const blocked = makeIo({ store: st, provider: fakeProvider(good()) });
    expect(await runShadowWorker(candidate(), blocked.io)).toEqual({ status: "recorded", decision: "budget_blocked" });
    expect(blocked.captured.ownershipCalls).toBe(1);
  });
});

describe("E3.1 · ramos restantes (finalização reconciliada; Gateway sem tentativa)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchSpy = vi.fn(() => { throw new Error("rede proibida"); });
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock("@/lib/guest-ai/llm/gateway.server");
    vi.resetModules();
  });
  it("execução já reconciliada (worker tardio) ⇒ recorded/technical_failure, sem novo registro nem disparo", async () => {
    const store = new MemoryShadowStore();
    store.finalizeExecution = async () => ({ kind: "reconciled" });
    const { io } = makeIo({ store, provider: fakeProvider(okJson(v4({ reply: "O check-in começa às 15h.", groundedOn: ["ctx:checkin_oficial"] }))) });
    expect(await runShadowWorker(candidate(), io)).toEqual({ status: "recorded", decision: "technical_failure" });
    expect(store.records).toEqual([]);
    expect(store.trips).toEqual([]);
  });
  it("Gateway recusa ANTES de qualquer tentativa (attempts = 0) ⇒ liquidação zero (nada foi consumido)", async () => {
    vi.doMock("@/lib/guest-ai/llm/gateway.server", () => ({
      generateGuestLlm: async () => ({ ok: false, error: { code: "config_missing" }, telemetry: { attempts: 0, costUsd: 0, usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0, source: "none" } } }),
    }));
    vi.resetModules();
    const mod = await import("@/lib/guest-ai/shadow-exec/gateway-generator.server");
    const store = new MemoryShadowStore();
    const pf = mod.issueShadowPreflight({ executionId: EXEC_ID, tenantId: T_ID, propertyId: P_ID, conversationId: CONV, stateVersion: 7, manifestOk: true, integrityOk: true, pauseInactive: true, ownershipOk: true })!;
    const g = mod.createShadowGatewayGenerator({ preflight: pf, limits: limits(), deadline: new ShadowDeadline({ now: () => 0, schedule: () => () => undefined }), store, masterSwitchOn: () => true })!;
    await expect(g.generate({ system: "s", messages: [{ role: "user", content: "u" }], sourceIds: new Set(["x"]) } as never, new AbortController().signal)).rejects.toMatchObject({ code: "gateway_failed" });
    expect(g.telemetry()).toMatchObject({ calls: 0, totalTokens: 0, costUsd: "0.00000000", status: "failed" });
  });
});
