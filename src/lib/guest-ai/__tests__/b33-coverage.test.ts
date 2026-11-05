/**
 * B3.3 · Entrega 2 — caminhos restantes (cobertura integral dos módulos críticos): cada ramo do lease
 * no worker com respostas roteirizadas, prazo esgotado em cada fase, registro inválido, ligação de
 * produção do worker e do tick (cada loader recebe o banco e o SINAL da execução), adaptador e projeção.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DistributedLeaseStore, StoreClaimResult, StoreTransitionResult } from "@/lib/guest-ai/batch/lease";
import { runShadowWorker } from "@/lib/guest-ai/shadow-exec/worker.server";
import { handleShadowTick } from "@/lib/guest-ai/shadow-exec/tick.server";
import { narrowOutcome, buildExecutionRecord, NO_GATEWAY } from "@/lib/guest-ai/shadow-exec/extract";
import { createShadowStore, parseCandidates } from "@/lib/guest-ai/data/shadow-store.server";
import { listShadowCandidates } from "@/lib/guest-ai/data/shadow-candidates.server";
import { SHADOW_DEADLINE_MS, SHADOW_FINALIZATION_RESERVE_MS } from "@/lib/guest-ai/shadow-exec/contracts";
import type { ChainOutcome } from "@/lib/guest-ai/turn-chain";
import { v4, history } from "./helpers/b23-chain";
import { operationalPorts, staySource } from "./helpers/b25-fixtures";
import { conversationContext } from "./helpers/b21-fixtures";
import { fakeDb } from "./helpers/b3-fake-db";
import { CANARY, CONV, EXEC_ID, MSG, MemoryShadowStore, ModelLeaseStore, candidateRow, OTHER_T, P_ID, T0, T_ID, benignPause, candidate, fakeProvider, makeIo, okJson, shadowCtx, shadowTurn } from "./helpers/b33-shadow";

afterEach(() => {
  vi.doUnmock("@/integrations/supabase/client.server");
  vi.restoreAllMocks();
});

const good = () => okJson(v4({ reply: `O check-in começa às 15h. ${CANARY}`, groundedOn: ["ctx:checkin_oficial"] }));

/** Lease roteirizado: o modelo B3.1 por padrão; eventos/claim/load podem ser sobrescritos um a um. */
class ScriptLease implements DistributedLeaseStore {
  readonly guarantee = "postgres_transactional_row_lock" as const;
  readonly inner = new ModelLeaseStore(() => new Date(T0).toISOString());
  over: Partial<Record<string, (n: number) => StoreTransitionResult | undefined>> = {};
  claimOver: ((r: StoreClaimResult) => StoreClaimResult) | null = null;
  loadOver: ((n: number) => unknown) | null = null;
  private loads = 0;
  private counts: Record<string, number> = {};
  async load(c: string) {
    this.loads++;
    const o = this.loadOver?.(this.loads);
    if (o === "throw") throw new Error(CANARY);
    if (o !== undefined) return o as never;
    return this.inner.load(c);
  }
  async claim(c: string, v: number) {
    const r = await this.inner.claim(c, v);
    return this.claimOver ? this.claimOver(r) : r;
  }
  async transition(c: string, e: string, v: number, o: Record<string, unknown> = {}) {
    this.counts[e] = (this.counts[e] ?? 0) + 1;
    const f = this.over[e]?.(this.counts[e]!);
    if (f) return f;
    return this.inner.transition(c, e, v, o as never);
  }
}

