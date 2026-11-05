/**
 * Decisão A1 (ratificada pelo Anfitrião Sigma) — orçamento diário GLOBAL de US$ 1,00 no dia UTC.
 * Contra PostgreSQL 17.6 REAL (migrations reais: lease + Shadow + global; cada RPC numa conexão própria).
 *
 *   Cota diária esgotada     ⇒ reserva RECUSADA (`exceeded`), turno `budget_blocked`, SEM desarme (estado preservado)
 *   Próxima 0h UTC           ⇒ cota renovada sozinha (a chave do dia é `now() at time zone 'UTC'`)
 *   `over_reservation`       ⇒ DESARMA (`budget_exhausted / token_limit_violation`)
 *   `token_limit_violation`  ⇒ DESARMA
 *
 * Cenário 5 roda num cluster com o relógio do SERVIDOR deslocado por libfaketime (relógio corre de verdade e
 * cruza 23:59:59 → 00:00:00 UTC); o fuso da SESSÃO é trocado de propósito para provar que não é usado.
 * Mundo sintético; Gateway só pelo transporte falso; nenhuma rede, nenhum envio, nenhum dado real.
 */
import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runShadowWorker } from "@/lib/guest-ai/shadow-exec/worker.server";
import {
  PG176_AVAILABLE, startE3Db, controller, worldIo, convSpec, candidateOf, simProvider, shadowToRunning, shadowState, seedConversation, rpcAsSr, rpcAsAdmin,
  automaticTrips, budgetTotals, budgetLedgerConsistent, realStores, recordResult, type E3Db, type ConvSpec,
} from "./harness";
import { recordsFor } from "./e31-records";

const FAKETIME_LIB = "/usr/lib/x86_64-linux-gnu/faketime/libfaketimeMT.so.1";
const T_ID = "a1000000-0000-4000-8000-0000000000a1";
const P_ID = "a1000000-0000-4000-8000-0000000000b1";
const TODAY_UTC = `(now() at time zone 'UTC')::date`;

let db: E3Db;
const conv = (over: Partial<ConvSpec> = {}) => seedConversation(db, convSpec(over));
/** Execução EM ANDAMENTO (fixture do dono): a reserva só existe para execução reivindicada. */
async function claimedOn(d: E3Db): Promise<string> {
  const id = crypto.randomUUID();
  await d.sql(`insert into public.guest_ai_shadow_inflight (execution_id, conversation_id, tenant_id, property_id, channel, batch_id, lease_version) values ('${id}', gen_random_uuid(), '${T_ID}', '${P_ID}', 'web', gen_random_uuid(), 2)`);
  return id;
}
const claimed = () => claimedOn(db);
const reserveOn = (d: E3Db, exec: string, cost = "0.13072000", tokens = 83_072, calls = 2) =>
  rpcAsSr(d, "shadow_reserve_budget", { p_execution_id: exec, p_tokens: tokens, p_cost: cost, p_calls: calls });
const reserve = (exec: string, cost?: string) => reserveOn(db, exec, cost);
/** Gasto já LIQUIDADO no dia (fixture do dono): posiciona o consumo do dia sem simular dezenas de turnos. */
const daySpent = (d: E3Db, day: string, cost: string) =>
  d.sql(`insert into public.guest_ai_shadow_budget_days (budget_day, settled_cost, settled_calls) values (${day}, ${cost}, 1) on conflict (budget_day) do update set settled_cost = excluded.settled_cost, settled_calls = excluded.settled_calls`);
const trips = (d: E3Db) => d.sql(`select count(*) from public.guest_ai_shadow_transitions where to_state = 'budget_exhausted'`);
/** Lote pronto pelo lease real; devolve a versão. */
async function readyBatch(s: ConvSpec): Promise<number> {
  const L = realStores(db, controller()).leaseFor();
  await L.transition(s.conv, "observe", 0, { messageIds: [s.msg] });
  return (await L.transition(s.conv, "mark_ready", 1, { messageIds: [s.msg] })).version!;
}
const claimArgs = (s: ConvSpec, version: number, exec: string) => ({
  p_tick_token: db.tick, p_execution_id: exec, p_conversation_id: s.conv, p_expected_version: version, p_tenant_id: s.tenant, p_property_id: s.property, p_channel: "web",
});

