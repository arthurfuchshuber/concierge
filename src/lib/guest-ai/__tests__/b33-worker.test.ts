/**
 * B3.3 · Entrega 2 — WORKER Shadow ponta a ponta (cadeia REAL `runTurnChain`, Gateway REAL
 * `generateGuestLlm`, validadores reais; só o transporte, as portas do banco e o lease são falsos —
 * o lease falso é o MODELO de referência B3.1). Nenhuma chamada externa: `fetch` global quebra o teste.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runShadowWorker } from "@/lib/guest-ai/shadow-exec/worker.server";
import { SHADOW_DEADLINE_MS, SHADOW_FINALIZATION_RESERVE_MS } from "@/lib/guest-ai/shadow-exec/contracts";
import { v4 } from "./helpers/b23-chain";
import { ownershipRow } from "./helpers/b25-fixtures";
import { CANARY, CONV, MSG, MemoryShadowStore, ModelLeaseStore, OTHER_P, OTHER_T, T0, benignPause, candidate, fakeProvider, fullControl, makeIo, okJson, shadowTurn, windowOf } from "./helpers/b33-shadow";

const decisionWithCanary = () =>
  v4({ reply: `O check-in começa às 15h. ${CANARY}`, groundedOn: ["ctx:checkin_oficial"] });

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchSpy = vi.fn(() => {
    throw new Error("rede proibida nos testes do Shadow");
  });
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const everything = (x: unknown) => JSON.stringify(x);

describe("B3.3 · worker — caminho completo com transporte falso", () => {
  it("resposta candidata: registro tipado sem texto, lease concluído, orçamento liquidado, uma chamada", async () => {
    const provider = fakeProvider(okJson(decisionWithCanary()));
    const { io, store, lease, captured } = makeIo({ provider });
    const r = await runShadowWorker(candidate(), io);
    expect(r).toEqual({ status: "recorded", decision: "answer_candidate" });
    expect(provider.calls).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    const rec = store.records[0]!;
    expect(rec).toMatchObject({ decision: "answer_candidate", candidateAvailable: true, executionState: "completed", responseDiscarded: true, gatewayCalls: 1, inputTokens: 900, outputTokens: 120, channel: "web", modelId: "openai/gpt-5.6-sol", tenantId: shadowTurn().tenantId, propertyId: shadowTurn().propertyId, conversationId: CONV });
    expect(rec.intents).toEqual(["informational_query"]);
    expect(rec.batchId).toMatch(/^[0-9a-f-]{36}$/);
    expect(lease.rec?.state).toBe("completed");
    expect(lease.events).toEqual(["observe", "mark_ready", "claim", "start", "complete"]);
    expect(store.calls).toContain("reserve");
    // E3.1: liquidação dentro da finalização atômica (uma chamada: lease + liquidação + registro)
    expect(store.calls.filter((c) => c === "finalize")).toHaveLength(1);
    expect(store.finalizations[0]!.settlement).toEqual({ tokens: 1020, costUsd: "0.00232500", calls: 1 });
    expect([...store.reservations.values()].every((x) => x.settled)).toBe(true);
    // DESCARTE: o canário (dentro do texto da resposta) não está em nenhum destino
    expect(everything(store.records)).not.toContain(CANARY);
    expect(everything(captured.logs)).not.toContain(CANARY);
    expect(everything(r)).not.toContain(CANARY);
    expect(everything(store.trips)).not.toContain(CANARY);
    expect(Object.isFrozen(rec)).toBe(true);
  });

  it("canários em TODOS os campos livres da decisão (resposta, pergunta, compromissos, nome) nunca saem", async () => {
    const d = v4({
      reply: `R ${CANARY}`,
      strategy: "answer_and_handoff",
      handoff: { needed: true, question: `Q ${CANARY}`, urgency: "low" },
      commitments: [`C ${CANARY}`],
      commitmentKinds: ["team_relay"],
      speakerName: `N ${CANARY}`,
      groundedOn: ["ctx:checkin_oficial"],
    });
    const { io, store, captured } = makeIo({ provider: fakeProvider(okJson(d)) });
    const r = await runShadowWorker(candidate(), io);
    expect(r.status).toBe("recorded");
    expect(everything({ r, records: store.records, logs: captured.logs, trips: store.trips, calls: store.calls })).not.toContain(CANARY);
  });

  it("console.* não recebe o canário (logs do Gateway são por lista branca)", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const { io } = makeIo({ provider: fakeProvider(okJson(decisionWithCanary())), log: undefined });
    await runShadowWorker(candidate(), io);
    for (const s of spies) for (const c of s.mock.calls) expect(everything(c)).not.toContain(CANARY);
    for (const s of spies) s.mockRestore();
  });
});

describe("B3.3 · worker — estado global e configuração (nada roda sem `running` completo)", () => {
  const blockedBefore = async (setup: (s: MemoryShadowStore) => void, extra: Partial<Parameters<typeof makeIo>[0]> = {}) => {
    const provider = fakeProvider(okJson(decisionWithCanary()));
    const store = new MemoryShadowStore();
    setup(store);
    const { io, captured, lease } = makeIo({ provider, store, ...extra });
    const r = await runShadowWorker(candidate(), io);
    expect(provider.calls).toBe(0);
    expect(captured.scopeCalls).toBe(0);
    expect(lease.events).toEqual([]);
    expect(store.records).toEqual([]);
    return r;
  };
  it("chave mestra desligada ⇒ nada (nem estado é lido)", async () => {
    const store = new MemoryShadowStore();
    const { io } = makeIo({ store, masterSwitchOn: () => false, provider: fakeProvider(okJson({})) });
    expect(await runShadowWorker(candidate(), io)).toEqual({ status: "skipped", code: "master_switch_off" });
    expect(store.calls).toEqual([]);
  });
  it("chave mestra lida do ambiente por padrão (GUEST_AI_SHADOW ausente ⇒ desligada)", async () => {
    vi.stubEnv("GUEST_AI_SHADOW", "");
    const store = new MemoryShadowStore();
    const { io } = makeIo({ store, masterSwitchOn: undefined, provider: fakeProvider(okJson({})) });
    expect(await runShadowWorker(candidate(), io)).toEqual({ status: "skipped", code: "master_switch_off" });
    vi.unstubAllEnvs();
  });
  it("estado `disabled` (inicial) bloqueia", async () => {
    expect(await blockedBefore((s) => (s.control = fullControl({ state: "disabled" })))).toEqual({ status: "skipped", code: "state_not_running" });
  });
  it("estado `ready` NÃO executa", async () => {
    expect(await blockedBefore((s) => (s.control = fullControl({ state: "ready" })))).toEqual({ status: "skipped", code: "state_not_running" });
  });
  for (const st of ["paused", "circuit_open", "budget_exhausted", "integrity_violation", "technical_failure"] as const) {
    it(`estado ${st} bloqueia`, async () => {
      expect(await blockedBefore((s) => (s.control = fullControl({ state: st })))).toEqual({ status: "skipped", code: "state_not_running" });
    });
  }
  it("estado ilegível bloqueia", async () => {
    expect(await blockedBefore((s) => (s.fail.readControl = true))).toEqual({ status: "skipped", code: "state_unreadable" });
  });
  it("retenção não autorizada bloqueia (independente do modelo)", async () => {
    expect(await blockedBefore((s) => (s.control = fullControl({ retentionAuthorized: false, retentionScope: null })))).toEqual({ status: "skipped", code: "retention_not_authorized" });
  });
  it("limites ausentes bloqueiam", async () => {
    expect(await blockedBefore((s) => (s.control = fullControl({ maxTurnCostUsd: null })))).toEqual({ status: "skipped", code: "limits_missing" });
  });
  it("limites negativos bloqueiam", async () => {
    expect(await blockedBefore((s) => (s.control = fullControl({ maxDailyCalls: -1 })))).toEqual({ status: "skipped", code: "limits_invalid" });
  });
  it("medição dos disjuntores indisponível ⇒ technical_failure global e nada roda", async () => {
    const r = await blockedBefore((s) => (s.fail.evaluate = true));
    expect(r).toEqual({ status: "skipped", code: "measurement_unavailable" });
  });
  it("disjuntor já excedido na leitura ⇒ circuit_open e nada roda", async () => {
    const store = new MemoryShadowStore();
    store.breaker = "error_rate_exceeded";
    const { io } = makeIo({ store, provider: fakeProvider(okJson({})) });
    expect(await runShadowWorker(candidate(), io)).toEqual({ status: "skipped", code: "breaker_open" });
    expect(store.trips).toEqual([{ to: "circuit_open", reason: "error_rate_exceeded" }]);
  });
});

describe("B3.3 · worker — porta do imóvel (E4 global), escopo e integridade (bloqueio global)", () => {
  it("porta do imóvel ilegível ⇒ nada roda (nenhuma leitura da conversa)", async () => {
    const store = new MemoryShadowStore();
    store.fail.propertyStatus = true;
    const { io, captured } = makeIo({ store, provider: fakeProvider(okJson({})) });
    expect(await runShadowWorker(candidate(), io)).toEqual({ status: "skipped", code: "property_status_unreadable" });
    expect(captured.scopeCalls).toBe(0);
    expect(store.records).toEqual([]);
  });
  it("imóvel não ativo (escopo fechado, tenant/imóvel desligado, inelegível) ⇒ registro blocked_not_authorized com o código fechado, sem escopo nem Gateway", async () => {
    const cases: Array<[(s: MemoryShadowStore) => void, string]> = [
      [(s) => (s.control = fullControl({ propertyScope: "none" })), "scope_off"],
      [(s) => s.gateBlocked.set(shadowTurn().propertyId, "tenant_disabled"), "tenant_disabled"],
      [(s) => s.gateBlocked.set(shadowTurn().propertyId, "property_disabled"), "property_disabled"],
      ...(["archived", "no_guest_channel", "listing_inconsistent", "tenant_unresolved", "operational_data_missing"] as const).map(
        (r) => [(s: MemoryShadowStore) => s.gateBlocked.set(shadowTurn().propertyId, r), "property_ineligible"] as [(s: MemoryShadowStore) => void, string],
      ),
      [(s) => s.owners.delete(shadowTurn().propertyId), "property_ineligible"],
    ];
    for (const [setup, blockCode] of cases) {
      const store = new MemoryShadowStore();
      setup(store);
      const provider = fakeProvider(okJson({}));
      const { io, captured } = makeIo({ store, provider });
      expect(await runShadowWorker(candidate(), io)).toEqual({ status: "recorded", decision: "blocked_not_authorized" });
      expect(store.records[0]).toMatchObject({ blockCode, executionState: "blocked", gatewayCalls: 0 });
      expect(captured.scopeCalls + provider.calls).toBe(0);
      expect(store.trips).toEqual([]);
    }
  });
  it("dono do imóvel ≠ tenant da candidata ⇒ integridade global", async () => {
    const store = new MemoryShadowStore();
    store.owners.set(shadowTurn().propertyId, OTHER_T);
    const { io, captured } = makeIo({ store, provider: fakeProvider(okJson({})) });
    expect(await runShadowWorker(candidate(), io)).toEqual({ status: "recorded", decision: "integrity_violation" });
    expect(store.trips).toEqual([{ to: "integrity_violation", reason: "integrity_divergence" }]);
    expect(store.records[0]!.integrityCode).toBe("candidate_tenant_mismatch");
    // barrado ANTES de qualquer leitura de escopo (nem o banco da conversa é consultado)
    expect(captured.scopeCalls).toBe(0);
  });
  it("escopo com divergência de dono/canal/imóvel ⇒ integridade global (independe da taxa de erro)", async () => {
    for (const code of ["tenant_mismatch", "surface_mismatch", "property_unresolved", "message_conversation_mismatch"]) {
      const store = new MemoryShadowStore();
      const provider = fakeProvider(okJson({}));
      const { io } = makeIo({ store, provider, validateTurnScope: async () => { throw Object.assign(new Error(`x ${CANARY}`), { code }); } });
      expect(await runShadowWorker(candidate(), io)).toEqual({ status: "recorded", decision: "integrity_violation" });
      expect(store.records[0]!.integrityCode).toBe(code);
      expect(provider.calls).toBe(0);
      expect(everything(store.records)).not.toContain(CANARY);
    }
  });
  it("falha de leitura do escopo ⇒ falha técnica (não integridade), texto da exceção não sai", async () => {
    const store = new MemoryShadowStore();
    const { io } = makeIo({ store, provider: fakeProvider(okJson({})), validateTurnScope: async () => { throw Object.assign(new Error(CANARY), { code: "lookup_failed" }); } });
    expect(await runShadowWorker(candidate(), io)).toEqual({ status: "recorded", decision: "technical_failure" });
    expect(store.records[0]).toMatchObject({ technicalCode: "read_failed", executionState: "failed" });
    expect(everything(store.records)).not.toContain(CANARY);
  });
  it("turno validado de outro tenant ou imóvel ⇒ integridade global", async () => {
    for (const [over, code] of [[{ tenantId: OTHER_T }, "candidate_tenant_mismatch"], [{ propertyId: OTHER_P }, "candidate_property_mismatch"]] as const) {
      const store = new MemoryShadowStore();
      const { io } = makeIo({ store, provider: fakeProvider(okJson({})), validateTurnScope: async () => shadowTurn(over) });
      expect(await runShadowWorker(candidate(), io)).toEqual({ status: "recorded", decision: "integrity_violation" });
      expect(store.records[0]!.integrityCode).toBe(code);
    }
  });
  it("janela do coletor de outro escopo ⇒ integridade global", async () => {
    const store = new MemoryShadowStore();
    const { io } = makeIo({ store, provider: fakeProvider(okJson({})), fetchCollectorWindow: async (t) => windowOf(t, { scope: { ...windowOf(t).scope, tenantId: OTHER_T } }) });
    expect(await runShadowWorker(candidate(), io)).toEqual({ status: "recorded", decision: "integrity_violation" });
    expect(store.records[0]!.integrityCode).toBe("batch_scope_mismatch");
  });
});

describe("B3.3 · worker — pausa humana, posse humana e coletor (sempre ANTES do Gateway)", () => {
  const pausedSource = (indefinite: boolean) => ({ ...benignPause(), column: { ai_paused: true, paused_until: indefinite ? null : "2026-11-03T12:00:00Z" } });
  it("pausa ativa/indeterminada/ilegível antes do coletor ⇒ human_pause_active, sem lease nem Gateway", async () => {
    for (const [src, code] of [[pausedSource(false), "pause_active"], [pausedSource(true), "pause_indefinite"], [{ ...benignPause(), lookup: "failed" as const }, "pause_unreadable"]] as const) {
      const store = new MemoryShadowStore();
      const provider = fakeProvider(okJson({}));
      const { io, lease } = makeIo({ store, provider, loadHumanPauseSource: async () => src as never });
      expect(await runShadowWorker(candidate(), io)).toEqual({ status: "recorded", decision: "human_pause_active" });
      expect(store.records[0]!.blockCode).toBe(code);
      expect(provider.calls).toBe(0);
      expect(lease.events).toEqual([]);
    }
  });
  it("pausa que surge DEPOIS do claim (relida) ⇒ bloqueio sem Gateway; lote concluído (D8)", async () => {
    let n = 0;
    const provider = fakeProvider(okJson({}));
    const store = new MemoryShadowStore();
    const { io, lease } = makeIo({ store, provider, loadHumanPauseSource: async () => (++n === 1 ? benignPause() : (pausedSource(false) as never)) });
    expect(await runShadowWorker(candidate(), io)).toEqual({ status: "recorded", decision: "human_pause_active" });
    expect(provider.calls).toBe(0);
    expect(lease.rec?.state).toBe("completed");
    expect(store.records[0]!.pauseState).toBe("active");
  });
  it("falha de leitura da pausa ⇒ falha técnica, sem Gateway", async () => {
    const store = new MemoryShadowStore();
    const provider = fakeProvider(okJson({}));
    const { io } = makeIo({ store, provider, loadHumanPauseSource: async () => { throw new Error(CANARY); } });
    expect(await runShadowWorker(candidate(), io)).toEqual({ status: "recorded", decision: "technical_failure" });
    expect(provider.calls).toBe(0);
  });
  it("posse humana: indeterminada bloqueia; falha de leitura é técnica; divergências ⇒ integridade; lote nunca concluído sem avaliação", async () => {
    const cases: Array<[NonNullable<NonNullable<Parameters<typeof makeIo>[0]>["loadOwnership"]>, string, string]> = [
      [async () => ({ status: "indeterminate" }), "operational_restriction", "ownership_indeterminate"],
      [async () => ({ status: "read_failed" }), "technical_failure", "read_failed"],
      [async () => ({ status: "tenant_mismatch" }), "integrity_violation", "ownership_tenant_mismatch"],
      [async () => ({ status: "property_mismatch" }), "integrity_violation", "ownership_property_mismatch"],
      [async () => ({ status: "identity_inconsistent" }), "integrity_violation", "ownership_identity_inconsistent"],
    ];
    for (const [loadOwnership, decision, code] of cases) {
      const store = new MemoryShadowStore();
      const provider = fakeProvider(okJson({}));
      const { io, lease } = makeIo({ store, provider, loadOwnership });
      expect(await runShadowWorker(candidate(), io)).toEqual({ status: "recorded", decision });
      const rec = store.records[0]!;
      expect([rec.blockCode, rec.technicalCode, rec.integrityCode]).toContain(code);
      expect(provider.calls).toBe(0);
      expect(lease.rec?.state).toBe("failed");
    }
  });
  it("posse identificada (chamado aberto) NÃO bloqueia a conversa inteira", async () => {
    const { io, store } = makeIo({ provider: fakeProvider(okJson(decisionWithCanary())), loadOwnership: async () => ({ status: "identified", row: ownershipRow({ id: CONV, status: "needs_human", handoff_at: "2026-11-03T09:00:00Z" }) }) });
    const r = await runShadowWorker(candidate(), io);
    expect(r.status).toBe("recorded");
    expect(store.records[0]!.decision).not.toBe("technical_failure");
  });
  it("lote ainda dentro do debounce ⇒ nada (sem registro, sem lease)", async () => {
    // E3.1: o instante é o do BANCO (lido com o estado global), nunca o relógio da máquina
    const st = new MemoryShadowStore();
    st.control = fullControl({ dbNowMs: Date.parse("2026-11-03T10:00:05Z") });
    const { io, store, lease } = makeIo({ store: st, provider: fakeProvider(okJson({})) });
    expect(await runShadowWorker(candidate(), io)).toEqual({ status: "skipped", code: "collector_not_ready" });
    expect(store.records).toEqual([]);
    expect(lease.events).toEqual([]);
  });
  it("leitura do coletor estourou o teto ⇒ nada (sem truncar)", async () => {
    const { io } = makeIo({ provider: fakeProvider(okJson({})), fetchCollectorWindow: async (t) => windowOf(t, { pendingOverflow: true }) });
    expect(await runShadowWorker(candidate(), io)).toEqual({ status: "skipped", code: "lease_overflow" });
  });
  it("coletor sem pendências ⇒ nada", async () => {
    const { io } = makeIo({ provider: fakeProvider(okJson({})), fetchCollectorWindow: async (t) => windowOf(t, { messages: [] }) });
    expect(await runShadowWorker(candidate(), io)).toEqual({ status: "skipped", code: "collector_not_ready" });
  });
  it("coletor com lote rejeitado por mistura de tenant ⇒ integridade", async () => {
    const t = shadowTurn();
    const w = windowOf(t);
    const { io, store } = makeIo({ provider: fakeProvider(okJson({})), fetchCollectorWindow: async () => ({ ...w, messages: [{ ...w.messages[0]!, tenantId: OTHER_T }] }) });
    expect(await runShadowWorker(candidate(), io)).toEqual({ status: "recorded", decision: "integrity_violation" });
    expect(store.records[0]!.integrityCode).toBe("cross_tenant");
  });
  it("coletor com instante inválido ⇒ nada (rejeição tipada que não é integridade)", async () => {
    const t = shadowTurn();
    const w = windowOf(t);
    const { io } = makeIo({ provider: fakeProvider(okJson({})), fetchCollectorWindow: async () => ({ ...w, messages: [{ ...w.messages[0]!, tPersisted: "x" }] }) });
    expect(await runShadowWorker(candidate(), io)).toEqual({ status: "skipped", code: "collector_not_ready" });
  });
});

describe("B3.3 · worker — lease B3.1 (concorrência, adiadas, recuperação)", () => {
  it("lote já reivindicado por outro worker ⇒ nada; posse alheia intocada", async () => {
    const lease = new ModelLeaseStore(() => new Date(T0).toISOString());
    const other = makeIo({ lease, provider: fakeProvider(okJson(decisionWithCanary())) });
    // outro worker pega e fica com o lote (não conclui)
    await lease.transition(CONV, "observe", 0, { messageIds: [MSG] });
    await lease.transition(CONV, "mark_ready", 1, { messageIds: [MSG] });
    const c = await lease.claim(CONV, 2);
    expect(c.result).toBe("acquired");
    const provider = fakeProvider(okJson(decisionWithCanary()));
    const mine = makeIo({ lease, provider });
    expect(await runShadowWorker(candidate(), mine.io)).toEqual({ status: "skipped", code: "lease_concurrency" });
    expect(provider.calls).toBe(0);
    expect(lease.rec?.state).toBe("claimed");
    void other;
  });
  it("mesmo lote de novo depois de concluído ⇒ nada (sem reprocessar, sem duplicar a medição)", async () => {
    const lease = new ModelLeaseStore(() => new Date(T0).toISOString());
    const store = new MemoryShadowStore();
    const provider = fakeProvider(okJson(decisionWithCanary()));
    const a = makeIo({ lease, store, provider });
    expect((await runShadowWorker(candidate(), a.io)).status).toBe("recorded");
    expect(await runShadowWorker(candidate(), a.io)).toEqual({ status: "skipped", code: "collector_not_ready" });
    expect(provider.calls).toBe(1);
    expect(store.records).toHaveLength(1);
  });
  it("mensagem concluída + nova na cauda ⇒ só a nova vai ao lote (já respondida não volta)", async () => {
    const lease = new ModelLeaseStore(() => new Date(T0).toISOString());
    const store = new MemoryShadowStore();
    const provider = fakeProvider(okJson(decisionWithCanary()));
    const a = makeIo({ lease, store, provider });
    await runShadowWorker(candidate(), a.io);
    const M2 = "22222222-2222-4222-8222-2222222222b2";
    const t = shadowTurn();
    const w = windowOf(t);
    const second = makeIo({
      lease,
      store,
      provider,
      newId: () => "7e000000-0000-4000-8000-0000000000b2",
      fetchCollectorWindow: async () => ({ ...w, messages: [...w.messages, { ...w.messages[0]!, id: M2, text: "e o wifi?", tPersisted: "2026-11-03T10:00:30Z" }] }),
    });
    const r = await runShadowWorker(candidate(), second.io);
    // o lote [M2] não bate com o histórico de teste (que termina em MSG) ⇒ a cadeia recusa, mas o lease só recebeu M2
    expect(r.status).toBe("recorded");
    expect(lease.rec?.messageIds).toEqual([M2]);
  });
  it("pendente do lease anterior à resposta da equipe ⇒ dispensado explicitamente (acknowledge), nunca em silêncio", async () => {
    const lease = new ModelLeaseStore(() => new Date(T0).toISOString());
    const OLD = "22222222-2222-4222-8222-2222222222a1";
    await lease.transition(CONV, "observe", 0, { messageIds: [OLD] });
    const { io } = makeIo({ lease, provider: fakeProvider(okJson(decisionWithCanary())) });
    const r = await runShadowWorker(candidate(), io);
    expect(r.status).toBe("recorded");
    expect(lease.events).toContain("acknowledge");
    expect(lease.rec?.messageIds).toEqual([MSG]);
  });
  it("leitura do lease falha ⇒ falha técnica de integridade do lease, sem Gateway", async () => {
    const lease = new ModelLeaseStore(() => new Date(T0).toISOString());
    lease.failLoad = true;
    const provider = fakeProvider(okJson({}));
    const { io, store } = makeIo({ lease, provider });
    expect(await runShadowWorker(candidate(), io)).toEqual({ status: "recorded", decision: "technical_failure" });
    expect(store.records[0]!.technicalCode).toBe("lease_integrity_failure");
    expect(provider.calls).toBe(0);
  });
});

describe("B3.3 · worker — Gateway, orçamento, desligamento e prazo", () => {
  it("erro do Gateway ⇒ falha técnica sem conteúdo do erro; lote em fail (não concluído); sem nova tentativa do worker", async () => {
    const provider = fakeProvider({ kind: "error", error: { code: "provider_unavailable", retryable: true, httpStatus: 503 }, usage: null, requestId: null });
    const { io, store, lease } = makeIo({ provider });
    expect(await runShadowWorker(candidate(), io)).toEqual({ status: "recorded", decision: "technical_failure" });
    const rec = store.records[0]!;
    expect(rec).toMatchObject({ technicalCode: "gateway_error", gatewayError: "provider_unavailable", executionState: "failed" });
    // a nova tentativa interna é a do Gateway (1, dentro do orçamento reservado); o worker não repete
    expect(provider.calls).toBe(2);
    expect(lease.rec?.state).toBe("failed");
  });
  it("orçamento por turno excedido ⇒ budget_blocked, nenhuma rede", async () => {
    const store = new MemoryShadowStore();
    store.control = fullControl({ maxInputTokens: 10 });
    const provider = fakeProvider(okJson({}));
    const { io } = makeIo({ store, provider });
    expect(await runShadowWorker(candidate(), io)).toEqual({ status: "recorded", decision: "budget_blocked" });
    expect(store.records[0]).toMatchObject({ budgetExceeded: "turn_input_tokens", blockCode: "budget_turn_exceeded" });
    expect(provider.calls).toBe(0);
  });
  it("teto diário (US$ 1,00) atingido ⇒ budget_blocked + budget_exhausted, nenhuma rede", async () => {
    const store = new MemoryShadowStore();
    store.settledCost = 0.9999;
    const provider = fakeProvider(okJson({}));
    const { io } = makeIo({ store, provider });
    expect(await runShadowWorker(candidate(), io)).toEqual({ status: "recorded", decision: "budget_blocked" });
    expect(store.trips).toEqual([{ to: "budget_exhausted", reason: "budget_limit_reached" }]);
    expect(provider.calls).toBe(0);
  });
  it("falha da reserva ⇒ budget_blocked, nenhuma rede", async () => {
    const store = new MemoryShadowStore();
    store.fail.reserve = true;
    const provider = fakeProvider(okJson({}));
    const { io } = makeIo({ store, provider });
    expect(await runShadowWorker(candidate(), io)).toEqual({ status: "recorded", decision: "budget_blocked" });
    expect(provider.calls).toBe(0);
  });
  it("uso real acima do limite por turno ⇒ violação registrada + budget_exhausted", async () => {
    const { io, store } = makeIo({ provider: fakeProvider(okJson(decisionWithCanary(), { inputTokens: 999_999, outputTokens: 10, totalTokens: 1_000_009 })) });
    await runShadowWorker(candidate(), io);
    expect(store.records[0]).toMatchObject({ tokenLimitViolation: true, budgetExceeded: "turn_input_tokens" });
    expect(store.trips).toContainEqual({ to: "budget_exhausted", reason: "token_limit_violation" });
  });
  it("desligamento global DURANTE a chamada ⇒ resultado descartado (aborted_by_shutdown), sem texto", async () => {
    const store = new MemoryShadowStore();
    const provider = fakeProvider(() => {
      store.control = { ...store.control!, state: "paused", stateVersion: 8 };
      return okJson(decisionWithCanary());
    });
    const { io, lease } = makeIo({ store, provider });
    expect(await runShadowWorker(candidate(), io)).toEqual({ status: "recorded", decision: "aborted_by_shutdown" });
    expect(store.records[0]).toMatchObject({ executionState: "aborted", candidateAvailable: false });
    expect(everything(store.records)).not.toContain(CANARY);
    expect(lease.rec?.state).toBe("failed");
  });
  it("estado muda entre a leitura inicial e a chamada ⇒ nenhuma rede (relido antes da rede)", async () => {
    const store = new MemoryShadowStore();
    let reads = 0;
    const orig = store.readControl.bind(store);
    store.readControl = async () => {
      reads++;
      if (reads === 2) store.control = { ...store.control!, stateVersion: 99 };
      return orig();
    };
    const provider = fakeProvider(okJson({}));
    const { io } = makeIo({ store, provider });
    expect(await runShadowWorker(candidate(), io)).toEqual({ status: "recorded", decision: "aborted_by_shutdown" });
    expect(provider.calls).toBe(0);
  });
  it("tempo-limite do Gateway (= prazo restante) chega antes do timer do prazo ⇒ mesmo desfecho: shadow_timeout/timed_out (determinístico sob carga)", async () => {
    const provider = fakeProvider({ kind: "error", error: { code: "timeout", retryable: false, httpStatus: null }, usage: null, requestId: null });
    const { io, store, lease } = makeIo({ provider });
    expect(await runShadowWorker(candidate(), io)).toEqual({ status: "recorded", decision: "technical_failure" });
    expect(store.records[0]).toMatchObject({ technicalCode: "shadow_timeout", executionState: "timed_out", timeout: true });
    expect(lease.rec?.state).toBe("failed");
  });
  it("prazo de processamento (13,5 s) esgota durante o Gateway ⇒ shadow_timeout; nada parcial; finalização preservada", async () => {
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const schedule = (fn: () => void, ms: number) => {
      timers.push({ fn, ms });
      return () => undefined;
    };
    const provider = fakeProvider(
      () =>
        new Promise((_, reject) => {
          // dispara o prazo de PROCESSAMENTO do ShadowDeadline (único sinal) enquanto a chamada está pendente
          const t = timers.find((x) => x.ms === SHADOW_DEADLINE_MS - SHADOW_FINALIZATION_RESERVE_MS)!;
          setTimeout(() => t.fn(), 0);
          setTimeout(() => reject(new Error("aborted")), 5);
        }),
    );
    const { io, store, lease } = makeIo({ provider, schedule });
    const r = await runShadowWorker(candidate(), io);
    expect(r).toEqual({ status: "recorded", decision: "technical_failure" });
    expect(store.records[0]).toMatchObject({ technicalCode: "shadow_timeout", executionState: "timed_out", timeout: true });
    expect(lease.rec?.state).toBe("failed");
    // o prazo global agenda exatamente DOIS marcos (13,5 s de processamento e 15 s absolutos) ...
    expect(timers.filter((t) => t.ms === SHADOW_DEADLINE_MS).length).toBe(1);
    expect(timers.filter((t) => t.ms === SHADOW_DEADLINE_MS - SHADOW_FINALIZATION_RESERVE_MS).length).toBe(1);
    // ... e NENHUMA etapa da cadeia recebe prazo próprio maior que o que resta do processamento
    expect(Math.max(...timers.filter((t) => t.ms !== SHADOW_DEADLINE_MS).map((t) => t.ms))).toBeLessThanOrEqual(SHADOW_DEADLINE_MS - SHADOW_FINALIZATION_RESERVE_MS);
  });
  it("finalização sem resposta (transporte) ⇒ UMA repetição idempotente; record_failed SEM disparo de disjuntor (F-12)", async () => {
    const store = new MemoryShadowStore();
    store.fail.finalize = true;
    const { io } = makeIo({ store, provider: fakeProvider(okJson(decisionWithCanary())) });
    expect(await runShadowWorker(candidate(), io)).toEqual({ status: "record_failed", decision: "answer_candidate" });
    expect(store.calls.filter((c) => c === "finalize")).toHaveLength(2);
    expect(store.trips).toEqual([]);
  });
  it("finalização RECUSADA pelo banco (registro inválido) ⇒ record_failed + technical_failure global (medição comprometida)", async () => {
    const store = new MemoryShadowStore();
    store.finalizeExecution = async () => ({ kind: "invalid" });
    const { io } = makeIo({ store, provider: fakeProvider(okJson(decisionWithCanary())) });
    expect(await runShadowWorker(candidate(), io)).toEqual({ status: "record_failed", decision: "answer_candidate" });
    expect(store.trips).toEqual([{ to: "technical_failure", reason: "telemetry_failure" }]);
  });
  it("resposta da finalização perdida DEPOIS do commit ⇒ a repetição recebe `duplicate` ⇒ recorded, sem disparo", async () => {
    const store = new MemoryShadowStore();
    const real = store.finalizeExecution.bind(store);
    let n = 0;
    store.finalizeExecution = async (a) => {
      const r = await real(a);
      return ++n === 1 ? { kind: "error" } : r;
    };
    const { io } = makeIo({ store, provider: fakeProvider(okJson(decisionWithCanary())) });
    expect(await runShadowWorker(candidate(), io)).toEqual({ status: "recorded", decision: "answer_candidate" });
    expect(store.records).toHaveLength(1);
    expect(store.trips).toEqual([]);
  });
  it("gravação SEM lote (antes da reivindicação) recusada ⇒ record_failed + technical_failure; transporte ⇒ repete e não dispara", async () => {
    const store = new MemoryShadowStore();
    store.gateBlocked.set(shadowTurn().propertyId, "no_guest_channel");
    store.fail.record = true;
    const { io } = makeIo({ store, provider: fakeProvider(okJson({})) });
    expect(await runShadowWorker(candidate(), io)).toEqual({ status: "record_failed", decision: "blocked_not_authorized" });
    expect(store.calls.filter((c) => c === "record")).toHaveLength(2);
    expect(store.trips).toEqual([]);
    const s2 = new MemoryShadowStore();
    s2.gateBlocked.set(shadowTurn().propertyId, "no_guest_channel");
    s2.record = async () => ({ kind: "invalid" });
    const b = makeIo({ store: s2, provider: fakeProvider(okJson({})) });
    expect(await runShadowWorker(candidate(), b.io)).toEqual({ status: "record_failed", decision: "blocked_not_authorized" });
    expect(s2.trips).toEqual([{ to: "technical_failure", reason: "telemetry_failure" }]);
  });
  it("exceção inesperada em qualquer porta nunca escapa (nem seu texto)", async () => {
    const { io } = makeIo({ provider: fakeProvider(okJson({})), storeFor: () => { throw new Error(CANARY); } });
    const r = await runShadowWorker(candidate(), io);
    expect(r).toEqual({ status: "skipped", code: "state_unreadable" });
    expect(everything(r)).not.toContain(CANARY);
  });
});