describe("B3.3 · worker × lease: cada resposta do B3.1 tem destino fechado", () => {
  const run = async (setup: (l: ScriptLease) => unknown, extra: Partial<Parameters<typeof makeIo>[0]> = {}) => {
    const lease = new ScriptLease();
    await setup(lease);
    const provider = fakeProvider(good());
    const { io, store } = makeIo({ lease: lease as never, provider, ...extra });
    const r = await runShadowWorker(candidate(), io);
    return { r, store, provider, lease };
  };
  it("observe adiado/versão obsoleta ⇒ concorrência; estouro ⇒ overflow; outro resultado ⇒ integridade do lease", async () => {
    expect((await run((l) => (l.over.observe = () => ({ result: "deferred", version: 1, state: "claimed" })))).r).toEqual({ status: "skipped", code: "lease_concurrency" });
    expect((await run((l) => (l.over.observe = () => ({ result: "stale_version", version: 3 })))).r).toEqual({ status: "skipped", code: "lease_concurrency" });
    expect((await run((l) => (l.over.observe = () => ({ result: "pending_overflow", version: 3 })))).r).toEqual({ status: "skipped", code: "lease_overflow" });
    const x = await run((l) => (l.over.observe = () => ({ result: "store_error", version: null })));
    expect(x.r).toEqual({ status: "recorded", decision: "technical_failure" });
    expect(x.store.records[0]!.technicalCode).toBe("lease_integrity_failure");
  });
  it("releitura do lease depois do observe falha ⇒ integridade do lease; de outra conversa ⇒ integridade GLOBAL", async () => {
    expect((await run((l) => (l.loadOver = (n) => (n === 2 ? "throw" : undefined)))).store.records[0]!.technicalCode).toBe("lease_integrity_failure");
    expect((await run((l) => (l.loadOver = (n) => (n === 2 ? null : undefined)))).store.records[0]!.technicalCode).toBe("lease_integrity_failure");
    const other = await run((l) => (l.loadOver = (n) => (n === 2 ? { conversationId: "99999999-9999-4999-8999-999999999999", state: "collecting", version: 1, batchId: null, messageIds: [MSG], deferredMessageIds: [], attempts: 0, leaseExpiresAt: null } : undefined)));
    expect(other.r).toEqual({ status: "recorded", decision: "integrity_violation" });
    expect(other.store.records[0]!.integrityCode).toBe("lease_conversation_mismatch");
    expect(other.store.trips).toEqual([{ to: "integrity_violation", reason: "integrity_divergence" }]);
  });
  it("lease já concluído/falhado depois do observe ⇒ nada pendente", async () => {
    const r = await run((l) => (l.loadOver = (n) => (n === 2 ? { conversationId: CONV, state: "failed", version: 4, batchId: null, messageIds: [MSG], deferredMessageIds: [], attempts: 1, leaseExpiresAt: null } : undefined)));
    expect(r.r).toEqual({ status: "skipped", code: "collector_not_ready" });
  });
  it("pendente anterior à resposta da equipe com lote pronto (não em coleta) ⇒ concorrência; acknowledge recusado ⇒ concorrência; releitura falha ⇒ integridade", async () => {
    const OLD = "22222222-2222-4222-8222-2222222222a1";
    const snap = (state: string) => ({ conversationId: CONV, state, version: 2, batchId: null, messageIds: [MSG, OLD], deferredMessageIds: [], attempts: 0, leaseExpiresAt: null });
    expect((await run((l) => (l.loadOver = (n) => (n === 2 ? snap("ready") : undefined)))).r).toEqual({ status: "skipped", code: "lease_concurrency" });
    expect((await run((l) => { l.loadOver = (n) => (n === 2 ? snap("collecting") : undefined); l.over.acknowledge = () => ({ result: "invalid_transition", version: 2 }); })).r).toEqual({ status: "skipped", code: "lease_concurrency" });
    const f = await run((l) => { l.loadOver = (n) => (n === 2 ? snap("collecting") : n === 3 ? "throw" : undefined); l.over.acknowledge = () => ({ result: "applied", version: 3, state: "collecting" }); });
    expect(f.store.records[0]!.technicalCode).toBe("lease_integrity_failure");
  });
  it("mensagens já respondidas e reavaliação do coletor que não fica pronta ⇒ nada", async () => {
    const r = await run((l) => (l.loadOver = (n) => (n === 2 ? { conversationId: CONV, state: "collecting", version: 2, batchId: null, messageIds: [], deferredMessageIds: [], attempts: 0, leaseExpiresAt: null } : undefined)));
    expect(r.r).toEqual({ status: "skipped", code: "collector_not_ready" });
  });
  it("mark_ready recusado ⇒ concorrência; lote pronto diferente ⇒ concorrência; lote pronto igual ⇒ segue sem mark_ready", async () => {
    expect((await run((l) => (l.over.mark_ready = () => ({ result: "stale_version", version: 9 })))).r).toEqual({ status: "skipped", code: "lease_concurrency" });
    const ready = (ids: string[]) => ({ conversationId: CONV, state: "ready", version: 2, batchId: "b0000000-0000-4000-8000-000000000001", messageIds: ids, deferredMessageIds: [], attempts: 0, leaseExpiresAt: null });
    const same = await run(async (l) => {
      await l.inner.transition(CONV, "observe", 0, { messageIds: [MSG] });
      await l.inner.transition(CONV, "mark_ready", 1, { messageIds: [MSG] });
    });
    expect(same.r).toEqual({ status: "recorded", decision: "answer_candidate" });
    expect(same.lease.inner.events).not.toContain("mark_ready_again");
    const wrong = await run((l) => { l.loadOver = (n) => (n === 2 ? ready(["22222222-2222-4222-8222-2222222222c3", MSG]) : undefined); });
    expect(wrong.r.status).toBe("skipped");
    // pronto, mas a mensagem do lote ficou só como adiada ⇒ lote pronto ≠ lote avaliado ⇒ concorrência
    const subset = await run((l) => { l.loadOver = (n) => (n === 2 ? { ...ready([]), deferredMessageIds: [MSG] } : undefined); });
    expect(subset.r).toEqual({ status: "skipped", code: "lease_concurrency" });
  });
  it("reivindicação recusada ⇒ concorrência; lote reivindicado diferente ⇒ falha selada com lease_integrity_failure", async () => {
    expect((await run((l) => (l.claimOver = () => ({ result: "conflict", version: 3 })))).r).toEqual({ status: "skipped", code: "lease_concurrency" });
    const m = await run((l) => (l.claimOver = (r) => ({ ...(r as Extract<StoreClaimResult, { ownerToken: string }>), messageIds: ["22222222-2222-4222-8222-2222222222c3"] })));
    expect(m.store.records[0]).toMatchObject({ technicalCode: "lease_integrity_failure" });
    expect(m.store.records[0]!.batchId).not.toBeNull();
    expect(m.store.finalizations[0]!.outcome).toBe("fail");
    expect(m.provider.calls).toBe(0);
  });
  it("E3.1 · cada resposta de `shadow_claim_execution` tem destino fechado (trava do tick, estado, rejeições, resposta perdida)", async () => {
    const withClaim = async (impl: (n: number) => Awaited<ReturnType<MemoryShadowStore["claimExecution"]>> | "real", extra: Partial<Parameters<typeof makeIo>[0]> = {}) => {
      const store = new MemoryShadowStore();
      const real = store.claimExecution.bind(store);
      let n = 0;
      store.claimExecution = async (a) => {
        const r = impl(++n);
        return r === "real" ? real(a) : r;
      };
      const provider = fakeProvider(good());
      const { io } = makeIo({ store, provider, ...extra });
      return { r: await runShadowWorker(candidate(), io), n: () => n, provider, store };
    };
    expect((await withClaim(() => ({ kind: "rejected", code: "tick_not_held" }))).r).toEqual({ status: "skipped", code: "tick_not_held" });
    expect((await withClaim(() => ({ kind: "rejected", code: "state_not_running" }))).r).toEqual({ status: "skipped", code: "state_not_running" });
    // E4 global: o banco recusou a reivindicação porque o imóvel deixou de estar ativo ⇒ pulado (nada executa)
    for (const reason of ["scope_off", "property_disabled", "tenant_disabled", "archived"] as const) expect((await withClaim(() => ({ kind: "property_blocked", reason }))).r).toEqual({ status: "skipped", code: "property_not_active" });
    for (const code of ["not_found", "stale_version", "not_claimable", "attempts_exhausted", "conflict", "duplicate", "invalid_argument"] as const)
      expect((await withClaim(() => ({ kind: "rejected", code }))).r).toEqual({ status: "skipped", code: "lease_concurrency" });
    // sem resposta duas vezes ⇒ nada executa (a posse, se confirmada, é selada pela reconciliação)
    const lost = await withClaim(() => ({ kind: "error" }));
    expect(lost.r).toEqual({ status: "skipped", code: "lease_concurrency" });
    expect(lost.n()).toBe(2);
    expect(lost.provider.calls).toBe(0);
    // resposta perdida UMA vez ⇒ a repetição (mesma execução) segue normalmente
    const once = await withClaim((n) => (n === 1 ? { kind: "error" } : "real"));
    expect(once.r).toEqual({ status: "recorded", decision: "answer_candidate" });
    expect(once.n()).toBe(2);
    // sem token de tick ⇒ nem tenta reivindicar
    const none = await withClaim(() => "real", { tickToken: null });
    expect(none.r).toEqual({ status: "skipped", code: "tick_not_held" });
    expect(none.n()).toBe(0);
  });
  it("F-05 · lote vencido em processamento NUNCA é reivindicado de novo pelo worker (sem recuperação)", async () => {
    const r = await run((l) => (l.claimOver = (c) => ({ ...(c as Extract<StoreClaimResult, { ownerToken: string }>), result: "recovered" })));
    expect(r.r).toEqual({ status: "skipped", code: "lease_concurrency" });
    expect(r.provider.calls).toBe(0);
    const p = await run((l) => (l.loadOver = (n) => (n <= 2 ? { conversationId: CONV, state: "processing", version: 5, batchId: "b0000000-0000-4000-8000-000000000001", messageIds: [MSG], deferredMessageIds: [], attempts: 1, leaseExpiresAt: "2026-11-03T09:00:00Z" } : undefined)));
    expect(p.r).toEqual({ status: "skipped", code: "lease_concurrency" });
  });
  it("F-05 · sobras de lote ENCERRADO (falha/cancelamento/expiração) são seladas antes de observar; recusa ⇒ concorrência; releitura falha ⇒ integridade", async () => {
    const closed = (state: string) => ({ conversationId: CONV, state, version: 4, batchId: "b0000000-0000-4000-8000-000000000001", messageIds: [MSG], deferredMessageIds: [], attempts: 1, leaseExpiresAt: null });
    for (const state of ["failed", "cancelled", "expired"]) {
      const acks: unknown[] = [];
      const r = await run((l) => {
        l.loadOver = (n) => (n === 1 ? closed(state) : n === 2 ? { ...closed(state), version: 5, messageIds: [] } : undefined);
        l.over.acknowledge = () => (acks.push(state), { result: "applied", version: 5, state } as StoreTransitionResult);
      });
      expect(acks).toEqual([state]);
      expect(r.lease.inner.events[0]).toBe("observe"); // selou ANTES de observar
    }
    expect((await run((l) => { l.loadOver = (n) => (n === 1 ? closed("failed") : undefined); l.over.acknowledge = () => ({ result: "invalid_transition", version: 4 }); })).r).toEqual({ status: "skipped", code: "lease_concurrency" });
    const f = await run((l) => { l.loadOver = (n) => (n === 1 ? closed("failed") : n === 2 ? "throw" : undefined); l.over.acknowledge = () => ({ result: "applied", version: 5, state: "failed" }); });
    expect(f.store.records[0]!.technicalCode).toBe("lease_integrity_failure");
    // lote encerrado SEM lote fechado (batch nulo) ou já selado (sem mensagens) ⇒ nada a selar
    const acks2: unknown[] = [];
    await run((l) => { l.loadOver = (n) => (n === 1 ? { ...closed("cancelled"), batchId: null } : undefined); l.over.acknowledge = () => (acks2.push(1), undefined); });
    await run((l) => { l.loadOver = (n) => (n === 1 ? { ...closed("failed"), messageIds: [] } : undefined); l.over.acknowledge = () => (acks2.push(1), undefined); });
    expect(acks2).toEqual([]);
  });
  it("fail definitivo recusado (desfecho técnico) ⇒ lease_integrity_failure", async () => {
    const r = await run((l) => (l.over.fail = () => ({ result: "stale_owner", version: 9 })), { portsFor: () => operationalPorts({ loadContext: async () => { throw new Error(CANARY); } }) });
    expect(r.r).toEqual({ status: "recorded", decision: "technical_failure" });
    expect(r.store.records[0]).toMatchObject({ technicalCode: "lease_integrity_failure" });
  });
  it("finalização do lease recusada ⇒ registro diz a verdade: lease_integrity_failure", async () => {
    const r = await run((l) => (l.over.complete = () => ({ result: "stale_owner", version: 9 })));
    expect(r.r).toEqual({ status: "recorded", decision: "technical_failure" });
    expect(r.store.records[0]).toMatchObject({ technicalCode: "lease_integrity_failure", executionState: "failed" });
  });
});