describe.skipIf(!PG176_AVAILABLE)("Decisão A1 · orçamento diário UTC sem desarme (PostgreSQL 17.6 real)", () => {
  beforeAll(() => {
    db = startE3Db();
  }, 60_000);
  afterAll(() => db?.stop());

  it("ambiente: PostgreSQL 17.6; configuração aceita SÓ `UTC` como dia de orçamento", async () => {
    expect(db.pg.version).toBe("17.6");
    expect(await db.sql(`select pg_get_constraintdef(oid) from pg_constraint where conname = 'gasc_tz_ck'`)).toBe(
      "CHECK (((budget_day_timezone IS NULL) OR (budget_day_timezone = 'UTC'::text)))",
    );
    const s = await conv();
    await shadowToRunning(db, [s]);
    expect((await rpcAsSr(db, "shadow_get_control")).budget_day_timezone).toBe("UTC");
  });

  it("Cenário 1 · consumo ABAIXO do teto ⇒ reserva autorizada no dia UTC; Shadow segue running", async () => {
    const s = await conv();
    await shadowToRunning(db, [s]);
    const r = await reserve(await claimed());
    expect(r.result).toBe("reserved");
    expect(String(r.budget_day)).toBe(await db.sql(`select ${TODAY_UTC}::text`));
    expect((await shadowState(db)).state).toBe("running");
    expect(await trips(db)).toBe("0");
  });

  it("Cenário 2 · EXATAMENTE no teto: a reserva que fecha US$ 1,00 cabe; com o teto consumido, a próxima ⇒ exceeded/daily_cost; sem desarme", async () => {
    const s = await conv();
    await shadowToRunning(db, [s]);
    await daySpent(db, TODAY_UTC, "0.86928000");
    expect((await reserve(await claimed())).result).toBe("reserved"); // 0,86928 + 0,13072 = 1,00000000 (≤ teto)
    expect(await db.sql(`select (settled_cost + reserved_cost)::text from public.guest_ai_shadow_budget_days where budget_day = ${TODAY_UTC}`)).toBe("1.00000000");
    expect(await reserve(await claimed(), "0.00000001")).toEqual({ result: "exceeded", limit: "daily_cost" });
    expect((await shadowState(db)).state).toBe("running");
    expect(await trips(db)).toBe("0");
    expect(await automaticTrips(db)).toEqual([]);
  });

  it("Cenário 3 · ACIMA do teto com o worker REAL ⇒ reserva recusada, turno registrado budget_blocked, nenhuma chamada ao Gateway, Shadow segue running", async () => {
    const s = await conv();
    await shadowToRunning(db, [s]);
    await daySpent(db, TODAY_UTC, "0.95000000");
    const provider = simProvider();
    const out = await runShadowWorker(candidateOf(s), worldIo([s], { db, ctl: controller(), provider }));
    expect(out).toEqual({ status: "recorded", decision: "budget_blocked" });
    expect(provider.calls).toBe(0);
    const [rec] = await db.rows<{ decision: string; budget_exceeded: string | null; gateway_calls: number; evaluable: boolean }>(
      `select decision, budget_exceeded, gateway_calls, evaluable from public.guest_ai_shadow_executions where conversation_id = '${s.conv}'`,
    );
    expect(rec).toEqual({ decision: "budget_blocked", budget_exceeded: "daily_cost", gateway_calls: 0, evaluable: false });
    expect((await shadowState(db)).state).toBe("running");
    expect(await automaticTrips(db)).toEqual([]);
    expect(await db.sql(`select count(*) from public.guest_ai_shadow_budget_reservations`)).toBe("0");
    // estado `ready` também é preservado: uma recusa nunca transita (o banco nem reserva fora de running)
    recordResult("a1-scenario-3", { out, rec, state: await shadowState(db) });
  });

  it("Cenário 4 · VIRADA DO DIA: o dia UTC anterior esgotado não impede o dia UTC atual; a chave do dia não depende do fuso da sessão", async () => {
    const s = await conv();
    await shadowToRunning(db, [s]);
    await daySpent(db, `${TODAY_UTC} - 1`, "1.00000000");
    const today = await db.sql(`select ${TODAY_UTC}::text`);
    for (const tz of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "America/Sao_Paulo", "UTC"]) {
      const exec = await claimed();
      const out = JSON.parse(
        await db.pg.sql(`set time zone '${tz}'; select public.shadow_reserve_budget(p_execution_id => '${exec}', p_tokens => 100, p_cost => '0.01000000', p_calls => 1)`, { role: "service_role" }),
      ) as Record<string, unknown>;
      expect(out.result, tz).toBe("reserved");
      expect(String(out.budget_day), tz).toBe(today);
    }
    expect((await shadowState(db)).state).toBe("running");
  });

  it("Cenário 6 · CONCORRÊNCIA: 30 reservas simultâneas de US$ 0,05 com US$ 0,50 já gastos ⇒ exatamente 10 cabem, 20 exceeded; total ≤ US$ 1,00; sem desarme", async () => {
    const s = await conv();
    await shadowToRunning(db, [s]);
    await daySpent(db, TODAY_UTC, "0.50000000");
    const ids = await Promise.all(Array.from({ length: 30 }, () => claimed()));
    const rs = await Promise.all(ids.map((id) => reserve(id, "0.05000000")));
    expect(rs.filter((r) => r.result === "reserved")).toHaveLength(10);
    expect(rs.filter((r) => r.result === "exceeded" && r.limit === "daily_cost")).toHaveLength(20);
    expect(Number(await db.sql(`select (settled_cost + reserved_cost) from public.guest_ai_shadow_budget_days where budget_day = ${TODAY_UTC}`))).toBe(1);
    expect(await db.sql(`select count(*) from public.guest_ai_shadow_budget_reservations`)).toBe("10");
    expect((await shadowState(db)).state).toBe("running");
    expect(await trips(db)).toBe("0");
  });

  it("Cenário 6b · CONCORRÊNCIA DETERMINÍSTICA: com uma reserva AINDA ABERTA em outra transação, a segunda espera e vê o saldo real (recusa) — nunca lê o saldo antigo e estoura o teto", async () => {
    const s = await conv();
    await shadowToRunning(db, [s]);
    await daySpent(db, TODAY_UTC, "0.80000000");
    const e1 = await claimed();
    const e2 = await claimed();
    const { default: postgres } = await import("postgres");
    const holder = postgres({ path: `${db.pg.dir}/.s.PGSQL.${db.pg.port}`, user: "postgres", database: db.pg.db, max: 1, onnotice: () => {} });
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let first: unknown;
    const tx = holder.begin(async (t) => {
      await t.unsafe("set local role service_role");
      first = (await t.unsafe(`select public.shadow_reserve_budget(p_execution_id => '${e1}', p_tokens => 83072, p_cost => '0.13072000', p_calls => 2) as r`))[0]?.r;
      await held; // transação continua ABERTA: a reserva de 0,13072 ainda não foi confirmada
    });
    while (first === undefined) await new Promise((r) => setTimeout(r, 20));
    expect((first as { result: string }).result).toBe("reserved");
    let secondDone = false;
    const second = reserve(e2).then((r) => ((secondDone = true), r));
    await new Promise((r) => setTimeout(r, 600));
    expect(secondDone).toBe(false); // serializada pela trava (não leu o saldo antigo)
    release();
    await tx;
    await holder.end();
    expect(await second).toEqual({ result: "exceeded", limit: "daily_cost" }); // 0,80 + 0,13072 + 0,13072 > 1,00
    expect(Number(await db.sql(`select settled_cost + reserved_cost from public.guest_ai_shadow_budget_days where budget_day = ${TODAY_UTC}`))).toBeLessThanOrEqual(1);
    expect((await shadowState(db)).state).toBe("running");
  });

  it("Cenário 7b · FINALIZAÇÃO que fecha o dia EXATAMENTE no teto (custo real = reservado, sem over_reservation) ⇒ dia esgotado registrado, NÃO desarma; próxima reserva recusada", async () => {
    const s = await conv();
    await shadowToRunning(db, [s]);
    await daySpent(db, TODAY_UTC, "0.86928000");
    const v = await readyBatch(s);
    const exec = crypto.randomUUID();
    const c = await rpcAsSr(db, "shadow_claim_execution", claimArgs(s, v, exec));
    expect((await reserve(exec)).result).toBe("reserved");
    const rec = recordsFor({ exec, s, batchId: String(c.batch_id), version: Number(c.version), cost: "0.13072000", tokens: 60_000, calls: 1 });
    const r = await realStores(db, controller()).storeFor().finalizeExecution({
      executionId: exec, ownerToken: String(c.owner_token), outcome: "complete", settlement: { tokens: 60_000, costUsd: "0.13072000", calls: 1 }, record: rec.ok, fencedRecord: rec.fenced,
    });
    expect(r).toMatchObject({ kind: "finalized", lease: "completed" });
    expect(await db.sql(`select settled_cost::text || ':' || reserved_cost::text from public.guest_ai_shadow_budget_days where budget_day = ${TODAY_UTC}`)).toBe("1.00000000:0.00000000");
    expect((await shadowState(db)).state).toBe("running");
    expect(await automaticTrips(db)).toEqual([]);
    expect(await reserve(await claimed(), "0.00000001")).toEqual({ result: "exceeded", limit: "daily_cost" });
  });

  it("Cenário 7 · RECONCILIAÇÃO: órfã liquidada pelo pior caso esgota o dia, consumo registrado, NÃO desarma; próxima reserva recusada; repetir não reconcilia de novo", async () => {
    const s = await conv();
    await shadowToRunning(db, [s]);
    await daySpent(db, TODAY_UTC, "0.86928000");
    const exec = await claimed();
    expect((await reserve(exec)).result).toBe("reserved");
    // worker perdido (sem lease vivo): a reconciliação do tick sela, liquida pelo pior caso e registra worker_lost
    const rec = await rpcAsSr(db, "shadow_reconcile", { p_tick_token: db.tick });
    expect(rec).toMatchObject({ result: "ok", reconciled: 1 });
    expect(await db.sql(`select settled_cost::text from public.guest_ai_shadow_budget_days where budget_day = ${TODAY_UTC}`)).toBe("1.00000000");
    expect(await db.sql(`select decision || ':' || technical_code || ':' || cost_usd from public.guest_ai_shadow_executions where execution_id = '${exec}'`)).toBe(
      "technical_failure:worker_lost:0.13072000",
    );
    expect(await db.sql(`select status || ':' || settlement_kind from public.guest_ai_shadow_budget_reservations where execution_id = '${exec}'`)).toBe("settled:orphan_worst_case");
    expect((await shadowState(db)).state).toBe("running");
    expect(await trips(db)).toBe("0");
    expect(await reserve(await claimed(), "0.00000001")).toEqual({ result: "exceeded", limit: "daily_cost" });
    // idempotência: nada a reconciliar de novo (a execução recusada nunca reservou); caminho administrativo idem
    await db.sql(`delete from public.guest_ai_shadow_inflight where status = 'running'`);
    expect(await rpcAsSr(db, "shadow_reconcile", { p_tick_token: db.tick })).toEqual({ result: "ok", reconciled: 0 });
    await rpcAsSr(db, "shadow_release_tick", { p_tick_token: db.tick });
    expect(await rpcAsAdmin(db, "shadow_admin_reconcile", { p_actor: "ac000000-0000-4000-8000-000000000001" })).toEqual({ result: "ok", reconciled: 0 });
    expect((await shadowState(db)).state).toBe("running");
  });

  it("Cenário 8 · ANOMALIA: uso real ACIMA do reservado (`over_reservation`) na finalização ⇒ DESARMA budget_exhausted / token_limit_violation", async () => {
    const s = await conv();
    await shadowToRunning(db, [s]);
    const v = await readyBatch(s);
    const exec = crypto.randomUUID();
    const c = await rpcAsSr(db, "shadow_claim_execution", claimArgs(s, v, exec));
    expect((await reserve(exec)).result).toBe("reserved");
    const rec = recordsFor({ exec, s, batchId: String(c.batch_id), version: Number(c.version), cost: "0.25000000", tokens: 60_000, calls: 1 });
    const r = await realStores(db, controller()).storeFor().finalizeExecution({
      executionId: exec, ownerToken: String(c.owner_token), outcome: "complete", settlement: { tokens: 60_000, costUsd: "0.25000000", calls: 1 }, record: rec.ok, fencedRecord: rec.fenced,
    });
    expect(r).toMatchObject({ kind: "finalized", lease: "completed" });
    expect(await automaticTrips(db)).toEqual([{ from_state: "running", to_state: "budget_exhausted", reason_code: "token_limit_violation" }]);
    expect((await shadowState(db)).state).toBe("budget_exhausted");
    expect(await budgetLedgerConsistent(db)).toBe(true);
  });

  it("Cenário 9 · ANOMALIA de tokens com o worker REAL (uso acima do teto por turno) ⇒ DESARMA token_limit_violation; motivo de desarme por cota NÃO existe em nenhum caminho", async () => {
    const s = await conv();
    await shadowToRunning(db, [s]);
    const provider = simProvider({ usage: { inputTokens: 59_000, outputTokens: 1_000, totalTokens: 60_000 } });
    await runShadowWorker(candidateOf(s), worldIo([s], { db, ctl: controller(), provider }));
    expect(provider.calls).toBe(1);
    expect(await automaticTrips(db)).toContainEqual({ from_state: "running", to_state: "budget_exhausted", reason_code: "token_limit_violation" });
    expect((await shadowState(db)).state).toBe("budget_exhausted");
    // caminho indireto fechado: a RPC do worker não aceita desarmar por cota; o vocabulário do banco nem tem o motivo
    const s2 = await conv();
    await shadowToRunning(db, [s2]);
    expect(await rpcAsSr(db, "shadow_trip", { p_to: "budget_exhausted", p_reason: "budget_limit_reached" })).toEqual({ result: "invalid_argument" });
    expect((await shadowState(db)).state).toBe("running");
    expect((await db.pg.trySql(`insert into public.guest_ai_shadow_transitions (from_state, to_state, state_version, actor, automatic, reason_code) values ('running', 'budget_exhausted', 99, null, true, 'budget_limit_reached')`)).ok).toBe(false);
    expect(await rpcAsSr(db, "shadow_trip", { p_to: "budget_exhausted", p_reason: "token_limit_violation" })).toMatchObject({ result: "applied", state: "budget_exhausted" });
  });

  it("Cenário 10 · REPETIÇÃO: reserva repetida devolve a MESMA; recusa repetida continua recusa sem criar reserva; finalização repetida ⇒ duplicate; razão do dia sempre consistente", async () => {
    const s = await conv();
    await shadowToRunning(db, [s]);
    const exec = await claimed();
    const a = await reserve(exec);
    expect(await reserve(exec)).toMatchObject({ result: "reserved", reservation_id: a.reservation_id, repeated: true });
    await daySpent(db, TODAY_UTC, "0.95000000");
    const refused = await claimed();
    expect(await reserve(refused)).toEqual({ result: "exceeded", limit: "daily_cost" });
    expect(await reserve(refused)).toEqual({ result: "exceeded", limit: "daily_cost" });
    expect(await db.sql(`select count(*) from public.guest_ai_shadow_budget_reservations where execution_id = '${refused}'`)).toBe("0");
    expect(await db.sql(`select count(*)::text || ':' || (select open_reservations from public.guest_ai_shadow_budget_days where budget_day = ${TODAY_UTC}) from public.guest_ai_shadow_budget_reservations where status = 'open'`)).toBe("1:1");
    // finalização real repetida (resposta perdida): a segunda é `duplicate`, nada liquida duas vezes
    const s2 = await conv();
    await shadowToRunning(db, [s2]);
    const v = await readyBatch(s2);
    const ex2 = crypto.randomUUID();
    const c = await rpcAsSr(db, "shadow_claim_execution", claimArgs(s2, v, ex2));
    await reserve(ex2);
    const rec = recordsFor({ exec: ex2, s: s2, batchId: String(c.batch_id), version: Number(c.version), cost: "0.01000000", tokens: 1_000, calls: 1 });
    const fin = () => realStores(db, controller()).storeFor().finalizeExecution({
      executionId: ex2, ownerToken: String(c.owner_token), outcome: "complete", settlement: { tokens: 1_000, costUsd: "0.01000000", calls: 1 }, record: rec.ok, fencedRecord: rec.fenced,
    });
    expect(await fin()).toMatchObject({ kind: "finalized" });
    expect((await fin()).kind).toBe("duplicate");
    expect(await budgetTotals(db)).toMatchObject({ reservations: { open: 0, settled: 1 } });
    expect(await budgetLedgerConsistent(db)).toBe(true);
    expect((await shadowState(db)).state).toBe("running");
  });
});

