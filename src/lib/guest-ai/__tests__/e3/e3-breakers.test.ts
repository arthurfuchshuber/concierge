/**
 * B3.3 · E3 — Fase 6: PRAZO E DISJUNTORES sob concorrência real, PostgreSQL 17.6.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runShadowWorker } from "@/lib/guest-ai/shadow-exec/worker.server";
import { SHADOW_DEADLINE_MS, SHADOW_PROCESSING_BUDGET_MS } from "@/lib/guest-ai/shadow-exec/contracts";
import { buildExecutionRecord, validateExecutionRecord, NO_GATEWAY } from "@/lib/guest-ai/shadow-exec/extract";
import { recordToRow } from "@/lib/guest-ai/data/shadow-store.server";
import type { ProviderOutcome } from "@/lib/guest-ai/llm/providers/types";
import {
  PG176_AVAILABLE, startE3Db, controller, worldIo, convSpec, candidateOf, simProvider, shadowToRunning, shadowState, seedConversation, leaseRow, executions,
  automaticTrips, budgetTotals, budgetLedgerConsistent, rpcAsSr, recordResult, summarizeCalls, ACTOR, type E3Db, type ConvSpec,
} from "./harness";

let db: E3Db;
const conv = (over: Partial<ConvSpec> = {}) => seedConversation(db, convSpec(over));
const tech: ProviderOutcome = { kind: "error", error: { code: "auth", retryable: false, httpStatus: 401 }, usage: null, requestId: null };
const failing = (latencyMs = 50) => simProvider({ latencyMs, outcome: () => tech });

/** Execução avaliável (ok ou falha técnica) gravada pelo RPC real, com instante dado (padrão: agora). */
async function seedRecord(s: ConvSpec, kind: "ok" | "fail", finishedAt = new Date().toISOString()) {
  const r = validateExecutionRecord(
    buildExecutionRecord(
      null,
      {
        executionId: crypto.randomUUID(), tenantId: s.tenant, propertyId: s.property, conversationId: s.conv, channel: "web", batchId: null, leaseVersion: null, modelId: "openai/gpt-5.6-sol",
        startedAt: finishedAt, finishedAt, totalMs: 10, leaseMs: 1, contextMs: 1, gatewayMs: 1, validationMs: 1, gateway: NO_GATEWAY, estimatedInputTokens: null, pauseState: "inactive",
        executionState: kind === "ok" ? "completed" : "failed", technicalCode: kind === "ok" ? null : "read_failed", blockCode: null, integrityCode: null, budgetExceeded: null,
        tokenLimitViolation: false, concurrencyDetected: false, forcedDecision: kind === "ok" ? "operational_restriction" : "technical_failure",
      },
      "chain.2026-11-03.3",
    ),
  );
  return rpcAsSr(db, "shadow_record_execution", { p_record: recordToRow(r!) });
}