describe("B3.3 · worker — demais ramos", () => {
  it("relógio de parede e id padrão (Date.now / randomUUID) funcionam", async () => {
    const { io, store } = makeIo({ provider: fakeProvider(good()), newId: undefined, now: undefined });
    const r = await runShadowWorker(candidate(), io);
    expect(r).toEqual({ status: "recorded", decision: "answer_candidate" });
    expect(store.records[0]!.executionId).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("registro que não passa na validação ⇒ não é gravado; record_failed + disjuntor (com e sem decisão forçada)", async () => {
    const a = makeIo({ provider: fakeProvider(good()), newId: () => "id-invalido" });
    a.store.gateBlocked.set(P_ID, "no_guest_channel");
    expect(await runShadowWorker(candidate(), a.io)).toEqual({ status: "record_failed", decision: "blocked_not_authorized" });
    expect(a.store.records).toEqual([]);
    expect(a.store.trips).toEqual([{ to: "technical_failure", reason: "telemetry_failure" }]);
    const b = makeIo({ provider: fakeProvider(good()), newId: () => "id-invalido" });
    expect(await runShadowWorker(candidate(), b.io)).toEqual({ status: "record_failed", decision: "technical_failure" });
  });
  it("registro inválido sem decisão forçada (uso fracionário do provedor) ⇒ record_failed/technical_failure", async () => {
    const { io, store } = makeIo({ provider: fakeProvider(okJson(v4({ reply: "O check-in começa às 15h.", groundedOn: ["ctx:checkin_oficial"] }), { inputTokens: 900.5, outputTokens: 120, totalTokens: 1020.5 })) });
    expect(await runShadowWorker(candidate(), io)).toEqual({ status: "record_failed", decision: "technical_failure" });
    expect(store.records).toEqual([]);
  });
  it("prazo esgotado ANTES do lease (durante o escopo) ⇒ shadow_timeout", async () => {
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const { io, store } = makeIo({
      provider: fakeProvider(good()),
      schedule: (fn, ms) => (timers.push({ fn, ms }), () => undefined),
      validateTurnScope: async () => {
        timers.find((t) => t.ms === SHADOW_DEADLINE_MS - SHADOW_FINALIZATION_RESERVE_MS)!.fn();
        throw Object.assign(new Error(CANARY), { code: "lookup_failed" });
      },
    });
    expect(await runShadowWorker(candidate(), io)).toEqual({ status: "recorded", decision: "technical_failure" });
    expect(store.records[0]).toMatchObject({ technicalCode: "shadow_timeout", executionState: "timed_out" });
  });
  it("prazo esgotado entre o claim e a cadeia ⇒ barreira do executor ⇒ shadow_timeout, sem Gateway", async () => {
    let jump = 0;
    let t = 0;
    const provider = fakeProvider(good());
    const { io, store } = makeIo({
      provider,
      now: () => (t += 5) + jump,
      loadOwnership: async () => {
        jump = 20_000;
        return { status: "none", row: { id: CONV, status: "ai", assigned_to: null, handoff_reason: null, handoff_urgency: null, handoff_at: null, resolved_at: null, ai_paused: false, paused_until: null } };
      },
    });
    expect(await runShadowWorker(candidate(), io)).toEqual({ status: "recorded", decision: "technical_failure" });
    expect(store.records[0]).toMatchObject({ technicalCode: "shadow_timeout", executionState: "timed_out" });
    expect(provider.calls).toBe(0);
  });
  it("prazo esgotado DURANTE a cadeia, antes da rede (na reserva) ⇒ gerador bloqueia (deadline_expired) ⇒ shadow_timeout", async () => {
    let jump = 0;
    let t = 0;
    const provider = fakeProvider(good());
    const { io, store } = makeIo({ provider, now: () => (t += 5) + jump });
    const reserve = store.reserve.bind(store);
    store.reserve = async (...a: Parameters<typeof reserve>) => { const r = await reserve(...a); jump = 20_000; return r; };
    expect(await runShadowWorker(candidate(), io)).toEqual({ status: "recorded", decision: "technical_failure" });
    expect(store.records[0]).toMatchObject({ technicalCode: "shadow_timeout", blockCode: "deadline_expired", executionState: "timed_out" });
    expect(provider.calls).toBe(0);
  });
  it("portas fora da lista fechada ⇒ barreira do executor ⇒ falha técnica (nada executa)", async () => {
    const provider = fakeProvider(good());
    const { io, store } = makeIo({ provider, portsFor: () => ({ ...operationalPorts(), sendMessage: async () => undefined }) as never });
    expect(await runShadowWorker(candidate(), io)).toEqual({ status: "recorded", decision: "technical_failure" });
    expect(store.records[0]!.technicalCode).toBe("postprocess_failed");
    expect(provider.calls).toBe(0);
  });
  it("pré-autorização impossível (id inválido) ⇒ nenhum gerador ⇒ falha técnica, sem Gateway", async () => {
    const provider = fakeProvider(good());
    const { io, store } = makeIo({ provider, newId: () => "id-invalido" });
    await runShadowWorker(candidate(), io);
    expect(provider.calls).toBe(0);
    expect(store.records).toEqual([]);
  });
  it("erro técnico da cadeia (porta lança) ⇒ falha técnica com o código fechado da cadeia; texto da exceção não sai", async () => {
    const { io, store } = makeIo({ provider: fakeProvider(good()), portsFor: () => operationalPorts({ loadContext: async () => { throw new Error(CANARY); } }) });
    expect(await runShadowWorker(candidate(), io)).toEqual({ status: "recorded", decision: "technical_failure" });
    expect(store.records[0]).toMatchObject({ technicalCode: "stage_failed", executionState: "failed" });
    expect(JSON.stringify(store.records)).not.toContain(CANARY);
  });
  it("recusa de INTEGRIDADE dentro da cadeia (imóvel de outro tenant no contexto) ⇒ disjuntor global", async () => {
    const base = conversationContext();
    const ctx = conversationContext({ property: { ...base.guest.property, id: P_ID, tenantId: OTHER_T } });
    const { io, store } = makeIo({ provider: fakeProvider(good()), portsFor: () => operationalPorts({ loadContext: async () => ctx, loadHistory: async () => history() }) });
    expect(await runShadowWorker(candidate(), io)).toEqual({ status: "recorded", decision: "integrity_violation" });
    expect(store.trips).toContainEqual({ to: "integrity_violation", reason: "integrity_divergence" });
  });
  it("pausa relida: falha de leitura ⇒ técnica; indeterminada e ilegível ⇒ bloqueio sem Gateway", async () => {
    let n = 0;
    const a = makeIo({ provider: fakeProvider(good()), loadHumanPauseSource: async () => { if (++n === 2) throw new Error(CANARY); return benignPause(); } });
    expect(await runShadowWorker(candidate(), a.io)).toEqual({ status: "recorded", decision: "technical_failure" });
    for (const [src, code] of [[{ ...benignPause(), column: { ai_paused: true, paused_until: null } }, "pause_indefinite"], [{ ...benignPause(), lookup: "failed" }, "pause_unreadable"]] as const) {
      let k = 0;
      const b = makeIo({ provider: fakeProvider(good()), loadHumanPauseSource: async () => (++k === 2 ? (src as never) : benignPause()) });
      expect(await runShadowWorker(candidate(), b.io)).toEqual({ status: "recorded", decision: "human_pause_active" });
      expect(b.store.records[0]!.blockCode).toBe(code);
    }
  });
});

describe("B3.3 · sinais: a cadeia recebe o sinal ÚNICO do prazo; a finalização usa o sinal PRÓPRIO", () => {
  it("prazo de processamento esgota no Gateway: portas viram o sinal abortado; store/lease da finalização seguem vivos", async () => {
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const schedule = (fn: () => void, ms: number) => (timers.push({ fn, ms }), () => undefined);
    const provider = fakeProvider(() => new Promise((_, reject) => {
      setTimeout(() => timers.find((x) => x.ms === SHADOW_DEADLINE_MS - SHADOW_FINALIZATION_RESERVE_MS)!.fn(), 0);
      setTimeout(() => reject(new Error("aborted")), 5);
    }));
    const seen: AbortSignal[] = [];
    const base = makeIo({ provider, schedule });
    const { store, lease } = base;
    // como as portas reais: com o sinal abortado, NADA sai (store devolve erro; lease, store_error)
    const io = {
      ...base.io,
      storeFor: (sig: AbortSignal) => new Proxy(store, { get: (t, k) => (k === "record" || k === "finalizeExecution" ? async (r: never) => (sig.aborted ? { kind: "error" } : (t[k] as (x: never) => unknown).call(t, r)) : k === "trip" ? async (...a: never[]) => (sig.aborted ? "error" : t.trip(...(a as unknown as Parameters<typeof t.trip>))) : Reflect.get(t, k)) }) as never,
      leaseFor: (sig: AbortSignal) => new Proxy(lease, { get: (t, k) => (k === "transition" ? async (...a: never[]) => (sig.aborted ? { result: "store_error", version: null } : (t.transition as (...x: never[]) => unknown)(...a)) : Reflect.get(t, k)) }) as never,
      portsFor: () => operationalPorts({ loadContext: async (_t, sig) => (seen.push(sig), shadowCtx()), loadHistory: async () => history(), loadStayAuthorizationSource: async () => staySource() }),
    };
    expect(await runShadowWorker(candidate(), io)).toEqual({ status: "recorded", decision: "technical_failure" });
    expect(store.records[0]).toMatchObject({ technicalCode: "shadow_timeout", executionState: "timed_out" });
    expect(lease.rec?.state).toBe("failed");
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s.aborted)).toBe(true);
  });
});

