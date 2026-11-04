/**
 * B3.3 · E3 — Fase 3: CONCORRÊNCIA E INTEGRIDADE TRANSACIONAL contra PostgreSQL 17.6 real.
 * Workers reais em paralelo (cada RPC = conexão própria). Sem dados reais, sem rede, sem envio.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runShadowWorker } from "@/lib/guest-ai/shadow-exec/worker.server";
import { DEFAULT_LEASE_TTL_SECONDS } from "@/lib/guest-ai/batch/lease";
import { SHADOW_DEADLINE_MS } from "@/lib/guest-ai/shadow-exec/contracts";
import {
  PG176_AVAILABLE, startE3Db, controller, worldIo, convSpec, candidateOf, simProvider, shadowToRunning, budgetTotals, budgetLedgerConsistent, shadowState,
  seedConversation, leaseRow, executions, realStores, recordResult, summarizeCalls, synthUuid, goodDecision, rpcAsSr, automaticTrips, type E3Db, type ConvSpec,
} from "./harness";

let db: E3Db;
const conv = (over: Partial<ConvSpec> = {}) => seedConversation(db, convSpec(over));
const until = async (cond: () => boolean, ms = 10_000) => {
  const t = Date.now();
  while (!cond() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 20));
};

describe.skipIf(!PG176_AVAILABLE)("E3 · Fase 3 — concorrência e integridade (PostgreSQL 17.6 real)", () => {
  beforeAll(() => {
    db = startE3Db();
  }, 60_000);
  afterAll(() => db?.stop());

  it("ambiente: servidor PostgreSQL 17.6", () => {
    expect(db.pg.version).toBe("17.6");
  });

  for (const n of [2, 10, 25]) {
    it(`${n} workers simultâneos na MESMA conversa ⇒ exatamente 1 execução, 1 chamada ao Gateway, 1 liquidação, lease concluído`, async () => {
      const s = await conv();
      await shadowToRunning(db, [s]);
      const provider = simProvider({ latencyMs: 150 });
      const ctls = Array.from({ length: n }, () => controller());
      const outs = await Promise.all(ctls.map((ctl) => runShadowWorker(candidateOf(s), worldIo([s], { db, ctl, provider }))));
      const ex = await executions(db, s.conv);
      const b = await budgetTotals(db);
      const l = await leaseRow(db, s.conv);
      recordResult(`concurrency-same-conv-${n}`, { outs, executions: ex.length, gateway: provider.calls, budget: b, lease: l });
      expect(provider.calls).toBe(1);
      expect(ex).toHaveLength(1);
      expect(ex[0]!.decision).toBe("answer_candidate");
      expect(outs.filter((o) => o.status === "recorded")).toHaveLength(1);
      // os perdedores nunca executam: só pulam por concorrência/coletor (sem registro, sem custo)
      for (const o of outs.filter((x) => x.status !== "recorded")) expect(["lease_concurrency", "collector_not_ready"]).toContain((o as { code: string }).code);
      expect(b.reservations).toMatchObject({ settled: 1, open: 0 });
      expect(l).toMatchObject({ state: "completed", attempts: 1, deferred: [] });
      expect(l!.processed).toContain(s.msg);
      expect(await budgetLedgerConsistent(db)).toBe(true);
    }, 120_000);
  }

  // E3.1: 7 = ⌊US$ 1,00 / US$ 0,13072⌋ reservas de pior caso simultâneas cabem no teto diário homologado
  it("7 conversas diferentes do MESMO imóvel, 7 workers em paralelo ⇒ 7 execuções independentes, contabilidade exata", async () => {
    const specs = await Promise.all(Array.from({ length: 7 }, () => conv()));
    await shadowToRunning(db, specs);
    const provider = simProvider({ latencyMs: 100 });
    const outs = await Promise.all(specs.map((s) => runShadowWorker(candidateOf(s), worldIo(specs, { db, ctl: controller(), provider }))));
    const ex = await executions(db);
    const b = await budgetTotals(db);
    recordResult("concurrency-10-convs", { outs, executions: ex.length, gateway: provider.calls, budget: b });
    expect(outs.every((o) => o.status === "recorded" && o.decision === "answer_candidate")).toBe(true);
    expect(provider.calls).toBe(7);
    expect(new Set(ex.map((e) => e.conversation_id))).toEqual(new Set(specs.map((s) => s.conv)));
    expect(b).toMatchObject({ settled_calls: 7, reserved_calls: 0, open_reservations: 0, reservations: { settled: 7, open: 0 } });
    // aritmética EXATA: 7 × (900 × 125 + 120 × 1.000) unidades = US$ 0,016275
    expect(await db.sql(`select settled_cost::text from public.guest_ai_shadow_budget_days`)).toBe("0.01627500");
    for (const s of specs) expect((await leaseRow(db, s.conv))!.state).toBe("completed");
    expect(await budgetLedgerConsistent(db)).toBe(true);
  }, 120_000);

  it("tenants diferentes (2 tenants × 3 imóveis × 2 workers por conversa) ⇒ cada execução carrega o tenant/imóvel da SUA conversa; nenhuma mistura", async () => {
    const tA = synthUuid("7a300000");
    const tB = synthUuid("7a300000");
    const specs: ConvSpec[] = [];
    for (const t of [tA, tB])
      for (let i = 0; i < 3; i++) {
        const marker = `Imovel-Sintetico-${t.slice(-4)}-${i}`;
        specs.push(await conv({ tenant: t, property: synthUuid("7b300000"), contextPatch: (ctx) => ({ ...ctx, guest: { ...ctx.guest, property: { ...ctx.guest.property, name: marker } } }) as typeof ctx }));
      }
    const markerOf = (s: ConvSpec) => `Imovel-Sintetico-${s.tenant.slice(-4)}-${specs.filter((x) => x.tenant === s.tenant).indexOf(s)}`;
    await shadowToRunning(db, specs);
    const provider = simProvider({ latencyMs: 80 });
    const runs = specs.flatMap((s) => [s, s]).map((s) => runShadowWorker(candidateOf(s), worldIo(specs, { db, ctl: controller(), provider })));
    await Promise.all(runs);
    const ex = await executions(db);
    recordResult("concurrency-multi-tenant", { executions: ex.map((e) => ({ t: e.tenant_id, p: e.property_id, c: e.conversation_id, d: e.decision })), gateway: provider.calls });
    expect(ex).toHaveLength(6);
    expect(provider.calls).toBe(6);
    for (const e of ex) {
      const s = specs.find((x) => x.conv === e.conversation_id)!;
      expect(e.tenant_id).toBe(s.tenant);
      expect(e.property_id).toBe(s.property);
    }
    // o modelo nunca recebeu conteúdo de outro tenant: cada requisição cita só o imóvel da sua conversa
    for (const req of provider.requests) {
      const body = JSON.stringify(req.messages);
      const hits = specs.filter((s) => body.includes(markerOf(s)));
      expect(hits).toHaveLength(1);
    }
    expect((await shadowState(db)).state).toBe("running");
  }, 120_000);

  it("teto diário sob concorrência (30 workers, reservas sobrepostas): a soma reservada+liquidada NUNCA passa do teto; bloqueados não chamam o Gateway", async () => {
    const specs = await Promise.all(Array.from({ length: 30 }, () => conv()));
    // descobre o custo de reserva de UM turno (pior caso) com uma execução de referência
    await shadowToRunning(db, specs);
    await runShadowWorker(candidateOf(specs[0]!), worldIo(specs, { db, ctl: controller(), provider: simProvider() }));
    const [ref] = await db.rows<{ cost: number }>(`select cost_usd::float8 cost from public.guest_ai_shadow_budget_reservations limit 1`);
    const worst = ref!.cost;
    const limit = Math.round(worst * 3.5 * 1e6) / 1e6;
    await shadowToRunning(db, specs, { p_daily_cost_limit_usd: limit });
    const provider = simProvider({ latencyMs: 400 });
    let peak = 0;
    let sampling = true;
    const sampler = (async () => {
      while (sampling) {
        const t = await budgetTotals(db);
        peak = Math.max(peak, t.reserved_cost + t.settled_cost);
        await new Promise((r) => setTimeout(r, 15));
      }
    })();
    const outs = await Promise.all(specs.slice(1).map((s) => runShadowWorker(candidateOf(s), worldIo(specs, { db, ctl: controller(), provider }))));
    sampling = false;
    await sampler;
    const b = await budgetTotals(db);
    const st = await shadowState(db);
    recordResult("concurrency-daily-ceiling", { worst, limit, peak, budget: b, state: st, gateway: provider.calls, decisions: outs.map((o) => (o.status === "skipped" ? o.code : o.decision)) });
    expect(peak).toBeLessThanOrEqual(limit + 1e-9);
    expect(b.reserved_cost + b.settled_cost).toBeLessThanOrEqual(limit + 1e-9);
    expect(provider.calls).toBe(b.reservations.settled + b.reservations.open);
    expect(provider.calls).toBeLessThanOrEqual(3);
    expect(st.state).toBe("budget_exhausted");
    expect(await budgetLedgerConsistent(db)).toBe(true);
  }, 180_000);

  it("invariante: prazo do lease (30 s) > prazo absoluto do worker (15 s) ⇒ um worker vivo nunca perde a posse antes do próprio prazo", () => {
    expect(DEFAULT_LEASE_TTL_SECONDS * 1000).toBeGreaterThanOrEqual(2 * SHADOW_DEADLINE_MS);
  });

  it("CRÍTICO · F-01/F-04/F-05: worker MORTO depois de reivindicar e reservar ⇒ nenhum worker reprocessa o lote; a reconciliação o SELA, liquida a reserva órfã pelo pior caso e registra worker_lost; só mensagem NOVA gera nova avaliação", async () => {
    const s = await conv();
    await shadowToRunning(db, [s]);
    // QUEDA do processo: o banco fica exatamente como um worker morto o deixaria — lote reivindicado e
    // iniciado (`shadow_claim_execution`), reserva aberta — e nenhum processo continua vivo para finalizar
    const st = realStores(db, controller());
    const L = st.leaseFor();
    await L.transition(s.conv, "observe", 0, { messageIds: [s.msg] });
    const mr = await L.transition(s.conv, "mark_ready", 1, { messageIds: [s.msg] });
    const dead = crypto.randomUUID();
    const c = await st.storeFor().claimExecution({ tickToken: db.tick!, executionId: dead, conversationId: s.conv, expectedVersion: mr.version!, tenantId: s.tenant, propertyId: s.property, channel: "web" });
    expect(c.kind).toBe("claimed");
    expect((await st.storeFor().reserve(dead, { tokens: 83_072, costUsd8: 13_072_000n, calls: 2 })).kind).toBe("reserved");
    expect((await leaseRow(db, s.conv))!.state).toBe("processing");
    // o prazo do lease vence pelo relógio do BANCO (fixture: dono da tabela)
    await db.sql(`update public.guest_ai_conversation_leases set lease_expires_at = now() - interval '1 second' where conversation_id = '${s.conv}'`);
    // 1) um NOVO worker não recupera nem reprocessa (a reivindicação só parte de `ready`)
    const p1 = simProvider();
    const out1 = await runShadowWorker(candidateOf(s), worldIo([s], { db, ctl: controller(), provider: p1 }));
    expect(out1).toEqual({ status: "skipped", code: "lease_concurrency" });
    expect(p1.calls).toBe(0);
    // 2) reconciliação (tick): assume atomicamente, sela, liquida pelo pior caso e registra
    const rec = await rpcAsSr(db, "shadow_reconcile", { p_tick_token: db.tick });
    expect(rec).toMatchObject({ result: "ok", reconciled: 1 });
    expect(await rpcAsSr(db, "shadow_reconcile", { p_tick_token: db.tick })).toEqual({ result: "ok", reconciled: 0 }); // idempotente
    const l = await leaseRow(db, s.conv);
    const ex = await executions(db, s.conv);
    const [res] = await db.rows<{ kind: string; cost: string; status: string }>(`select settlement_kind kind, settled_cost::text cost, status from public.guest_ai_shadow_budget_reservations where execution_id = '${dead}'`);
    const [inf] = await db.rows<{ status: string }>(`select status from public.guest_ai_shadow_inflight where execution_id = '${dead}'`);
    expect(l).toMatchObject({ state: "failed", message_ids: [] });
    expect(l!.processed).toContain(s.msg);
    expect(ex).toEqual([expect.objectContaining({ execution_id: dead, decision: "technical_failure", technical_code: "worker_lost", batch_id: c.kind === "claimed" ? c.batchId : null })]);
    expect(res).toEqual({ kind: "orphan_worst_case", cost: "0.13072000", status: "settled" });
    expect(inf).toEqual({ status: "reconciled" });
    expect(await budgetLedgerConsistent(db)).toBe(true);
    // 3) sem mensagem nova: nada é reavaliado (nem por varredura, nem por novo worker)
    const p3 = simProvider();
    const out3 = await runShadowWorker(candidateOf(s), worldIo([s], { db, ctl: controller(), provider: p3 }));
    expect(out3).toEqual({ status: "skipped", code: "collector_not_ready" });
    expect(p3.calls).toBe(0);
    // 4) mensagem NOVA do hóspede ⇒ nova avaliação, só dela
    const m2 = synthUuid("a3000000");
    const s2: ConvSpec = { ...s, msg: m2, guestMessages: [s.msg, m2] };
    const p4 = simProvider();
    const out4 = await runShadowWorker(candidateOf(s2), worldIo([s2], { db, ctl: controller(), provider: p4 }));
    const l4 = await leaseRow(db, s.conv);
    recordResult("concurrency-crash-recovery", { out1, rec, lease: l, reservation: res, out3, out4, lease4: l4 });
    expect(p4.calls).toBe(1);
    expect(out4.status).toBe("recorded");
    expect(l4!.processed.filter((x) => x === s.msg)).toHaveLength(1);
    expect(l4!.processed).toContain(m2);
  }, 60_000);

  it("worker OBSOLETO: lease vencido e recuperado por outro dono durante a chamada ao Gateway ⇒ o obsoleto não finaliza nem conta como sucesso; o novo dono conclui", async () => {
    const s = await conv();
    await shadowToRunning(db, [s]);
    const stores = realStores(db, controller());
    let recovered: { version: number; ownerToken: string } | null = null;
    const provider = simProvider({
      latencyMs: 50,
      during: async () => {
        await db.sql(`update public.guest_ai_conversation_leases set lease_expires_at = now() - interval '1 second' where conversation_id = '${s.conv}'`);
        const snap = await stores.leaseFor().load(s.conv);
        const c = await stores.leaseFor().claim(s.conv, snap!.version);
        expect(c.result).toBe("recovered");
        if (c.result === "recovered") {
          const st = await stores.leaseFor().transition(s.conv, "start", c.version, { ownerToken: c.ownerToken });
          recovered = { version: st.version!, ownerToken: c.ownerToken };
        }
      },
    });
    const ctl = controller();
    const out = await runShadowWorker(candidateOf(s), worldIo([s], { db, ctl, provider }));
    const ex = await executions(db, s.conv);
    expect(out).toEqual({ status: "recorded", decision: "technical_failure" });
    expect(ex[0]).toMatchObject({ decision: "technical_failure", technical_code: "lease_integrity_failure" });
    // a cerca da finalização atômica (versão + token) trocou o registro pelo de fallback, sem tocar no lease do novo dono
    expect(summarizeCalls(ctl)).toContain("shadow_finalize_execution=finalized");
    expect(summarizeCalls(ctl).filter((c) => c.startsWith("transition_conversation_lease:complete"))).toEqual([]);
    expect((await leaseRow(db, s.conv))!.state).toBe("processing");
    const done = await stores.leaseFor().transition(s.conv, "complete", recovered!.version, { ownerToken: recovered!.ownerToken });
    expect(done).toMatchObject({ result: "applied", state: "completed" });
    expect(await budgetLedgerConsistent(db)).toBe(true);
    recordResult("concurrency-stale-worker", { out, calls: summarizeCalls(ctl), execution: ex[0] });
  }, 60_000);

  it("finalização concorrente pelo MESMO dono (complete × complete, complete × fail) ⇒ exatamente uma aplicada", async () => {
    const stores = realStores(db, controller());
    for (const second of ["complete", "fail"] as const) {
      const s = await conv();
      const L = stores.leaseFor();
      await L.transition(s.conv, "observe", 0, { messageIds: [s.msg] });
      const r = await L.transition(s.conv, "mark_ready", 1, { messageIds: [s.msg] });
      const c = await L.claim(s.conv, r.version!);
      if (c.result !== "acquired") throw new Error("claim");
      const st = await L.transition(s.conv, "start", c.version, { ownerToken: c.ownerToken });
      const res = await Promise.all([
        L.transition(s.conv, "complete", st.version!, { ownerToken: c.ownerToken }),
        L.transition(s.conv, second, st.version!, { ownerToken: c.ownerToken, retryable: false }),
      ]);
      expect(res.filter((x) => x.result === "applied")).toHaveLength(1);
      expect(res.every((x) => ["applied", "already_processed", "stale_version"].includes(x.result))).toBe(true);
      const l = await leaseRow(db, s.conv);
      expect(["completed", "failed"]).toContain(l!.state);
    }
  }, 60_000);

  it("nova tentativa INTERNA do Gateway (5xx → ok): uma reserva cobre as 2 tentativas; liquidação com calls=2; o worker não repete", async () => {
    const s = await conv();
    await shadowToRunning(db, [s]);
    const provider = simProvider({
      outcome: (n) =>
        n === 1
          ? { kind: "error", error: { code: "provider_unavailable", retryable: true, httpStatus: 503 }, usage: null, requestId: null }
          : { kind: "ok", text: JSON.stringify(goodDecision()), finishReason: "stop", usage: { inputTokens: 900, outputTokens: 120, totalTokens: 1020 }, requestId: "r2" },
    });
    const ctl = controller();
    const out = await runShadowWorker(candidateOf(s), worldIo([s], { db, ctl, provider }));
    const b = await budgetTotals(db);
    expect(out).toEqual({ status: "recorded", decision: "answer_candidate" });
    expect(provider.calls).toBe(2);
    expect(ctl.calls.filter((c) => c.fn === "shadow_reserve_budget")).toHaveLength(1);
    expect(b).toMatchObject({ settled_calls: 2, reservations: { settled: 1, open: 0 } });
    expect((await executions(db, s.conv))[0]!.gateway_calls).toBe(2);
    expect(await budgetLedgerConsistent(db)).toBe(true);
  }, 60_000);

  it("mensagens ADIADAS: chegam durante o processamento, sobrevivem ao complete e ao fail, e são processadas uma única vez no ciclo seguinte; o lote em FALHA nunca volta (F-05)", async () => {
    for (const ending of ["complete", "fail"] as const) {
      const s = await conv();
      const m2 = synthUuid("a3000000");
      await shadowToRunning(db, [s]);
      const failing = ending === "fail";
      // worker A processa m1; durante a chamada ao Gateway chega m2 (outro worker observa ⇒ adiada)
      const sB: ConvSpec = { ...s, msg: m2, guestMessages: [s.msg, m2] };
      let bOut: unknown = null;
      const providerA = simProvider({
        latencyMs: 30,
        during: async () => {
          bOut = await runShadowWorker(candidateOf(sB), worldIo([sB], { db, ctl: controller(), provider: simProvider() }));
        },
        ...(failing ? { outcome: () => ({ kind: "error" as const, error: { code: "auth" as const, retryable: false, httpStatus: 401 }, usage: null, requestId: null }) } : {}),
      });
      const outA = await runShadowWorker(candidateOf(s), worldIo([s], { db, ctl: controller(), provider: providerA }));
      const afterA = await leaseRow(db, s.conv);
      expect(bOut).toEqual({ status: "skipped", code: "lease_concurrency" });
      expect(afterA!.deferred).toEqual([m2]);
      expect(afterA!.state).toBe(failing ? "failed" : "completed");
      expect(outA).toMatchObject({ status: "recorded", decision: failing ? "technical_failure" : "answer_candidate" });
      // ciclo seguinte: SÓ m2 entra no lote (m1 não volta nem depois de falha: lote encerrado é selado)
      const providerC = simProvider();
      const outC = await runShadowWorker(candidateOf(sB), worldIo([sB], { db, ctl: controller(), provider: providerC }));
      const afterC = await leaseRow(db, s.conv);
      recordResult(`concurrency-deferred-${ending}`, { outA, afterA, outC, afterC });
      expect(providerC.calls).toBe(1);
      expect(afterC!.state).toBe("completed");
      expect(afterC!.processed).toContain(m2);
      expect(afterC!.processed.filter((x) => x === s.msg)).toHaveLength(1);
      if (failing) expect(afterA!.message_ids).toEqual([]);
      expect(afterC!.deferred).toEqual([]);
    }
  }, 120_000);

  it("adiadas preservadas também em cancel e expire (lease real, mesma regra do worker)", async () => {
    const L = realStores(db, controller()).leaseFor();
    for (const ending of ["cancel", "expire"] as const) {
      const s = await conv();
      const m2 = synthUuid("a3000000");
      await L.transition(s.conv, "observe", 0, { messageIds: [s.msg] });
      const r = await L.transition(s.conv, "mark_ready", 1, { messageIds: [s.msg] });
      const c = await L.claim(s.conv, r.version!);
      if (c.result !== "acquired") throw new Error("claim");
      const st = await L.transition(s.conv, "start", c.version, { ownerToken: c.ownerToken });
      expect((await L.transition(s.conv, "observe", st.version!, { messageIds: [s.msg, m2] })).result).toBe("deferred");
      if (ending === "expire") await db.sql(`update public.guest_ai_conversation_leases set lease_expires_at = now() - interval '1 second' where conversation_id = '${s.conv}'`);
      const e = await L.transition(s.conv, ending, st.version!, { ownerToken: c.ownerToken });
      expect(e.result).toBe("applied");
      const l = await leaseRow(db, s.conv);
      expect(l).toMatchObject({ state: ending === "cancel" ? "cancelled" : "expired", deferred: [m2] });
    }
  }, 60_000);

  it("F-04 · reserva ÓRFÃ (finalização sem resposta): continua contada, nunca é liberada sozinha; a reconciliação a liquida pelo PIOR CASO, uma vez só; contabilidade exata", async () => {
    const s1 = await conv();
    const s2 = await conv();
    await shadowToRunning(db, [s1, s2]);
    const ctl = controller({ faults: [{ fn: "shadow_finalize_execution", mode: "before" }] });
    const out = await runShadowWorker(candidateOf(s1), worldIo([s1, s2], { db, ctl, provider: simProvider() }));
    const after1 = await budgetTotals(db);
    await runShadowWorker(candidateOf(s2), worldIo([s1, s2], { db, ctl: controller(), provider: simProvider() }));
    const after2 = await budgetTotals(db);
    expect(out).toEqual({ status: "record_failed", decision: "answer_candidate" });
    expect(ctl.calls.filter((c) => c.fn === "shadow_finalize_execution")).toHaveLength(2); // uma repetição idempotente
    expect(await automaticTrips(db)).toEqual([]); // perda de resposta não dispara disjuntor (F-12)
    expect(after1.reservations).toMatchObject({ open: 1 });
    expect(after1.reserved_cost).toBeCloseTo(0.13072, 9);
    expect(after2.reservations).toMatchObject({ open: 1, settled: 1 });
    expect(after2.reserved_cost).toBeCloseTo(after1.reserved_cost, 9);
    // reconciliação ANTES do vencimento do lease: worker possivelmente vivo ⇒ não toca
    expect(await rpcAsSr(db, "shadow_reconcile", { p_tick_token: db.tick })).toEqual({ result: "ok", reconciled: 0 });
    await db.sql(`update public.guest_ai_conversation_leases set lease_expires_at = now() - interval '1 second' where conversation_id = '${s1.conv}'`);
    // 5 reconciliações concorrentes: exatamente UMA assume
    const recs = await Promise.all(Array.from({ length: 5 }, () => rpcAsSr(db, "shadow_reconcile", { p_tick_token: db.tick })));
    expect(recs.reduce((n, r) => n + Number(r.reconciled), 0)).toBe(1);
    const after3 = await budgetTotals(db);
    recordResult("concurrency-orphan-reservation", { out, after1, after2, after3, recs });
    expect(after3).toMatchObject({ reserved_cost: 0, open_reservations: 0, reservations: { open: 0, settled: 2 } });
    expect(after3.settled_cost).toBeCloseTo(0.13072 + 0.002325, 9);
    expect(await db.sql(`select string_agg(settlement_kind, ',' order by settlement_kind) from public.guest_ai_shadow_budget_reservations`)).toBe("actual,orphan_worst_case");
    expect(await budgetLedgerConsistent(db)).toBe(true);
  }, 60_000);

  it("F-11 · resposta da RESERVA perdida depois do commit: a repetição idempotente devolve a MESMA reserva (o Gateway é chamado uma vez); perdida duas vezes ⇒ nenhuma chamada e a reserva é liquidada a zero na finalização", async () => {
    const s = await conv();
    await shadowToRunning(db, [s]);
    const provider = simProvider();
    const ctl = controller({ faults: [{ fn: "shadow_reserve_budget", mode: "after_commit", nth: 1 }] });
    const out = await runShadowWorker(candidateOf(s), worldIo([s], { db, ctl, provider }));
    const b = await budgetTotals(db);
    expect(out).toEqual({ status: "recorded", decision: "answer_candidate" });
    expect(provider.calls).toBe(1);
    expect(summarizeCalls(ctl).filter((c) => c.startsWith("shadow_reserve_budget"))).toEqual(["shadow_reserve_budget=error:lost_after_reserved", "shadow_reserve_budget=reserved"]);
    expect(b.reservations).toMatchObject({ open: 0, settled: 1 });
    expect(await budgetLedgerConsistent(db)).toBe(true);
    const s2 = await conv();
    await shadowToRunning(db, [s2]);
    const p2 = simProvider();
    const ctl2 = controller({ faults: [{ fn: "shadow_reserve_budget", mode: "after_commit" }] });
    const out2 = await runShadowWorker(candidateOf(s2), worldIo([s2], { db, ctl: ctl2, provider: p2 }));
    const b2 = await budgetTotals(db);
    recordResult("concurrency-reserve-lost-after-commit", { out, out2, budget: b, budget2: b2, calls: summarizeCalls(ctl2) });
    expect(p2.calls).toBe(0);
    expect(out2).toEqual({ status: "recorded", decision: "budget_blocked" });
    expect(b2).toMatchObject({ reserved_cost: 0, settled_cost: 0, reservations: { open: 0, settled: 1 } });
    expect((await leaseRow(db, s2.conv))).toMatchObject({ state: "failed", message_ids: [] });
    expect(await budgetLedgerConsistent(db)).toBe(true);
  }, 60_000);

  it("teto diário APROVADO (gasto real): uso real acima da estimativa de entrada não pode levar o gasto liquidado acima do teto", async () => {
    const s0 = await conv();
    await shadowToRunning(db, [s0]);
    await runShadowWorker(candidateOf(s0), worldIo([s0], { db, ctl: controller(), provider: simProvider() }));
    const [ref] = await db.rows<{ cost: number }>(`select cost_usd::float8 cost from public.guest_ai_shadow_budget_reservations limit 1`);
    const limit = Math.round(ref!.cost * 1.5 * 1e6) / 1e6; // cabe UMA reserva de pior caso
    const s = await conv();
    await shadowToRunning(db, [s], { p_daily_cost_limit_usd: limit });
    // o provedor cobra 59 mil tokens de entrada: muito acima da estimativa (caracteres ÷ 3) usada na reserva
    const provider = simProvider({ usage: { inputTokens: 59_000, outputTokens: 1_000, totalTokens: 60_000 } });
    const out = await runShadowWorker(candidateOf(s), worldIo([s], { db, ctl: controller(), provider }));
    const b = await budgetTotals(db);
    const st = await shadowState(db);
    recordResult("budget-actual-over-estimate", { reservedWorst: ref!.cost, limit, settled: b.settled_cost, state: st.state, out, trips: await automaticTrips(db) });
    expect(ref!.cost).toBe(0.13072); // reserva = pior caso ESTRITO pelos tetos (nunca a estimativa do prompt)
    expect(provider.calls).toBe(1);
    expect(b.settled_cost).toBeLessThanOrEqual(limit + 1e-9);
    // uso real acima do teto de entrada ⇒ violação desarma o Shadow
    expect(st.state).toBe("budget_exhausted");
    expect(await automaticTrips(db)).toContainEqual({ from_state: "running", to_state: "budget_exhausted", reason_code: "token_limit_violation" });
  }, 60_000);

  it("D8 (decisão aprovada): lote com falha técnica só volta com MENSAGEM NOVA — sem mensagem nova, o ciclo seguinte não chama o Gateway de novo", async () => {
    const s = await conv();
    await shadowToRunning(db, [s]);
    const failing = () => simProvider({ outcome: () => ({ kind: "error", error: { code: "auth", retryable: false, httpStatus: 401 }, usage: null, requestId: null }) });
    const p1 = failing();
    await runShadowWorker(candidateOf(s), worldIo([s], { db, ctl: controller(), provider: p1 }));
    // reabre o estado global (o disjuntor de 2 falhas seguidas é outro mecanismo; aqui isolamos o lease)
    await db.sql(`update public.guest_ai_shadow_control set state = 'running'`);
    const p2 = failing();
    const out2 = await runShadowWorker(candidateOf(s), worldIo([s], { db, ctl: controller(), provider: p2 }));
    recordResult("concurrency-d8-retry-without-new-message", { out2, gateway2: p2.calls, lease: await leaseRow(db, s.conv), transitions: await db.rows(`select from_state, to_state, reason_code, automatic, at from public.guest_ai_shadow_transitions order by id`), executions: await executions(db) });
    expect(p2.calls).toBe(0);
    expect(out2).toEqual({ status: "skipped", code: "collector_not_ready" });
    expect(await leaseRow(db, s.conv)).toMatchObject({ state: "failed", message_ids: [] });
  }, 60_000);
});