describe.skipIf(!PG176_AVAILABLE)("E3 · Fase 6 — prazo e disjuntores (PostgreSQL 17.6 real)", () => {
  beforeAll(() => {
    db = startE3Db();
  }, 60_000);
  afterAll(() => db?.stop());

  // E3.1: 7 = ⌊US$ 1,00 / US$ 0,13072⌋ — o máximo de reservas de pior caso simultâneas que cabem no teto diário
  it("7 workers concorrentes com falha técnica (amostra pequena): o disjuntor desarma UMA vez; nenhuma chamada nova depois do desarme", async () => {
    const specs = await Promise.all(Array.from({ length: 7 }, () => conv()));
    await shadowToRunning(db, specs);
    const provider = failing(200);
    const outs = await Promise.all(specs.map((s) => runShadowWorker(candidateOf(s), worldIo(specs, { db, ctl: controller(), provider }))));
    const trips = await automaticTrips(db);
    const b = await budgetTotals(db);
    const ex = await executions(db);
    recordResult("breaker-concurrent-failures", { trips, gateway: provider.calls, reservations: b.reservations, decisions: outs.map((o) => (o.status === "skipped" ? o.code : o.decision)) });
    expect(trips).toEqual([{ from_state: "running", to_state: "circuit_open", reason_code: "consecutive_failures" }]);
    expect((await shadowState(db)).state).toBe("circuit_open");
    // toda chamada ao Gateway tem reserva; nenhuma reserva foi concedida depois do desarme (o banco recusa fora de running)
    expect(provider.calls).toBe(b.reservations.settled + b.reservations.open);
    expect(ex.filter((e) => e.decision === "technical_failure").length).toBeGreaterThanOrEqual(2);
    expect(await budgetLedgerConsistent(db)).toBe(true);
  }, 120_000);

  it("taxa exatamente 5 % não desarma; acima de 5 % desarma (duas falhas concorrentes sobre 19 sucessos ⇒ um único desarme)", async () => {
    const specs = await Promise.all(Array.from({ length: 21 }, () => conv()));
    await shadowToRunning(db, specs, { p_error_min_sample: 20 });
    for (const s of specs.slice(0, 19)) expect((await seedRecord(s, "ok")).result).toBe("recorded");
    const provider = failing(100);
    await Promise.all(specs.slice(19).map((s) => runShadowWorker(candidateOf(s), worldIo(specs, { db, ctl: controller(), provider }))));
    const trips = await automaticTrips(db);
    const [w] = await db.rows<{ n: number; e: number }>(`select count(*) filter (where evaluable)::int n, count(*) filter (where technical_error)::int e from public.guest_ai_shadow_executions`);
    recordResult("breaker-five-percent", { trips, window: w });
    expect(w).toEqual({ n: 21, e: 2 });
    expect(trips).toEqual([{ from_state: "running", to_state: "circuit_open", reason_code: "error_rate_exceeded" }]);
  }, 120_000);

  it("exatamente 1 falha em 20 avaliáveis (5,0 %) ⇒ continua running", async () => {
    const specs = await Promise.all(Array.from({ length: 20 }, () => conv()));
    await shadowToRunning(db, specs, { p_error_min_sample: 20 });
    for (const s of specs.slice(0, 19)) await seedRecord(s, "ok");
    await runShadowWorker(candidateOf(specs[19]!), worldIo(specs, { db, ctl: controller(), provider: failing() }));
    expect(await automaticTrips(db)).toEqual([]);
    expect((await shadowState(db)).state).toBe("running");
  }, 60_000);

  it("bloqueios legítimos não entram no denominador (20 pausas + 2 falhas = amostra pequena ⇒ consecutivas)", async () => {
    const specs = await Promise.all(Array.from({ length: 22 }, () => conv()));
    await shadowToRunning(db, specs, { p_error_min_sample: 20 });
    for (const s of specs.slice(0, 20)) s.human.pause = { ...s.human.pause, column: { ai_paused: true, paused_until: null } };
    await Promise.all(specs.slice(0, 20).map((s) => runShadowWorker(candidateOf(s), worldIo(specs, { db, ctl: controller(), provider: simProvider() }))));
    for (const s of specs.slice(20)) await runShadowWorker(candidateOf(s), worldIo(specs, { db, ctl: controller(), provider: failing() }));
    expect(await automaticTrips(db)).toEqual([{ from_state: "running", to_state: "circuit_open", reason_code: "consecutive_failures" }]);
  }, 120_000);

  it("violação de integridade num worker ⇒ desarme global imediato; os concorrentes não iniciam chamadas novas", async () => {
    const specs = await Promise.all(Array.from({ length: 10 }, () => conv()));
    specs[0]!.human.ownership = "tenant_mismatch";
    await shadowToRunning(db, specs);
    const provider = simProvider({ latencyMs: 150 });
    const first = runShadowWorker(candidateOf(specs[0]!), worldIo(specs, { db, ctl: controller(), provider }));
    await first;
    const others = await Promise.all(specs.slice(1).map((s) => runShadowWorker(candidateOf(s), worldIo(specs, { db, ctl: controller(), provider }))));
    recordResult("breaker-integrity", { state: (await shadowState(db)).state, trips: await automaticTrips(db), gateway: provider.calls, others });
    expect((await shadowState(db)).state).toBe("integrity_violation");
    expect(provider.calls).toBe(0);
    expect(others.every((o) => o.status === "skipped" && o.code === "state_not_running")).toBe(true);
  }, 60_000);

  it("integridade DURANTE chamadas em andamento: quem já chamou descarta (aborted_by_shutdown); quem não chamou não chama", async () => {
    const specs = await Promise.all(Array.from({ length: 6 }, () => conv()));
    await shadowToRunning(db, specs);
    let tripped = false;
    const provider = simProvider({
      latencyMs: 300,
      during: async (n) => {
        if (n === 1 && !tripped) {
          tripped = true;
          await rpcAsSr(db, "shadow_trip", { p_to: "integrity_violation", p_reason: "integrity_divergence" });
        }
      },
    });
    const outs = await Promise.all(specs.map((s) => runShadowWorker(candidateOf(s), worldIo(specs, { db, ctl: controller(), provider }))));
    const ex = await executions(db);
    recordResult("breaker-integrity-inflight", { outs, gateway: provider.calls, decisions: ex.map((e) => e.decision) });
    expect(ex.filter((e) => e.decision === "answer_candidate")).toEqual([]);
    // todo resultado foi descartado; quem chegou à reserva depois do desarme nem chamou (o banco recusou)
    expect(ex.every((e) => e.decision === "aborted_by_shutdown")).toBe(true);
    expect(ex.reduce((n, e) => n + e.gateway_calls, 0)).toBe(provider.calls);
    expect(provider.calls).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it("divergência de tenant (manifesto × candidata) e de imóvel/conversa (escopo) ⇒ desarme imediato", async () => {
    for (const kind of ["tenant", "scope"] as const) {
      const s = await conv();
      await shadowToRunning(db, [s]);
      const cand = kind === "tenant" ? { ...candidateOf(s), tenantId: "7a000000-0000-4000-8000-00000000dead" } : candidateOf(s);
      const w = worldIo([s], { db, ctl: controller(), provider: simProvider(), hooks: kind === "scope" ? { at: (p) => { if (p === "scope") throw Object.assign(new Error("x"), { code: "property_unresolved" }); } } : undefined });
      const out = await runShadowWorker(cand, w);
      expect(out).toEqual({ status: "recorded", decision: "integrity_violation" });
      expect((await shadowState(db)).state).toBe("integrity_violation");
    }
  }, 60_000);

  it("sem religamento indevido: nenhum caminho automático sai de estado de falha; recuperação exige autor + evidência e passa por ready", async () => {
    const s = await conv();
    await shadowToRunning(db, [s]);
    await rpcAsSr(db, "shadow_trip", { p_to: "circuit_open", p_reason: "error_rate_exceeded" });
    let st = await shadowState(db);
    expect(st.state).toBe("circuit_open");
    // o worker não religa (e não tem acesso às RPCs administrativas)
    expect(await runShadowWorker(candidateOf(s), worldIo([s], { db, ctl: controller(), provider: simProvider() }))).toEqual({ status: "skipped", code: "state_not_running" });
    // disparo automático para running é recusado; transição direta para running é recusada
    expect((await rpcAsSr(db, "shadow_trip", { p_to: "running", p_reason: "error_rate_exceeded" })).result).toBe("invalid_argument");
    expect((await rpcAsSr(db, "shadow_transition", { p_expected_version: st.version, p_to: "running", p_actor: ACTOR, p_reason: "authorized_resume" })).result).toBe("invalid_transition");
    // ready sem evidência é recusado; com evidência, aceito; só depois running
    expect((await rpcAsSr(db, "shadow_transition", { p_expected_version: st.version, p_to: "ready", p_actor: ACTOR, p_reason: "authorized_recovery" })).result).toBe("invalid_transition");
    const r = await rpcAsSr(db, "shadow_transition", { p_expected_version: st.version, p_to: "ready", p_actor: ACTOR, p_reason: "authorized_recovery", p_evidence_sha256: "f".repeat(64) });
    expect(r.result).toBe("applied");
    st = await shadowState(db);
    expect(st.state).toBe("ready");
  }, 60_000);

  it("CRÍTICO · F-03: janela do disjuntor não depende do relógio do worker: falhas com `finished_at` 2 h atrasado ainda desarmam (janela e ordem por `recorded_at`, relógio do banco)", async () => {
    const specs = await Promise.all(Array.from({ length: 3 }, () => conv()));
    await shadowToRunning(db, specs, { p_error_min_sample: 20, p_error_window_minutes: 60 });
    // registro com o instante do worker 2 h atrasado (relógio da máquina errado) — conta na janela do banco
    expect((await seedRecord(specs[0]!, "fail", new Date(Date.now() - 2 * 3600_000).toISOString())).breaker).toBe("ok");
    // e o worker real, com Date.now da máquina 2 h atrasado: o instante gravado vem do banco
    const realNow = Date.now.bind(Date);
    const spy = vi.spyOn(Date, "now").mockImplementation(() => realNow() - 2 * 3600_000);
    try {
      await runShadowWorker(candidateOf(specs[1]!), worldIo(specs, { db, ctl: controller(), provider: failing() }));
    } finally {
      spy.mockRestore();
    }
    const ex = await executions(db);
    const [w] = await db.rows<{ worker_fin_age_s: number }>(`select extract(epoch from now() - finished_at)::int worker_fin_age_s from public.guest_ai_shadow_executions where conversation_id = '${specs[1]!.conv}'`);
    recordResult("breaker-clock-skew", { technicalFailures: ex.filter((e) => e.decision === "technical_failure").length, trips: await automaticTrips(db), state: (await shadowState(db)).state, workerFinishedAgeSeconds: w });
    expect(ex.filter((e) => e.decision === "technical_failure").length).toBe(2);
    expect(Math.abs(w!.worker_fin_age_s)).toBeLessThan(60); // instante do worker = relógio do banco, não o da máquina
    expect(await automaticTrips(db)).toEqual([{ from_state: "running", to_state: "circuit_open", reason_code: "consecutive_failures" }]);
  }, 60_000);

  it("prazo REAL: Gateway lento (14 s) ⇒ o processamento é cortado em 13,5 s; finalização dentro de 1,5 s; registro timed_out; lease em fail; total < 15 s", async () => {
    const s = await conv();
    await shadowToRunning(db, [s]);
    const provider = simProvider({ latencyMs: 14_000 });
    const ctl = controller();
    const t0 = performance.now();
    const out = await runShadowWorker(candidateOf(s), worldIo([s], { db, ctl, provider }));
    const total = performance.now() - t0;
    const ex = (await executions(db, s.conv))[0];
    const l = await leaseRow(db, s.conv);
    recordResult("deadline-real", { out, totalMs: Math.round(total), execution: ex, lease: l?.state, calls: summarizeCalls(ctl) });
    expect(out).toEqual({ status: "recorded", decision: "technical_failure" });
    expect(ex).toMatchObject({ execution_state: "timed_out", technical_code: "shadow_timeout" });
    expect(l!.state).toBe("failed");
    expect(total).toBeGreaterThanOrEqual(SHADOW_PROCESSING_BUDGET_MS - 50);
    expect(total).toBeLessThan(SHADOW_DEADLINE_MS);
    expect(await budgetLedgerConsistent(db)).toBe(true);
  }, 30_000);

  it("cancelamento alcança as operações dependentes do lease: depois do prazo de processamento, nenhuma RPC com o sinal de processamento sai; RPC travada é interrompida", async () => {
    const s = await conv();
    await shadowToRunning(db, [s]);
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const schedule = (fn: () => void, ms: number) => (timers.push({ fn, ms }), () => undefined);
    // a reivindicação (`shadow_claim_execution`, que também inicia) trava; o prazo de processamento vence durante ela
    const ctl = controller({
      faults: [{ fn: "shadow_claim_execution", mode: "hang" }],
      before: (fn) => { if (fn === "shadow_claim_execution") setTimeout(() => timers.find((t) => t.ms === SHADOW_PROCESSING_BUDGET_MS)!.fn(), 30); },
    });
    const provider = simProvider();
    const out = await runShadowWorker(candidateOf(s), worldIo([s], { db, ctl, provider, schedule }));
    const calls = summarizeCalls(ctl);
    recordResult("deadline-cancellation", { out, calls });
    expect(provider.calls).toBe(0);
    expect(calls).toContain("shadow_claim_execution=error:aborted");
    // abortada ⇒ sem repetição; depois do corte nenhuma RPC de processamento (reserva) chegou ao banco
    expect(ctl.calls.filter((c) => c.fn === "shadow_claim_execution")).toHaveLength(1);
    expect(ctl.calls.filter((c) => c.fn === "shadow_reserve_budget")).toEqual([]);
    expect(out).toEqual({ status: "skipped", code: "lease_concurrency" });
    expect((await leaseRow(db, s.conv))!.state).toBe("ready");
  }, 60_000);

  it("CRÍTICO · F-02: finalização que estoura 1,5 s ⇒ fail-closed: nada é confirmado pela metade; a execução fica EM ANDAMENTO no banco e a reconciliação a encerra (registro worker_lost, lote selado, reserva pelo pior caso)", async () => {
    const s = await conv();
    await shadowToRunning(db, [s]);
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const schedule = (fn: () => void, ms: number) => (timers.push({ fn, ms }), () => undefined);
    // o prazo ABSOLUTO vence imediatamente antes da finalização atômica (banco lento)
    const ctl = controller({ before: (fn) => { if (fn === "shadow_finalize_execution") timers.find((t) => t.ms === SHADOW_DEADLINE_MS)!.fn(); } });
    const provider = simProvider();
    const out = await runShadowWorker(candidateOf(s), worldIo([s], { db, ctl, provider, schedule }));
    const before = { ex: (await executions(db, s.conv)).length, lease: await leaseRow(db, s.conv), budget: await budgetTotals(db), trips: await automaticTrips(db) };
    expect(out).toEqual({ status: "record_failed", decision: "answer_candidate" });
    // nada pela metade: sem registro, lease ainda em processamento, reserva aberta, nenhum disjuntor por isso (F-12)
    expect(before.ex).toBe(0);
    expect(before.lease!.state).toBe("processing");
    expect(before.budget.reservations).toMatchObject({ open: 1, settled: 0 });
    expect(before.trips).toEqual([]);
    // o lease vence (relógio do banco) e o próximo tick reconcilia
    await db.sql(`update public.guest_ai_conversation_leases set lease_expires_at = now() - interval '1 second' where conversation_id = '${s.conv}'`);
    expect(await rpcAsSr(db, "shadow_reconcile", { p_tick_token: db.tick })).toMatchObject({ result: "ok", reconciled: 1 });
    const ex = await executions(db, s.conv);
    const l = await leaseRow(db, s.conv);
    const b = await budgetTotals(db);
    const [res] = await db.rows<{ kind: string; cost: string }>(`select settlement_kind kind, settled_cost::text cost from public.guest_ai_shadow_budget_reservations`);
    recordResult("deadline-finalization-overrun", { out, before, after: { executions: ex, lease: l, budget: b, reservation: res }, calls: summarizeCalls(ctl) });
    expect(ex).toHaveLength(1);
    expect(ex[0]).toMatchObject({ decision: "technical_failure", technical_code: "worker_lost" });
    expect(l).toMatchObject({ state: "failed", message_ids: [] });
    expect(l!.processed).toContain(s.msg);
    expect(res).toEqual({ kind: "orphan_worst_case", cost: "0.13072000" });
    expect(b.reservations).toMatchObject({ open: 0, settled: 1 });
    expect(await budgetLedgerConsistent(db)).toBe(true);
    expect(provider.calls).toBe(1);
  }, 60_000);
});