describe("B3.3 · ligação de produção (cada loader recebe o banco e o SINAL da execução)", () => {
  it("productionWorkerIo encaminha db + sinal a cada loader e às portas", async () => {
    const calls: Array<[string, unknown]> = [];
    const db = fakeDb({}).db;
    const admin = { from: db.from, rpc: vi.fn(() => Object.assign(Promise.resolve({ data: { result: "x" }, error: null }), { abortSignal: () => Promise.resolve({ data: { result: "x" }, error: null }) })) };
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
    const rec = (name: string) => vi.fn(async (...a: unknown[]) => { calls.push([name, a]); return name === "ctx" ? { guest: { audiences: ["P"] } } : name === "ownership" ? { status: "none" } : { ok: true }; });
    vi.doMock("@/lib/guest-ai/data/scope.server", () => ({ validateTurnScope: rec("scope") }));
    vi.doMock("@/lib/guest-ai/data/collector.server", () => ({ fetchCollectorWindow: rec("collector") }));
    vi.doMock("@/lib/guest-ai/data/human-pause.server", () => ({ loadHumanPauseSource: rec("pause") }));
    vi.doMock("@/lib/guest-ai/data/conversation-ownership.server", () => ({ loadConversationOwnership: rec("ownership") }));
    vi.doMock("@/lib/guest-ai/context/conversation-context.server", () => ({ loadConversationContext: rec("ctx") }));
    vi.doMock("@/lib/guest-ai/data/history.server", () => ({ fetchConversationHistory: rec("history") }));
    vi.doMock("@/lib/guest-ai/data/property-dossier.server", () => ({ fetchPropertyDossier: rec("dossier") }));
    vi.doMock("@/lib/guest-ai/data/property-access.server", () => ({ primaryDossierTarget: vi.fn(() => "target") }));
    vi.doMock("@/lib/guest-ai/data/stay-authorization.server", () => ({ loadStayAuthorizationSource: rec("stay") }));
    vi.doMock("@/lib/guest-ai/data/sender-identity.server", () => ({ loadSenderIdentitySource: rec("sender") }));
    vi.resetModules();
    const { productionWorkerIo } = await import("@/lib/guest-ai/shadow-exec/worker.server");
    const io = await productionWorkerIo();
    const sig = new AbortController().signal;
    const turn = shadowTurn();
    expect(await io.storeFor(sig).readControl()).toBeNull();
    expect(await io.leaseFor(sig).load(CONV)).toBeNull();
    expect((await io.leaseFor(sig).claim(CONV, 1)).result).toBe("store_error");
    await io.validateTurnScope({ surface: "guide_chat", conversationId: CONV, messageId: MSG, expectedOwnerId: T_ID }, sig);
    await io.fetchCollectorWindow(turn, sig, 1);
    await io.loadHumanPauseSource(turn, sig, 1);
    await io.loadOwnership(turn, sig, "2026-11-03T10:00:00Z");
    const row = { id: CONV, status: "ai", assigned_to: null, handoff_reason: null, handoff_urgency: null, handoff_at: null, resolved_at: null, ai_paused: false, paused_until: null };
    const ports = io.portsFor(turn, row, () => Date.parse("2026-11-03T10:00:00Z"));
    await expect(ports.loadDossiers(turn, sig)).rejects.toThrow("context_not_loaded");
    await ports.loadContext(turn, sig);
    await ports.loadDossiers(turn, sig);
    await ports.loadHistory(turn, sig);
    await ports.loadStayAuthorizationSource(turn, sig);
    await ports.loadSenderIdentitySource(turn, sig);
    await ports.loadHumanPause(turn, sig);
    expect(await ports.loadConversationOwnership(turn, sig)).toBe(row);
    expect(await ports.loadConversationOwnership(shadowTurn({ conversationId: "99999999-9999-4999-8999-999999999999" }), sig)).toBeNull();
    const byName = Object.fromEntries(calls.map(([n, a]) => [n, a]));
    for (const n of ["collector", "pause", "ownership", "history", "stay", "sender", "dossier"]) {
      const deps = (byName[n] as unknown[])[1] as Record<string, unknown>;
      expect(deps.db, n).toBeDefined();
      expect(deps.signal, n).toBe(sig);
    }
    expect(((byName.ctx as unknown[])[0] as Record<string, unknown>).expectedOwnerId).toBe(T_ID);
    expect((byName.ctx as unknown[])[2]).toBe(sig);
    for (const m of ["scope", "collector", "human-pause", "conversation-ownership", "history", "property-dossier", "property-access", "stay-authorization", "sender-identity"]) vi.doUnmock(`@/lib/guest-ai/data/${m}.server`);
    vi.doUnmock("@/lib/guest-ai/context/conversation-context.server");
    vi.resetModules();
  });
  it("tick liberado sem io ⇒ ligação de produção (store, candidatas, worker)", async () => {
    const store = new MemoryShadowStore();
    const worker = vi.fn(async () => ({ status: "recorded", decision: "silence" }));
    vi.doMock("@/lib/guest-ai/shadow-exec/worker.server", () => ({ productionWorkerIo: async () => ({}), runShadowWorker: worker }));
    vi.doMock("@/lib/guest-ai/data/shadow-candidates.server", () => ({ listShadowCandidates: async () => ({ ok: true, candidates: [candidate()] }) }));
    vi.doMock("@/lib/guest-ai/data/shadow-store.server", () => ({ getShadowStore: async () => store }));
    const r = await handleShadowTick(new Request("https://x.test", { method: "POST" }), { masterSwitchOn: () => true, verifySecret: () => true, released: true });
    expect(await r.json()).toEqual({ outcome: "executed", conversationsConsidered: 1, executed: 1, blocked: 0, failed: 0 });
    expect(worker).toHaveBeenCalledTimes(1);
    vi.doUnmock("@/lib/guest-ai/shadow-exec/worker.server");
    vi.doUnmock("@/lib/guest-ai/data/shadow-candidates.server");
    vi.doUnmock("@/lib/guest-ai/data/shadow-store.server");
  });
});

