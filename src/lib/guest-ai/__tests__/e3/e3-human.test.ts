/**
 * B3.3 · E3 — Fase 5: SOBERANIA HUMANA com PostgreSQL 17.6 real (lease, orçamento e registro reais;
 * leitura de pausa/posse sintética e controlável em qualquer ponto do fluxo).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runShadowWorker } from "@/lib/guest-ai/shadow-exec/worker.server";
import { v4 } from "../helpers/b23-chain";
const goodDecisionWith = (over: Record<string, unknown>) => v4({ reply: "O check-in começa às 15h.", groundedOn: ["ctx:checkin_oficial"], ...over });
import type { OwnershipLoad } from "@/lib/guest-ai/data/conversation-ownership.server";
import {
  PG176_AVAILABLE, startE3Db, controller, worldIo, convSpec, candidateOf, simProvider, shadowToRunning, shadowState, seedConversation, leaseRow, executions,
  realStores, recordResult, summarizeCalls, synthUuid, type E3Db, type ConvSpec, type HumanState,
} from "./harness";

let db: E3Db;
const conv = (over: Partial<ConvSpec> = {}) => seedConversation(db, convSpec(over));
const paused = (p: HumanState["pause"]): HumanState["pause"] => ({ ...p, column: { ai_paused: true, paused_until: null } });

describe.skipIf(!PG176_AVAILABLE)("E3 · Fase 5 — soberania humana (PostgreSQL 17.6 real)", () => {
  beforeAll(() => {
    db = startE3Db();
  }, 60_000);
  afterAll(() => db?.stop());

  const OWNERSHIP: Array<{ st: OwnershipLoad["status"]; decision: string; lease: string; gateway: number; global: string }> = [
    { st: "none", decision: "answer_candidate", lease: "completed", gateway: 1, global: "running" },
    { st: "identified", decision: "answer_candidate", lease: "completed", gateway: 1, global: "running" },
    { st: "indeterminate", decision: "operational_restriction", lease: "failed", gateway: 0, global: "running" },
    { st: "read_failed", decision: "technical_failure", lease: "failed", gateway: 0, global: "running" },
    { st: "tenant_mismatch", decision: "integrity_violation", lease: "failed", gateway: 0, global: "integrity_violation" },
    { st: "property_mismatch", decision: "integrity_violation", lease: "failed", gateway: 0, global: "integrity_violation" },
    { st: "identity_inconsistent", decision: "integrity_violation", lease: "failed", gateway: 0, global: "integrity_violation" },
  ];
  for (const c of OWNERSHIP) {
    it(`posse humana "${c.st}" ⇒ ${c.decision}; lease ${c.lease}; Gateway ${c.gateway}; estado global ${c.global}`, async () => {
      const s = await conv();
      s.human.ownership = c.st;
      await shadowToRunning(db, [s]);
      // com chamado aberto, o modelo declara o assunto como independente (senão a cadeia recusa, corretamente)
      const provider = c.st === "identified" ? simProvider({ outcome: () => ({ kind: "ok", text: JSON.stringify(goodDecisionWith({ caseRelation: "independent" })), finishReason: "stop", usage: { inputTokens: 900, outputTokens: 120, totalTokens: 1020 }, requestId: "r" }) }) : simProvider();
      const out = await runShadowWorker(candidateOf(s), worldIo([s], { db, ctl: controller(), provider }));
      const l = await leaseRow(db, s.conv);
      const st = await shadowState(db);
      recordResult(`human-ownership-${c.st}`, { out, lease: l?.state, gateway: provider.calls, global: st.state });
      expect(out).toEqual({ status: "recorded", decision: c.decision });
      expect(provider.calls).toBe(c.gateway);
      expect(l!.state).toBe(c.lease);
      expect(st.state).toBe(c.global);
    }, 60_000);
  }

  it("pausa ANTES da execução: bloqueio sem lease, sem orçamento e sem Gateway", async () => {
    const s = await conv();
    s.human.pause = paused(s.human.pause);
    await shadowToRunning(db, [s]);
    const provider = simProvider();
    const ctl = controller();
    const out = await runShadowWorker(candidateOf(s), worldIo([s], { db, ctl, provider }));
    expect(out).toEqual({ status: "recorded", decision: "human_pause_active" });
    expect(provider.calls).toBe(0);
    expect(await leaseRow(db, s.conv)).toBeNull();
    expect(ctl.calls.map((c) => c.fn)).not.toContain("shadow_reserve_budget");
    expect((await executions(db, s.conv))[0]).toMatchObject({ block_code: "pause_indefinite" });
  }, 60_000);

  it("pausa que surge DEPOIS do claim (entre a 1ª e a 2ª leitura): bloqueio sem Gateway; lote concluído (D8: a equipe assumiu)", async () => {
    const s = await conv();
    await shadowToRunning(db, [s]);
    let reads = 0;
    const provider = simProvider();
    const out = await runShadowWorker(
      candidateOf(s),
      worldIo([s], { db, ctl: controller(), provider, hooks: { at: (p, sp) => { if (p === "pause1" && ++reads === 2) sp.human.pause = paused(sp.human.pause); } } }),
    );
    expect(out).toEqual({ status: "recorded", decision: "human_pause_active" });
    expect(provider.calls).toBe(0);
    expect((await leaseRow(db, s.conv))!.state).toBe("completed");
  }, 60_000);

  it("posse humana que surge DURANTE a chamada ao Gateway prevalece: o resultado não vira resposta candidata", async () => {
    const s = await conv();
    await shadowToRunning(db, [s]);
    const provider = simProvider({ during: () => { s.human.pause = paused(s.human.pause); s.human.ownership = "identified"; } });
    const out = await runShadowWorker(candidateOf(s), worldIo([s], { db, ctl: controller(), provider }));
    recordResult("human-intervention-during-gateway", { out, lease: (await leaseRow(db, s.conv))?.state });
    expect(out).not.toEqual({ status: "recorded", decision: "answer_candidate" });
  }, 60_000);

  it("pausa DEPOIS da execução: o lote concluído não é reprocessado; o ciclo seguinte bloqueia", async () => {
    const s = await conv();
    await shadowToRunning(db, [s]);
    const p1 = simProvider();
    await runShadowWorker(candidateOf(s), worldIo([s], { db, ctl: controller(), provider: p1 }));
    s.human.pause = paused(s.human.pause);
    const p2 = simProvider();
    const out2 = await runShadowWorker(candidateOf(s), worldIo([s], { db, ctl: controller(), provider: p2 }));
    expect(p1.calls + p2.calls).toBe(1);
    expect(out2).toEqual({ status: "recorded", decision: "human_pause_active" });
    expect((await leaseRow(db, s.conv))!.state).toBe("completed");
  }, 60_000);

  it("retomada: a equipe devolveu a conversa (coluna limpa) ⇒ a IA volta a avaliar", async () => {
    const s = await conv();
    s.human.pause = { ...s.human.pause, column: { ai_paused: false, paused_until: null } };
    await shadowToRunning(db, [s]);
    const provider = simProvider();
    const out = await runShadowWorker(candidateOf(s), worldIo([s], { db, ctl: controller(), provider }));
    expect(out).toEqual({ status: "recorded", decision: "answer_candidate" });
    expect(provider.calls).toBe(1);
  }, 60_000);

  it("DIVERGÊNCIA documentada: coluna `ai_paused=true` com prazo VENCIDO — o Shadow trata como pausa indeterminada (mais restritivo que `isPausedNow` do produto)", async () => {
    const s = await conv();
    s.human.pause = { ...s.human.pause, column: { ai_paused: true, paused_until: "2026-01-01T00:00:00Z" as never } };
    await shadowToRunning(db, [s]);
    const provider = simProvider();
    const out = await runShadowWorker(candidateOf(s), worldIo([s], { db, ctl: controller(), provider }));
    recordResult("human-expired-column-divergence", { out });
    // comportamento observado (fail-safe): bloqueia; a regra do produto (chat/pause.ts) diria "pausa vencida"
    expect(out).toEqual({ status: "recorded", decision: "human_pause_active" });
    expect((await executions(db, s.conv))[0]).toMatchObject({ block_code: "pause_indefinite" });
    expect(provider.calls).toBe(0);
  }, 60_000);

  it("acknowledge: mensagens respondidas pela equipe saem explicitamente; 5 workers concorrentes ⇒ um acknowledge aplicado, uma execução, só a mensagem nova vai ao lote", async () => {
    const s = await conv();
    const answered = synthUuid("a3000000");
    await shadowToRunning(db, [s]);
    const L = realStores(db, controller()).leaseFor();
    // a mensagem `answered` ficou pendente no lease; depois a equipe respondeu (a cauda do coletor já não a traz)
    expect((await L.transition(s.conv, "observe", 0, { messageIds: [answered] })).result).toBe("applied");
    const provider = simProvider({ latencyMs: 100 });
    const ctls = Array.from({ length: 5 }, () => controller());
    const outs = await Promise.all(ctls.map((ctl) => runShadowWorker(candidateOf(s), worldIo([s], { db, ctl, provider }))));
    const acks = ctls.flatMap((c) => c.calls.filter((x) => x.event === "acknowledge"));
    const l = await leaseRow(db, s.conv);
    recordResult("human-acknowledge-concurrent", { outs, acks: acks.map((a) => a.outcome), lease: l, gateway: provider.calls });
    expect(acks.filter((a) => a.outcome === "applied")).toHaveLength(1);
    expect(provider.calls).toBe(1);
    expect(outs.filter((o) => o.status === "recorded")).toHaveLength(1);
    expect(l!.state).toBe("completed");
    expect(l!.processed).toEqual(expect.arrayContaining([answered, s.msg]));
    expect(l!.message_ids).toEqual([s.msg]); // o lote avaliado contém só a mensagem posterior à resposta da equipe
  }, 60_000);

  it("processo OBSOLETO não desfaz decisão humana: snapshot antigo do lease depois de um acknowledge ⇒ CAS recusa", async () => {
    const s = await conv();
    const L = realStores(db, controller()).leaseFor();
    const old = synthUuid("a3000000");
    await L.transition(s.conv, "observe", 0, { messageIds: [old, s.msg] });
    const stale = await L.load(s.conv); // processo obsoleto leu aqui
    expect((await L.transition(s.conv, "acknowledge", stale!.version, { messageIds: [old] })).result).toBe("applied");
    // o obsoleto tenta fechar o lote com a mensagem já dispensada pela equipe
    const r = await L.transition(s.conv, "mark_ready", stale!.version, { messageIds: [old, s.msg] });
    expect(r.result).toBe("stale_version");
    const l = await leaseRow(db, s.conv);
    expect(l!.processed).toContain(old);
    expect(l!.message_ids).toEqual([s.msg]);
  }, 60_000);

  it("pausa ilegível (falha de leitura) nunca é tratada como ausência de pausa", async () => {
    const s = await conv();
    s.human.readFails = true;
    await shadowToRunning(db, [s]);
    const provider = simProvider();
    const out = await runShadowWorker(candidateOf(s), worldIo([s], { db, ctl: controller(), provider }));
    expect(out).toEqual({ status: "recorded", decision: "technical_failure" });
    expect(provider.calls).toBe(0);
    expect(summarizeCalls(controller())).toEqual([]);
  }, 60_000);
});
