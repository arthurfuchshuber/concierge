/**
 * B3.3 · ENTREGA 3.1 (corretiva) — testes ESPECÍFICOS de cada correção contra PostgreSQL 17.6 real
 * (cluster descartável, migrations reais, cada RPC numa conexão própria). Mundo sintético; Gateway só
 * pelo transporte falso; nenhuma rede, nenhum envio, nenhum dado real.
 *
 *  F-07  trava global do tick (um único worker ativo; tempo de tick para a execução inteira)
 *  F-01  cerca da finalização (versão + token + prazo) e tomada atômica pela reconciliação
 *  F-02  finalização numa única transação (nada pela metade)
 *  F-04  reserva órfã × finalização tardia: uma liquidação só
 *  F-05  nenhum reprocessamento sem mensagem nova (inclusive após reconciliação e com lease `expired`)
 *  F-06  rechecagem de soberania humana imediatamente antes de persistir um candidato
 *  F-11/F-12  respostas perdidas depois do commit (reivindicação, finalização) sem duplicar nem desarmar
 *  + combinados (F-01 × F-04 × F-05 × F-06 × F-07 × F-09 × F-11 × F-12) e isolamento multi-tenant
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runShadowWorker } from "@/lib/guest-ai/shadow-exec/worker.server";
import { runShadowTick } from "@/lib/guest-ai/shadow-exec/tick.server";
import {
  PG176_AVAILABLE, startE3Db, controller, worldIo, convSpec, candidateOf, simProvider, shadowToRunning, shadowState, seedConversation, leaseRow, executions,
  automaticTrips, budgetTotals, budgetLedgerConsistent, rpcAsSr, realStores, recordResult, summarizeCalls, synthUuid, type E3Db, type ConvSpec,
} from "./harness";

let db: E3Db;
const conv = (over: Partial<ConvSpec> = {}) => seedConversation(db, convSpec(over));
const expireLease = (c: string) => db.sql(`update public.guest_ai_conversation_leases set lease_expires_at = now() - interval '1 second' where conversation_id = '${c}'`);
const releaseHarnessTick = () => rpcAsSr(db, "shadow_release_tick", { p_tick_token: db.tick });
/** Lote pronto (observe + mark_ready) pelo lease real; devolve a versão. */
async function readyBatch(s: ConvSpec): Promise<number> {
  const L = realStores(db, controller()).leaseFor();
  await L.transition(s.conv, "observe", 0, { messageIds: [s.msg] });
  const mr = await L.transition(s.conv, "mark_ready", 1, { messageIds: [s.msg] });
  return mr.version!;
}
const claimArgs = (s: ConvSpec, version: number, exec = crypto.randomUUID(), tick = db.tick) => ({
  p_tick_token: tick, p_execution_id: exec, p_conversation_id: s.conv, p_expected_version: version, p_tenant_id: s.tenant, p_property_id: s.property, p_channel: "web",
});