describe("B3.3 · gerador: prazo esgotado DURANTE a chamada de rede ⇒ resposta descartada (deadline_expired)", () => {
  it("o sinal aborta na releitura pós-resposta, estado ainda válido ⇒ descartado com deadline_expired", async () => {
    const { createShadowGatewayGenerator, issueShadowPreflight } = await import("@/lib/guest-ai/shadow-exec/gateway-generator.server");
    const { ShadowDeadline } = await import("@/lib/guest-ai/shadow-exec/deadline");
    const { validateShadowControl } = await import("@/lib/guest-ai/shadow-exec/breakers");
    const { fullControl } = await import("./helpers/b33-shadow");
    const v = validateShadowControl(fullControl());
    if (!v.ok) throw new Error("fixture");
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const deadline = new ShadowDeadline({ now: () => 0, schedule: (fn, ms) => (timers.push({ fn, ms }), () => undefined) });
    const store = new MemoryShadowStore();
    store.control = fullControl();
    const provider = fakeProvider(good());
    const read = store.readControl.bind(store);
    store.readControl = async () => { const c = await read(); if (provider.calls > 0) timers.find((t) => t.ms === SHADOW_DEADLINE_MS - SHADOW_FINALIZATION_RESERVE_MS)!.fn(); return c; };
    const preflight = issueShadowPreflight({ executionId: EXEC_ID, tenantId: T_ID, propertyId: P_ID, conversationId: CONV, stateVersion: store.control.stateVersion, propertyActiveOk: true, integrityOk: true, pauseInactive: true, ownershipOk: true })!;
    const gen = createShadowGatewayGenerator({ preflight, limits: v.limits, deadline, store, masterSwitchOn: () => true, provider })!;
    await expect(gen.generate({ system: "s", messages: [{ role: "user" as const, content: "oi" }], sourceIds: new Set(["x"]) } as never, deadline.signal)).rejects.toThrow();
    expect(gen.telemetry()).toMatchObject({ status: "discarded", blockCode: "deadline_expired" });
  });
});

