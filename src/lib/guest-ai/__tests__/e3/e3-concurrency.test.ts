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
  seedConversation, leaseRow, executions, realStores, recordResult, summarizeCalls, synthUuid, goodDecision, type E3Db, type ConvSpec,
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

  it("10 conversas diferentes do MESMO imóvel, 10 workers em paralelo ⇒ 10 execuções independentes, contabilidade exata", async () => {
    const specs = await Promise.all(Array.from({ length: 10 }, () => conv()));
    await shadowToRunning(db, specs);
    const provider = simProvider({ latencyMs: 100 });
    const outs = await Promise.all(specs.map((s) => runShadowWorker(candidateOf(s), worldIo(specs, { db, ctl: controller(), provider }))));
    const ex = await executions(db);
    const b = await budgetTotals(db);
    recordResult("concurrency-10-convs", { outs, executions: ex.length, gateway: provider.calls, budget: b });
    expect(outs.every((o) => o.status === "recorded" && o.decision === "answer_candidate")).toBe(true);
    expect(provider.calls).toBe(10);
    expect(new Set(ex.map((e) => e.conversation_id))).toEqual(new Set(specs.map((s) => s.conv)));
    expect(b).toMatchObject({ settled_calls: 10, reserved_calls: 0, open_reservations: 0, reservations: { settled: 10, open: 0 } });
    expect(b.settled_cost).toBeCloseTo(10 * 0.002325, 9);
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
    await shadowToRunning(db, specs, { p_daily_cost_limit_usd: limit, p_max_turn_cost_usd: 0.5 });
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

  it("CRÍTICO · worker MORTO depois do start: depois do vencimento do lease, um NOVO worker recupera o lote e o processa", async () => {
    const s = await conv();
    await shadowToRunning(db, [s]);
    // QUEDA do processo: o banco fica exatamente como um worker morto o deixaria — lote reivindicado,
    // `start` aplicado, reserva aberta — e nenhum processo continua vivo para finalizar (simulação fiel:
    // um worker "lento" ainda acordaria pelo próprio prazo e gravaria; isso é coberto pelo cenário do obsoleto)
    const st = realStores(db, controller());
    const L = st.leaseFor();
    await L.transition(s.conv, "observe", 0, { messageIds: [s.msg] });
    const mr = await L.transition(s.conv, "mark_ready", 1, { messageIds: [s.msg] });
    const c = await L.claim(s.conv, mr.version!);
    if (c.result !== "acquired") throw new Error("claim");
    await L.transition(s.conv, "start", c.version, { ownerToken: c.ownerToken });
    expect((await st.storeFor().reserve(crypto.randomUUID(), { tokens: 1000, costUsd: 0.01, calls: 2 })).kind).toBe("reserved");
    expect((await leaseRow(db, s.conv))!.state).toBe("processing");
    // o prazo do lease vence pelo relógio do BANCO (fixture: dono da tabela)
    await db.sql(`update public.guest_ai_conversation_leases set lease_expires_at = now() - interval '1 second' where conversation_id = '${s.conv}'`);
    const ctl = controller();
    const provider = simProvider();
    const out = await runShadowWorker(candidateOf(s), worldIo([s], { db, ctl, provider }));
    const l = await leaseRow(db, s.conv);
    recordResult("concurrency-crash-recovery", { out, calls: summarizeCalls(ctl), lease: l, gateway: provider.calls });
    expect(out).toEqual({ status: "recorded", decision: "answer_candidate" });
    expect(provider.calls).toBe(1);
    expect(l!.state).toBe("completed");
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
    // a finalização do obsoleto foi recusada pelo banco (versão/token), sem tocar no lease do novo dono
    expect(summarizeCalls(ctl)).toContain("transition_conversation_lease:complete=stale_version");
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

  it("mensagens ADIADAS: chegam durante o processamento, sobrevivem ao complete e ao fail, e são processadas uma única vez no ciclo seguinte", async () => {
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
      // ciclo seguinte: m2 entra no lote (m1 só volta se o lote anterior falhou)
      const providerC = simProvider();
      const outC = await runShadowWorker(candidateOf(sB), worldIo([sB], { db, ctl: controller(), provider: providerC }));
      const afterC = await leaseRow(db, s.conv);
      recordResult(`concurrency-deferred-${ending}`, { outA, afterA, outC, afterC });
      expect(providerC.calls).toBe(1);
      expect(afterC!.state).toBe("completed");
      expect(afterC!.processed).toContain(m2);
      if (!failing) expect(afterC!.processed.filter((x) => x === s.msg)).toHaveLength(1);
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

  it("reserva ÓRFÃ (liquidação falhou): continua contada no dia, nunca é liberada sozinha; contabilidade continua exata", async () => {
    const s1 = await conv();
    const s2 = await conv();
    await shadowToRunning(db, [s1, s2]);
    const ctl = controller({ faults: [{ fn: "shadow_settle_budget", mode: "before" }] });
    const out = await runShadowWorker(candidateOf(s1), worldIo([s1, s2], { db, ctl, provider: simProvider() }));
    const after1 = await budgetTotals(db);
    await runShadowWorker(candidateOf(s2), worldIo([s1, s2], { db, ctl: controller(), provider: simProvider() }));
    const after2 = await budgetTotals(db);
    recordResult("concurrency-orphan-reservation", { out, after1, after2 });
    expect(after1.reservations).toMatchObject({ open: 1 });
    expect(after1.reserved_cost).toBeGreaterThan(0);
    expect(after2.reservations).toMatchObject({ open: 1, settled: 1 });
    expect(after2.reserved_cost).toBeCloseTo(after1.reserved_cost, 9);
    expect(await budgetLedgerConsistent(db)).toBe(true);
  }, 60_000);

  it("resposta da RESERVA perdida depois do commit: worker não chama o Gateway; a reserva confirmada fica contada (conservador)", async () => {
    const s = await conv();
    await shadowToRunning(db, [s]);
    const provider = simProvider();
    const ctl = controller({ faults: [{ fn: "shadow_reserve_budget", mode: "after_commit" }] });
    const out = await runShadowWorker(candidateOf(s), worldIo([s], { db, ctl, provider }));
    const b = await budgetTotals(db);
    expect(provider.calls).toBe(0);
    expect(out).toEqual({ status: "recorded", decision: "budget_blocked" });
    expect(b.reservations).toMatchObject({ open: 1 });
    expect((await leaseRow(db, s.conv))!.state).toBe("failed");
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
    recordResult("budget-actual-over-estimate", { reservedWorst: ref!.cost, limit, settled: b.settled_cost, state: st.state, out });
    expect(provider.calls).toBe(1);
    expect(b.settled_cost).toBeLessThanOrEqual(limit + 1e-9);
  }, 60_000);

  it("D8 (decisão aprovada): lote com falha técnica só volta com MENSAGEM NOVA — sem mensagem nova, o ciclo seguinte não chama o Gateway de novo", async () => {
    const s = await conv();
    await shadowToRunning(db, [s], { p_error_min_sample: 50 });
    const failing = () => simProvider({ outcome: () => ({ kind: "error", error: { code: "auth", retryable: false, httpStatus: 401 }, usage: null, requestId: null }) });
    const p1 = failing();
    await runShadowWorker(candidateOf(s), worldIo([s], { db, ctl: controller(), provider: p1 }));
    // reabre o estado global (o disjuntor de 2 falhas seguidas é outro mecanismo; aqui isolamos o lease)
    await db.sql(`update public.guest_ai_shadow_control set state = 'running'`);
    const p2 = failing();
    const out2 = await runShadowWorker(candidateOf(s), worldIo([s], { db, ctl: controller(), provider: p2 }));
    recordResult("concurrency-d8-retry-without-new-message", { out2, gateway2: p2.calls, lease: await leaseRow(db, s.conv), transitions: await db.rows(`select from_state, to_state, reason_code, automatic, at from public.guest_ai_shadow_transitions order by id`), executions: await executions(db) });
    expect(p2.calls).toBe(0);
  }, 60_000);
});