describe.skipIf(!PG176_AVAILABLE || !existsSync(FAKETIME_LIB))("Decisão A1 · Cenário 5 · 23:59:59 → 00:00:00 UTC com relógio REAL deslocado (libfaketime)", () => {
  let fdb: E3Db;
  beforeAll(() => {
    fdb = startE3Db({
      env: { LD_PRELOAD: FAKETIME_LIB, FAKETIME: "@2026-11-05 23:59:20", FAKETIME_DONT_RESET: "1", FAKETIME_NO_CACHE: "1", DONT_FAKE_MONOTONIC: "1", TZ: "UTC" },
    });
  }, 60_000);
  afterAll(() => fdb?.stop());

  it("antes da meia-noite UTC o dia é 05/11 (mesmo com sessão em Tóquio, onde já é 06/11); depois dela a cota renova sozinha (mesmo com sessão em São Paulo, onde ainda é 05/11)", async () => {
    const c0 = await fdb.sql(`select now() at time zone 'UTC'`);
    expect(c0.startsWith("2026-11-05 23:59:")).toBe(true);
    const s = convSpec();
    await seedConversation(fdb, s);
    await shadowToRunning(fdb, [s]);
    await daySpent(fdb, `date '2026-11-05'`, "0.95000000");
    // aguarda chegar perto da virada, ainda ANTES dela
    while ((await fdb.sql(`select (now() at time zone 'UTC') < timestamp '2026-11-05 23:59:58'`)) === "t") await new Promise((r) => setTimeout(r, 200));
    const pre = await claimedOn(fdb);
    const before = JSON.parse(
      await fdb.pg.sql(`set time zone 'Asia/Tokyo'; select json_build_object('r', public.shadow_reserve_budget(p_execution_id => '${pre}', p_tokens => 83072, p_cost => '0.13072000', p_calls => 2), 'utc', (now() at time zone 'UTC')::text, 'local', now()::text)`, { role: "service_role" }),
    ) as { r: Record<string, unknown>; utc: string; local: string };
    expect(before.utc < "2026-11-06").toBe(true); // ainda 05/11 em UTC…
    expect(before.local.startsWith("2026-11-06")).toBe(true); // …mas já 06/11 no fuso da sessão
    expect(before.r).toEqual({ result: "exceeded", limit: "daily_cost" }); // o dia usado foi o UTC (05/11, esgotado)
    expect((await shadowState(fdb)).state).toBe("running");
    // cruza 00:00:00 UTC de verdade
    while ((await fdb.sql(`select (now() at time zone 'UTC') < timestamp '2026-11-06 00:00:00.300'`)) === "t") await new Promise((r) => setTimeout(r, 200));
    const post = await claimedOn(fdb);
    const after = JSON.parse(
      await fdb.pg.sql(`set time zone 'America/Sao_Paulo'; select json_build_object('r', public.shadow_reserve_budget(p_execution_id => '${post}', p_tokens => 83072, p_cost => '0.13072000', p_calls => 2), 'utc', (now() at time zone 'UTC')::text, 'local', now()::text)`, { role: "service_role" }),
    ) as { r: Record<string, unknown>; utc: string; local: string };
    expect(after.utc.startsWith("2026-11-06 00:00:")).toBe(true);
    expect(after.local.startsWith("2026-11-05 21:00:")).toBe(true); // na sessão ainda é 05/11
    expect(after.r.result).toBe("reserved");
    expect(String(after.r.budget_day)).toBe("2026-11-06"); // cota renovada no dia UTC novo
    expect((await shadowState(fdb)).state).toBe("running");
    expect(await fdb.sql(`select count(*) from public.guest_ai_shadow_transitions where to_state = 'budget_exhausted'`)).toBe("0");
    recordResult("a1-scenario-5-midnight", { c0, before, after });
  }, 90_000);
});