describe("B3.3 · adaptador, candidatas e projeção (ramos restantes)", () => {
  it("record: erro da RPC com registro válido ⇒ error", async () => {
    const s = createShadowStore({ call: async () => ({ data: null, error: { code: "x" } }) });
    const rec = buildExecutionRecord(null, { executionId: EXEC_ID, tenantId: T_ID, propertyId: P_ID, conversationId: CONV, channel: "web", batchId: null, leaseVersion: null, modelId: null, startedAt: "2026-11-03T10:00:00.000Z", finishedAt: "2026-11-03T10:00:00.000Z", totalMs: 0, leaseMs: 0, contextMs: 0, gatewayMs: 0, validationMs: 0, gateway: NO_GATEWAY, estimatedInputTokens: null, pauseState: "not_evaluated", executionState: "blocked", technicalCode: null, blockCode: "property_ineligible", integrityCode: null, budgetExceeded: null, tokenLimitViolation: false, concurrencyDetected: false, forcedDecision: "blocked_not_authorized" }, "c");
    expect(await s.record(rec)).toEqual({ kind: "error" });
  });
  it("candidatas: lista acima do teto pedido ⇒ integridade (o banco nunca devolve mais que o teto)", async () => {
    const two = [candidateRow(), candidateRow({ conversationId: "7c000000-0000-4000-8000-0000000000c2" })];
    const store = { listCandidates: async (_t: string, _l: number, limit: number) => parseCandidates({ result: "ok", candidates: two.map((c) => ({ conversation_id: c.conversationId, property_id: c.propertyId, tenant_id: c.tenantId, surface: c.surface, message_id: c.messageId })) }, limit) };
    expect(await listShadowCandidates(store, { tickToken: "c".repeat(64), limit: 1, tickIntervalSeconds: 60 })).toEqual({ ok: false, integrity: true });
  });
  it("projeção: erro técnico com código fora da lista ⇒ código nulo (o registro será recusado)", () => {
    const n = narrowOutcome({ kind: "technical_error", code: CANARY, audit: { checks: {} } } as unknown as ChainOutcome);
    expect(n.technicalCode).toBeNull();
    expect(JSON.stringify(n)).not.toContain(CANARY);
  });
});