describe.skipIf(!PG176_AVAILABLE)("E3.1 · correções (PostgreSQL 17.6 real)", () => {
  beforeAll(() => {
    db = startE3Db();
  }, 60_000);
  afterAll(() => db?.stop());

  it("ambiente: servidor PostgreSQL 17.6", () => {
    expect(db.pg.version).toBe("17.6");
  });

  // ───────────────────────────── F-07 ─────────────────────────────
  it("F-07 · 20 aquisições CONCORRENTES da trava do tick ⇒ exatamente UMA; prazo = 3 × 15 s + 10 s pelo relógio do banco; liberação só pelo dono", async () => {
    const s = await conv();
    await shadowToRunning(db, [s]);
    await releaseHarnessTick();
    const rs = await Promise.all(Array.from({ length: 20 }, () => rpcAsSr(db, "shadow_acquire_tick")));
    const won = rs.filter((r) => r.result === "acquired");
    expect(won).toHaveLength(1);
    expect(rs.filter((r) => r.result === "busy")).toHaveLength(19);
    const [ttl] = await db.rows<{ s: number }>(`select round(extract(epoch from tick_expires_at - now()))::int s from public.guest_ai_shadow_control`);
    expect(ttl!.s).toBeGreaterThanOrEqual(54);
    expect(ttl!.s).toBeLessThanOrEqual(55);
    expect(await rpcAsSr(db, "shadow_release_tick", { p_tick_token: "a".repeat(64) })).toEqual({ result: "noop" });
    expect(await rpcAsSr(db, "shadow_release_tick", { p_tick_token: won[0]!.tick_token })).toEqual({ result: "released" });
    expect((await rpcAsSr(db, "shadow_acquire_tick")).result).toBe("acquired");
    // trava VENCIDA pode ser assumida (worker de tick morto)
    await db.sql(`update public.guest_ai_shadow_control set tick_expires_at = now() - interval '1 second'`);
    expect((await rpcAsSr(db, "shadow_acquire_tick")).result).toBe("acquired");
    // fora de running nunca adquire
    await rpcAsSr(db, "shadow_trip", { p_to: "circuit_open", p_reason: "error_rate_exceeded" });
    await db.sql(`update public.guest_ai_shadow_control set tick_owner_token = null, tick_expires_at = null`);
    expect(await rpcAsSr(db, "shadow_acquire_tick")).toMatchObject({ result: "state_not_running" });
  }, 60_000);

  it("F-07 · reivindicação exige a trava do tick E ≥ 15 s de tick restantes; token alheio ou vencido ⇒ tick_not_held (nada muda)", async () => {
    const s = await conv();
    await shadowToRunning(db, [s]);
    const v = await readyBatch(s);
    expect((await rpcAsSr(db, "shadow_claim_execution", claimArgs(s, v, undefined, "b".repeat(64)))).result).toBe("tick_not_held");
    await db.sql(`update public.guest_ai_shadow_control set tick_expires_at = now() + interval '14 seconds'`);
    expect((await rpcAsSr(db, "shadow_claim_execution", claimArgs(s, v))).result).toBe("tick_not_held");
    expect((await leaseRow(db, s.conv))!.state).toBe("ready");
    await db.sql(`update public.guest_ai_shadow_control set tick_expires_at = now() + interval '16 seconds'`);
    expect((await rpcAsSr(db, "shadow_claim_execution", claimArgs(s, v))).result).toBe("claimed");
    expect(await db.sql(`select count(*) from public.guest_ai_shadow_inflight where status = 'running'`)).toBe("1");
  }, 60_000);

  it("F-07 · dois TICKS simultâneos com o worker real ⇒ um executa, o outro sai com `tick_busy` sem tocar em nada; a trava é liberada no fim", async () => {
    const specs = await Promise.all(Array.from({ length: 3 }, () => conv()));
    await shadowToRunning(db, specs);
    await releaseHarnessTick();
    const provider = simProvider({ latencyMs: 300 });
    const ctl = controller();
    const w = worldIo(specs, { db, ctl, provider });
    const tick = () => runShadowTick({ store: async () => w.storeFor(new AbortController().signal), candidates: async () => ({ ok: true, candidates: specs.map(candidateOf) }), worker: (c, t) => runShadowWorker(c, { ...w, tickToken: t }) });
    const [a, b] = await Promise.all([tick(), tick()]);
    recordResult("e31-f07-two-ticks", { a, b, gateway: provider.calls });
    expect([a.outcome, b.outcome].sort()).toEqual(["executed", "tick_busy"]);
    expect(provider.calls).toBe(3);
    expect(await db.sql(`select coalesce(tick_owner_token, 'none') from public.guest_ai_shadow_control`)).toBe("none");
    // serial: nunca duas execuções em andamento ao mesmo tempo (registro do banco)
    const [overlap] = await db.rows<{ n: number }>(`select count(*)::int n from public.guest_ai_shadow_inflight a join public.guest_ai_shadow_inflight b on a.execution_id < b.execution_id and a.started_at < b.closed_at and b.started_at < a.closed_at`);
    expect(overlap!.n).toBe(0);
  }, 60_000);

  // ───────────────────────────── F-01 ─────────────────────────────
  it("F-01 · cerca: finalização com token errado ⇒ lease intocado e registro de fallback; prazo vencido (sem novo dono) ⇒ lote SELADO como falha; nunca `completed` fora da posse", async () => {
    const mk = async () => {
      const s = await conv();
      await shadowToRunning(db, [s]);
      const v = await readyBatch(s);
      const exec = crypto.randomUUID();
      const c = await rpcAsSr(db, "shadow_claim_execution", claimArgs(s, v, exec));
      return { s, exec, c };
    };
    // worker REAL cujo lease vence durante o Gateway (sem ninguém recuperar)
    const s = await conv();
    await shadowToRunning(db, [s]);
    const provider = simProvider({ latencyMs: 30, during: async () => { await expireLease(s.conv); } });
    const out = await runShadowWorker(candidateOf(s), worldIo([s], { db, ctl: controller(), provider }));
    expect(out).toEqual({ status: "recorded", decision: "technical_failure" });
    expect((await executions(db, s.conv))[0]).toMatchObject({ technical_code: "lease_integrity_failure" });
    expect(await leaseRow(db, s.conv)).toMatchObject({ state: "failed", message_ids: [] });
    expect(await budgetLedgerConsistent(db)).toBe(true);
    // token errado: RPC direta com um registro válido do próprio worker não é possível sem o token ⇒ a cerca recusa a posse
    const { s: s2, exec, c } = await mk();
    expect(c.result).toBe("claimed");
    const L = realStores(db, controller()).leaseFor();
    const before = await leaseRow(db, s2.conv);
    // a finalização exige token de 64 hex; token alheio ⇒ `fenced_foreign` (lease não é tocado)
    const store = realStores(db, controller()).storeFor();
    const rec = (await import("./e31-records")).recordsFor({ exec, s: s2, batchId: String(c.batch_id), version: Number(c.version) });
    const r = await store.finalizeExecution({ executionId: exec, ownerToken: "d".repeat(64), outcome: "complete", settlement: { tokens: 0, costUsd: "0.00000000", calls: 0 }, record: rec.ok, fencedRecord: rec.fenced });
    expect(r).toEqual({ kind: "finalized", lease: "fenced_foreign", decision: "technical_failure" });
    expect(await leaseRow(db, s2.conv)).toEqual(before);
    void L;
  }, 60_000);

  it("F-01 × F-04 · finalização TARDIA × reconciliação concorrentes sobre a mesma execução órfã ⇒ exatamente uma vence; uma liquidação; um registro", async () => {
    const winners = new Set<string>();
    for (let round = 0; round < 6; round++) {
      const s = await conv();
      await shadowToRunning(db, [s]);
      const v = await readyBatch(s);
      const exec = crypto.randomUUID();
      const c = await rpcAsSr(db, "shadow_claim_execution", claimArgs(s, v, exec));
      expect((await rpcAsSr(db, "shadow_reserve_budget", { p_execution_id: exec, p_tokens: 83072, p_cost: "0.13072000", p_calls: 2 })).result).toBe("reserved");
      await expireLease(s.conv);
      const store = realStores(db, controller()).storeFor();
      const rec = (await import("./e31-records")).recordsFor({ exec, s, batchId: String(c.batch_id), version: Number(c.version), cost: "0.00232500", tokens: 1020, calls: 1 });
      const [fin, recon] = await Promise.all([
        store.finalizeExecution({ executionId: exec, ownerToken: String(c.owner_token), outcome: "complete", settlement: { tokens: 1020, costUsd: "0.00232500", calls: 1 }, record: rec.ok, fencedRecord: rec.fenced }),
        // rodadas ímpares dão vantagem à finalização (as duas ordens precisam ser exercitadas)
        (round % 2 === 1 ? new Promise((r) => setTimeout(r, 400)) : Promise.resolve()).then(() => rpcAsSr(db, "shadow_reconcile", { p_tick_token: db.tick })),
      ]);
      const ex = await executions(db, s.conv);
      const [res] = await db.rows<{ kind: string; cost: string }>(`select settlement_kind kind, settled_cost::text cost from public.guest_ai_shadow_budget_reservations where execution_id = '${exec}'`);
      const winner = fin.kind === "finalized" ? "finalize" : "reconcile";
      if (winner === "finalize") {
        expect(recon).toMatchObject({ reconciled: 0 });
        expect(ex[0]).toMatchObject({ technical_code: "lease_integrity_failure" }); // prazo vencido ⇒ fallback
        expect(res).toEqual({ kind: "actual", cost: "0.00232500" });
      } else {
        expect(fin).toEqual({ kind: "reconciled" });
        expect(recon).toMatchObject({ reconciled: 1 });
        expect(ex[0]).toMatchObject({ technical_code: "worker_lost" });
        expect(res).toEqual({ kind: "orphan_worst_case", cost: "0.13072000" });
      }
      expect(ex).toHaveLength(1);
      expect(await leaseRow(db, s.conv)).toMatchObject({ state: "failed", message_ids: [] });
      expect(await budgetLedgerConsistent(db)).toBe(true);
      recordResult(`e31-f01-f04-race-${round}`, { winner, fin, recon, reservation: res });
      winners.add(winner);
    }
    expect([...winners].sort()).toEqual(["finalize", "reconcile"]);
  }, 120_000);

  it("F-01 · cerca de VERSÃO: qualquer transição do lease fora da execução (mesmo pelo portador do token, ex.: renew) ⇒ finalização cercada, lease intocado", async () => {
    const s = await conv();
    await shadowToRunning(db, [s]);
    const v = await readyBatch(s);
    const exec = crypto.randomUUID();
    const c = await rpcAsSr(db, "shadow_claim_execution", claimArgs(s, v, exec));
    const L = realStores(db, controller()).leaseFor();
    const rn = await L.transition(s.conv, "renew", Number(c.version), { ownerToken: String(c.owner_token) });
    expect(rn).toMatchObject({ result: "applied", version: Number(c.version) + 1 });
    const before = await leaseRow(db, s.conv);
    const rec = (await import("./e31-records")).recordsFor({ exec, s, batchId: String(c.batch_id), version: Number(c.version) });
    const r = await realStores(db, controller()).storeFor().finalizeExecution({ executionId: exec, ownerToken: String(c.owner_token), outcome: "complete", settlement: { tokens: 0, costUsd: "0.00000000", calls: 0 }, record: rec.ok, fencedRecord: rec.fenced });
    expect(r).toEqual({ kind: "finalized", lease: "fenced_foreign", decision: "technical_failure" });
    expect(await leaseRow(db, s.conv)).toEqual(before);
  }, 60_000);

  it("F-01/F-05 · reivindicação NUNCA parte de lote em processamento vencido, mesmo sem execução em andamento registrada (posse legada)", async () => {
    const s = await conv();
    await shadowToRunning(db, [s]);
    const L = realStores(db, controller()).leaseFor();
    await L.transition(s.conv, "observe", 0, { messageIds: [s.msg] });
    const mr = await L.transition(s.conv, "mark_ready", 1, { messageIds: [s.msg] });
    const c = await L.claim(s.conv, mr.version!);
    if (c.result !== "acquired") throw new Error("claim");
    const st = await L.transition(s.conv, "start", c.version, { ownerToken: c.ownerToken });
    await expireLease(s.conv);
    expect(await db.sql(`select count(*) from public.guest_ai_shadow_inflight where conversation_id = '${s.conv}'`)).toBe("0");
    expect(await rpcAsSr(db, "shadow_claim_execution", claimArgs(s, st.version!))).toMatchObject({ result: "not_claimable", state: "processing" });
    expect((await leaseRow(db, s.conv))!.state).toBe("processing");
  }, 60_000);

  it("F-01 · reconciliação exige a trava do tick: token alheio ou vencido ⇒ tick_not_held e NADA é tocado", async () => {
    const s = await conv();
    await shadowToRunning(db, [s]);
    const v = await readyBatch(s);
    const exec = crypto.randomUUID();
    await rpcAsSr(db, "shadow_claim_execution", claimArgs(s, v, exec));
    await rpcAsSr(db, "shadow_reserve_budget", { p_execution_id: exec, p_tokens: 83072, p_cost: "0.13072000", p_calls: 2 });
    await expireLease(s.conv);
    expect(await rpcAsSr(db, "shadow_reconcile", { p_tick_token: "e".repeat(64) })).toEqual({ result: "tick_not_held" });
    await db.sql(`update public.guest_ai_shadow_control set tick_expires_at = now() - interval '1 second'`);
    expect(await rpcAsSr(db, "shadow_reconcile", { p_tick_token: db.tick })).toEqual({ result: "tick_not_held" });
    expect(await rpcAsSr(db, "shadow_reconcile", { p_tick_token: "x" })).toEqual({ result: "invalid_argument" });
    expect(await db.sql(`select status from public.guest_ai_shadow_inflight where execution_id = '${exec}'`)).toBe("running");
    expect(await budgetTotals(db)).toMatchObject({ reservations: { open: 1, settled: 0 } });
    expect((await leaseRow(db, s.conv))!.state).toBe("processing");
  }, 60_000);

  it("F-04 · liquidação interna é de UMA vez por reserva (defesa em profundidade, chamada direta como dono)", async () => {
    const s = await conv();
    await shadowToRunning(db, [s]);
    const v = await readyBatch(s);
    const exec = crypto.randomUUID();
    await rpcAsSr(db, "shadow_claim_execution", claimArgs(s, v, exec));
    await rpcAsSr(db, "shadow_reserve_budget", { p_execution_id: exec, p_tokens: 83072, p_cost: "0.13072000", p_calls: 2 });
    const settle = () => db.sql(`select public.guest_ai_shadow_settle_locked(c, '${exec}', 'actual', 10, 0.001, 1) from public.guest_ai_shadow_control c`);
    expect(JSON.parse(await settle())).toMatchObject({ result: "settled", over_reservation: false });
    expect(JSON.parse(await settle())).toEqual({ result: "already_settled" });
    expect(await budgetTotals(db)).toMatchObject({ reservations: { open: 0, settled: 1 } });
    expect(await db.sql(`select settled_cost::text from public.guest_ai_shadow_budget_days`)).toBe("0.00100000");
    expect(await budgetLedgerConsistent(db)).toBe(true);
  }, 60_000);

  it("F-04 · uso real ACIMA do reservado (provedor violou o teto) ⇒ liquida o real e desarma `budget_exhausted / token_limit_violation` na mesma transação", async () => {
    const s = await conv();
    await shadowToRunning(db, [s]);
    const v = await readyBatch(s);
    const exec = crypto.randomUUID();
    const c = await rpcAsSr(db, "shadow_claim_execution", claimArgs(s, v, exec));
    await rpcAsSr(db, "shadow_reserve_budget", { p_execution_id: exec, p_tokens: 83072, p_cost: "0.13072000", p_calls: 2 });
    // 40.000 × 125 + 20.000 × 1.000 = 25.000.000 unidades = US$ 0,25 > 0,13072 reservado
    const rec = (await import("./e31-records")).recordsFor({ exec, s, batchId: String(c.batch_id), version: Number(c.version), cost: "0.25000000", tokens: 60_000, calls: 1 });
    const r = await realStores(db, controller()).storeFor().finalizeExecution({ executionId: exec, ownerToken: String(c.owner_token), outcome: "complete", settlement: { tokens: 60_000, costUsd: "0.25000000", calls: 1 }, record: rec.ok, fencedRecord: rec.fenced });
    expect(r).toMatchObject({ kind: "finalized", lease: "completed" });
    expect(await automaticTrips(db)).toEqual([{ from_state: "running", to_state: "budget_exhausted", reason_code: "token_limit_violation" }]);
    expect(await db.sql(`select settled_cost::text from public.guest_ai_shadow_budget_days`)).toBe("0.25000000");
    expect(await budgetLedgerConsistent(db)).toBe(true);
  }, 60_000);

  // ───────────────────────────── F-02 ─────────────────────────────
  it("F-02 · finalização é UMA transação: registro recusado pelo banco ⇒ NADA persiste (lease, reserva, em andamento intocados)", async () => {
    const s = await conv();
    await shadowToRunning(db, [s]);
    const v = await readyBatch(s);
    const exec = crypto.randomUUID();
    const c = await rpcAsSr(db, "shadow_claim_execution", claimArgs(s, v, exec));
    await rpcAsSr(db, "shadow_reserve_budget", { p_execution_id: exec, p_tokens: 83072, p_cost: "0.13072000", p_calls: 2 });
    const { recordsFor } = await import("./e31-records");
    const rec = recordsFor({ exec, s, batchId: String(c.batch_id), version: Number(c.version) });
    const before = { lease: await leaseRow(db, s.conv), budget: await budgetTotals(db) };
    const call = (over: Record<string, unknown>) =>
      rpcAsSr(db, "shadow_finalize_execution", { p_execution_id: exec, p_owner_token: c.owner_token, p_outcome: "complete", p_settlement: { tokens: 0, cost_usd: "0.00000000", calls: 0 }, p_record: rec.okRow, p_fenced_record: rec.fencedRow, ...over });
    // CHECK violada dentro do registro (estratégia fora do vocabulário) ⇒ transação inteira desfeita
    expect(await call({ p_record: { ...rec.okRow, strategy: "texto livre" } })).toEqual({ result: "invalid_argument" });
    // registro de OUTRA execução / outro lote / custo divergente do liquidado ⇒ recusado antes de tocar em nada
    expect(await call({ p_record: { ...rec.okRow, execution_id: crypto.randomUUID() } })).toEqual({ result: "invalid_argument" });
    expect(await call({ p_record: { ...rec.okRow, batch_id: crypto.randomUUID() } })).toEqual({ result: "invalid_argument" });
    expect(await call({ p_settlement: { tokens: 0, cost_usd: "0.00000001", calls: 0 } })).toEqual({ result: "invalid_argument" });
    expect(await call({ p_settlement: { tokens: 0, cost_usd: 0, calls: 0 } })).toEqual({ result: "invalid_argument" }); // dinheiro só como decimal exato
    expect(await call({ p_fenced_record: { ...rec.fencedRow, decision: "answer_candidate", candidate_available: true } })).toEqual({ result: "invalid_argument" });
    expect({ lease: await leaseRow(db, s.conv), budget: await budgetTotals(db) }).toEqual(before);
    expect(await db.sql(`select status from public.guest_ai_shadow_inflight where execution_id = '${exec}'`)).toBe("running");
    expect(await db.sql(`select count(*) from public.guest_ai_shadow_executions where execution_id = '${exec}'`)).toBe("0");
    // a válida aplica tudo junto; repetir ⇒ duplicate sem liquidar de novo
    expect(await call({})).toMatchObject({ result: "finalized", lease: "completed", decision: "answer_candidate", settlement: "settled" });
    expect(await call({})).toEqual({ result: "duplicate" });
    expect(await budgetTotals(db)).toMatchObject({ reserved_cost: 0, open_reservations: 0, reservations: { settled: 1, open: 0 } });
    expect(await budgetLedgerConsistent(db)).toBe(true);
  }, 60_000);

  // ───────────────────────────── F-11 / F-12 ─────────────────────────────
  it("F-11 · resposta da REIVINDICAÇÃO perdida depois do commit ⇒ a repetição devolve a MESMA posse; uma execução, uma chamada, lote concluído", async () => {
    const s = await conv();
    await shadowToRunning(db, [s]);
    const provider = simProvider();
    const ctl = controller({ faults: [{ fn: "shadow_claim_execution", mode: "after_commit", nth: 1 }] });
    const out = await runShadowWorker(candidateOf(s), worldIo([s], { db, ctl, provider }));
    recordResult("e31-f11-claim-lost", { out, calls: summarizeCalls(ctl) });
    expect(summarizeCalls(ctl).filter((c) => c.startsWith("shadow_claim_execution"))).toEqual(["shadow_claim_execution=error:lost_after_claimed", "shadow_claim_execution=claimed"]);
    expect(out).toEqual({ status: "recorded", decision: "answer_candidate" });
    expect(provider.calls).toBe(1);
    expect(await executions(db, s.conv)).toHaveLength(1);
    expect((await leaseRow(db, s.conv))!.state).toBe("completed");
    expect(await budgetLedgerConsistent(db)).toBe(true);
  }, 60_000);

  it("F-11/F-12 · resposta da FINALIZAÇÃO perdida depois do commit ⇒ a repetição recebe `duplicate`: um registro, uma liquidação, NENHUM disparo de disjuntor (nem integridade)", async () => {
    const specs = await Promise.all(Array.from({ length: 3 }, () => conv()));
    await shadowToRunning(db, specs);
    const outs = [];
    for (const s of specs) {
      const ctl = controller({ faults: [{ fn: "shadow_finalize_execution", mode: "after_commit", nth: 1 }] });
      outs.push(await runShadowWorker(candidateOf(s), worldIo(specs, { db, ctl, provider: simProvider() })));
      expect(summarizeCalls(ctl).filter((c) => c.startsWith("shadow_finalize_execution"))).toEqual(["shadow_finalize_execution=error:lost_after_finalized", "shadow_finalize_execution=duplicate"]);
    }
    recordResult("e31-f11-finalize-lost", { outs, trips: await automaticTrips(db) });
    expect(outs.every((o) => o.status === "recorded" && o.decision === "answer_candidate")).toBe(true);
    expect(await executions(db)).toHaveLength(3);
    expect(await automaticTrips(db)).toEqual([]);
    expect((await shadowState(db)).state).toBe("running");
    expect(await budgetTotals(db)).toMatchObject({ open_reservations: 0, reservations: { settled: 3, open: 0 } });
    expect(await budgetLedgerConsistent(db)).toBe(true);
  }, 60_000);

  // ───────────────────────────── F-05 ─────────────────────────────
  it("F-05 · lease encerrado FORA do worker (expire/cancel por outra via) com o lote ainda listado ⇒ o worker sela as sobras e NÃO reprocessa sem mensagem nova", async () => {
    for (const ending of ["expire", "cancel"] as const) {
      const s = await conv();
      await shadowToRunning(db, [s]);
      const L = realStores(db, controller()).leaseFor();
      await L.transition(s.conv, "observe", 0, { messageIds: [s.msg] });
      const mr = await L.transition(s.conv, "mark_ready", 1, { messageIds: [s.msg] });
      const c = await L.claim(s.conv, mr.version!); // via legada do B3.1 (ainda existe): o Shadow nunca a usa
      if (c.result !== "acquired") throw new Error("claim");
      const st = await L.transition(s.conv, "start", c.version, { ownerToken: c.ownerToken });
      if (ending === "expire") await expireLease(s.conv);
      expect((await L.transition(s.conv, ending, st.version!, { ownerToken: c.ownerToken })).result).toBe("applied");
      expect((await leaseRow(db, s.conv))!.message_ids).toEqual([s.msg]);
      const provider = simProvider();
      const ctl = controller();
      const out = await runShadowWorker(candidateOf(s), worldIo([s], { db, ctl, provider }));
      expect(provider.calls, ending).toBe(0);
      expect(out, ending).toEqual({ status: "skipped", code: "collector_not_ready" });
      expect(summarizeCalls(ctl)).toContain("transition_conversation_lease:acknowledge=applied");
      const l = await leaseRow(db, s.conv);
      expect(l!.message_ids).toEqual([]);
      expect(l!.processed).toContain(s.msg);
      // mensagem nova ⇒ avaliada (só ela)
      const m2 = synthUuid("a3000000");
      const s2: ConvSpec = { ...s, msg: m2, guestMessages: [s.msg, m2] };
      const p2 = simProvider();
      expect((await runShadowWorker(candidateOf(s2), worldIo([s2], { db, ctl: controller(), provider: p2 }))).status).toBe("recorded");
      expect(p2.calls).toBe(1);
    }
  }, 60_000);

  // ───────────────────────────── F-06 ─────────────────────────────
  it("F-06 · rechecagem antes de persistir o candidato: pausa que surge DEPOIS da cadeia (durante o Gateway) ⇒ candidato descartado (human_pause_active), lote concluído, sem envio", async () => {
    const s = await conv();
    await shadowToRunning(db, [s]);
    const dbNow = Date.parse(await db.sql(`select to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`));
    const provider = simProvider({ during: () => { s.human.pause = { ...s.human.pause, column: { ai_paused: true, paused_until: new Date(dbNow + 3_600_000).toISOString() as never } }; } });
    const out = await runShadowWorker(candidateOf(s), worldIo([s], { db, ctl: controller(), provider }));
    const ex = await executions(db, s.conv);
    recordResult("e31-f06-pause-after-chain", { out, ex });
    expect(provider.calls).toBe(1);
    expect(out).toEqual({ status: "recorded", decision: "human_pause_active" });
    expect(ex[0]).toMatchObject({ decision: "human_pause_active", block_code: "pause_active", execution_state: "blocked" });
    expect((await leaseRow(db, s.conv))!.state).toBe("completed");
    expect(await budgetLedgerConsistent(db)).toBe(true);
  }, 60_000);

  it("F-06 · equipe assume a conversa (posse muda) durante o Gateway ⇒ restrição operacional; leitura da rechecagem falha ⇒ falha técnica; nunca candidato", async () => {
    const a = await conv();
    const b = await conv();
    await shadowToRunning(db, [a, b]);
    const pa = simProvider({ during: () => { a.human.ownership = "indeterminate"; } });
    expect(await runShadowWorker(candidateOf(a), worldIo([a, b], { db, ctl: controller(), provider: pa }))).toEqual({ status: "recorded", decision: "operational_restriction" });
    expect((await executions(db, a.conv))[0]).toMatchObject({ block_code: "ownership_indeterminate" });
    const pb = simProvider({ during: () => { b.human.readFails = true; } });
    expect(await runShadowWorker(candidateOf(b), worldIo([a, b], { db, ctl: controller(), provider: pb }))).toEqual({ status: "recorded", decision: "technical_failure" });
    expect((await executions(db, b.conv))[0]).toMatchObject({ technical_code: "read_failed" });
    expect((await leaseRow(db, b.conv))).toMatchObject({ state: "failed", message_ids: [] });
    expect(await db.sql(`select count(*) from public.guest_ai_shadow_executions where decision = 'answer_candidate'`)).toBe("0");
  }, 60_000);

  // ───────────────────────────── isolamento ─────────────────────────────
  it("isolamento · reivindicação recusa par tenant/imóvel que a porta não aceita (o banco confere, não só o worker)", async () => {
    const s = await conv();
    await shadowToRunning(db, [s]);
    const v = await readyBatch(s);
    expect(await rpcAsSr(db, "shadow_claim_execution", { ...claimArgs(s, v), p_tenant_id: "7a000000-0000-4000-8000-00000000beef" })).toEqual({ result: "property_blocked", reason: "tenant_mismatch" });
    expect(await rpcAsSr(db, "shadow_claim_execution", { ...claimArgs(s, v), p_property_id: "7b000000-0000-4000-8000-00000000beef" })).toEqual({ result: "property_blocked", reason: "property_not_found" });
    expect((await leaseRow(db, s.conv))!.state).toBe("ready");
  }, 60_000);

  // ───────────────────────────── combinado ─────────────────────────────
  it("COMBINADO · tick real: worker perdido (F-01/F-04/F-05) + resposta perdida (F-11/F-12) + pausa vencida pelo banco (F-09) + pausa nova antes de persistir (F-06), em série sob a trava (F-07) ⇒ invariantes todos preservados", async () => {
    const lost = await conv();
    const lostReply = await conv();
    const expired = await conv();
    const late = await conv();
    const specs = [lost, lostReply, expired, late];
    await shadowToRunning(db, specs);
    // worker perdido de um tick anterior
    const v = await readyBatch(lost);
    const deadExec = crypto.randomUUID();
    await rpcAsSr(db, "shadow_claim_execution", claimArgs(lost, v, deadExec));
    await rpcAsSr(db, "shadow_reserve_budget", { p_execution_id: deadExec, p_tokens: 83072, p_cost: "0.13072000", p_calls: 2 });
    await expireLease(lost.conv);
    await releaseHarnessTick();
    // pausa da coluna vencida (pelo banco) antes da mensagem ⇒ autorizada
    expired.human.pause = { ...expired.human.pause, column: { ai_paused: true, paused_until: "2026-11-03T09:00:00Z" as never } };
    const dbNow = Date.parse(await db.sql(`select to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`));
    let n = 0;
    const provider = simProvider({ during: () => { if (++n === 3) late.human.pause = { ...late.human.pause, column: { ai_paused: true, paused_until: new Date(dbNow + 3_600_000).toISOString() as never } }; } });
    const ctl = controller({ faults: [{ fn: "shadow_finalize_execution", mode: "after_commit", nth: 1 }] });
    const w = worldIo(specs, { db, ctl, provider });
    const summary = await runShadowTick({ store: async () => w.storeFor(new AbortController().signal), candidates: async () => ({ ok: true, candidates: [lostReply, expired, late].map(candidateOf) }), worker: (c, t) => runShadowWorker(c, { ...w, tickToken: t }) });
    const all = await executions(db);
    const decisionOf = (s: ConvSpec) => all.find((e) => e.conversation_id === s.conv)?.decision;
    recordResult("e31-combined-tick", { summary, decisions: specs.map(decisionOf), trips: await automaticTrips(db), budget: await budgetTotals(db), calls: summarizeCalls(ctl) });
    expect(summary).toEqual({ outcome: "executed", conversationsConsidered: 3, executed: 3, blocked: 0, failed: 0 });
    expect(decisionOf(lost)).toBe("technical_failure");
    expect(all.find((e) => e.conversation_id === lost.conv)!.technical_code).toBe("worker_lost");
    expect(decisionOf(lostReply)).toBe("answer_candidate");
    expect(decisionOf(expired)).toBe("answer_candidate");
    expect(decisionOf(late)).toBe("human_pause_active");
    expect(all).toHaveLength(4);
    expect(provider.calls).toBe(3);
    expect(await automaticTrips(db)).toEqual([]);
    expect(await budgetTotals(db)).toMatchObject({ open_reservations: 0, reserved_cost: 0, reservations: { open: 0, settled: 4 } });
    expect(await budgetLedgerConsistent(db)).toBe(true);
    expect(await db.sql(`select count(*) from public.guest_ai_shadow_inflight where status = 'running'`)).toBe("0");
    expect(await db.sql(`select coalesce(tick_owner_token, 'none') from public.guest_ai_shadow_control`)).toBe("none");
    expect(await leaseRow(db, lost.conv)).toMatchObject({ state: "failed", message_ids: [] });
    // segundo tick sem mensagens novas ⇒ nada é reprocessado
    const p2 = simProvider();
    const w2 = worldIo(specs, { db, ctl: controller(), provider: p2 });
    const s2 = await runShadowTick({ store: async () => w2.storeFor(new AbortController().signal), candidates: async () => ({ ok: true, candidates: specs.slice(0, 3).map(candidateOf) }), worker: (c, t) => runShadowWorker(c, { ...w2, tickToken: t }) });
    expect(p2.calls).toBe(0);
    expect(s2.executed).toBe(0);
    expect(await executions(db)).toHaveLength(4);
  }, 120_000);
});
