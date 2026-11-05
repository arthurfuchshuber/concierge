/**
 * B3.3 · Entrega 2 — rota `/api/public/guest-ai/shadow-tick` e tick. Chave mestra desligada ⇒ 404 sem
 * ler NADA; segredo inválido ⇒ 401; portão de liberação em código fechado ⇒ `not_released`. Query, body e
 * cabeçalhos nunca substituem a chave mestra. Respostas só com códigos e contadores.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleShadowTick, runShadowTick, SHADOW_TICK_RELEASED } from "@/lib/guest-ai/shadow-exec/tick.server";
import { Route } from "@/routes/api/public/guest-ai.shadow-tick";
import { CANARY, MemoryShadowStore, candidate, fullControl, manifestOf } from "./helpers/b33-shadow";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const req = (over: { headers?: Record<string, string>; url?: string; body?: string } = {}) =>
  new Request(over.url ?? "https://x.test/api/public/guest-ai/shadow-tick", { method: "POST", headers: over.headers ?? {}, body: over.body ?? null });

const spies = () => ({
  store: vi.fn(async () => new MemoryShadowStore()),
  candidates: vi.fn(async () => ({ ok: true as const, candidates: [candidate()] })),
  worker: vi.fn(async () => ({ status: "recorded" as const, decision: "answer_candidate" as const })),
});

describe("B3.3 · rota desligada", () => {
  it("portão de liberação é `false` nesta entrega", () => {
    expect(SHADOW_TICK_RELEASED).toBe(false);
  });
  it("GUEST_AI_SHADOW=off (ou ausente, ou qualquer coisa ≠ on) ⇒ 404 sem ler segredo, corpo, banco, candidatas ou worker", async () => {
    for (const v of ["off", "", "ON", "true", "1"]) {
      vi.stubEnv("GUEST_AI_SHADOW", v);
      const s = spies();
      const verifySecret = vi.fn(() => true);
      const r = await handleShadowTick(req({ headers: { authorization: "Bearer x", "x-guest-ai-shadow": "on" }, url: "https://x.test/t?GUEST_AI_SHADOW=on", body: JSON.stringify({ GUEST_AI_SHADOW: "on" }) }), { ...s, verifySecret, released: true });
      expect(r.status).toBe(404);
      expect(await r.text()).toBe("");
      expect(verifySecret).not.toHaveBeenCalled();
      expect(s.store).not.toHaveBeenCalled();
      expect(s.candidates).not.toHaveBeenCalled();
      expect(s.worker).not.toHaveBeenCalled();
    }
  });
  it("chave ligada + segredo ausente/inválido ⇒ 401, nada executa", async () => {
    vi.stubEnv("GUEST_AI_SHADOW", "on");
    vi.stubEnv("CRON_SECRET", "segredo-certo");
    const s = spies();
    for (const headers of [{}, { authorization: "Bearer errado" }, { "x-cron-secret": "errado" }] as Array<Record<string, string>>) {
      const r = await handleShadowTick(req({ headers }), { ...s, released: true });
      expect(r.status).toBe(401);
    }
    expect(s.store).not.toHaveBeenCalled();
    expect(s.worker).not.toHaveBeenCalled();
  });
  it("chave ligada + segredo válido + portão FECHADO ⇒ `not_released`, nada executa", async () => {
    vi.stubEnv("GUEST_AI_SHADOW", "on");
    vi.stubEnv("CRON_SECRET", "segredo-certo");
    const s = spies();
    const r = await handleShadowTick(req({ headers: { authorization: "Bearer segredo-certo" } }), s);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ outcome: "not_released", conversationsConsidered: 0, executed: 0, blocked: 0, failed: 0 });
    expect(s.store).not.toHaveBeenCalled();
    expect(s.candidates).not.toHaveBeenCalled();
    expect(s.worker).not.toHaveBeenCalled();
  });
  it("o módulo da rota (handler real) com a chave desligada ⇒ 404; exceção ⇒ código fixo sem conteúdo", async () => {
    vi.stubEnv("GUEST_AI_SHADOW", "off");
    const post = (Route as unknown as { options: { server: { handlers: { POST: (a: { request: Request }) => Promise<Response> } } } }).options.server.handlers.POST;
    const r = await post({ request: req() });
    expect(r.status).toBe(404);
    vi.doMock("@/lib/guest-ai/shadow-exec/tick.server", () => ({ handleShadowTick: async () => { throw new Error(CANARY); } }));
    const r2 = await post({ request: req() });
    expect(r2.status).toBe(500);
    expect(await r2.text()).not.toContain(CANARY);
    vi.doUnmock("@/lib/guest-ai/shadow-exec/tick.server");
  });
});

describe("B3.3 · tick (só alcançável com o portão aberto — testado com portão injetado)", () => {
  const open = (s = spies()) => ({ ...s, masterSwitchOn: () => true, verifySecret: () => true, released: true });
  it("executa as candidatas em série e devolve SÓ contadores", async () => {
    const s = spies();
    const store = new MemoryShadowStore();
    s.store.mockResolvedValue(store);
    s.candidates.mockResolvedValue({ ok: true, candidates: [candidate(), candidate(), candidate()] });
    s.worker.mockResolvedValueOnce({ status: "recorded", decision: "answer_candidate" }).mockResolvedValueOnce({ status: "skipped", code: "collector_not_ready" } as never).mockResolvedValueOnce({ status: "recorded", decision: "silence" } as never);
    const r = await handleShadowTick(req(), open(s));
    expect(await r.json()).toEqual({ outcome: "executed", conversationsConsidered: 3, executed: 2, blocked: 1, failed: 0 });
    // E3.1: ≤ 3 conversas por tick; instante das candidatas = relógio do BANCO; trava adquirida, reconciliação antes, trava liberada no fim
    expect(s.candidates).toHaveBeenCalledWith(store.manifest!.entries, expect.objectContaining({ limit: 3, tickIntervalSeconds: 60, nowMs: store.control!.dbNowMs }));
    expect(s.worker).toHaveBeenCalledWith(expect.anything(), "c".repeat(64));
    expect(store.calls.filter((c) => ["acquireTick", "reconcile", "releaseTick"].includes(c))).toEqual(["acquireTick", "reconcile", "releaseTick"]);
  });
  it("E3.1 · F-07: trava do tick ocupada ⇒ `tick_busy` sem candidatas nem worker; falha da trava/reconciliação ⇒ `tick_failed`; trava sempre liberada", async () => {
    const cases: Array<[(st: MemoryShadowStore) => void, string, boolean]> = [
      [(st) => (st.acquireTick = async () => ({ kind: "busy" })), "tick_busy", false],
      [(st) => (st.acquireTick = async () => ({ kind: "blocked", code: "state_not_running" })), "state_not_running", false],
      [(st) => (st.acquireTick = async () => ({ kind: "blocked", code: "config_incomplete" })), "limits_missing", false],
      [(st) => (st.fail.tick = true), "tick_failed", false],
      [(st) => (st.fail.reconcile = true), "tick_failed", true],
    ];
    for (const [setup, outcome, released] of cases) {
      const s = spies();
      const st = new MemoryShadowStore();
      setup(st);
      s.store.mockResolvedValue(st);
      expect((await runShadowTick(s)).outcome, outcome).toBe(outcome);
      expect(s.candidates).not.toHaveBeenCalled();
      expect(s.worker).not.toHaveBeenCalled();
      expect(st.calls.includes("releaseTick"), outcome).toBe(released);
    }
    // candidatas acima do teto são cortadas em 3; trava perdida no meio ⇒ para
    const s = spies();
    const st = new MemoryShadowStore();
    s.store.mockResolvedValue(st);
    s.candidates.mockResolvedValue({ ok: true, candidates: [candidate(), candidate(), candidate(), candidate(), candidate()] });
    s.worker.mockResolvedValue({ status: "recorded", decision: "silence" } as never);
    expect(await runShadowTick(s)).toEqual({ outcome: "executed", conversationsConsidered: 3, executed: 3, blocked: 0, failed: 0 });
    const s2 = spies();
    s2.store.mockResolvedValue(new MemoryShadowStore());
    s2.candidates.mockResolvedValue({ ok: true, candidates: [candidate(), candidate()] });
    s2.worker.mockResolvedValue({ status: "skipped", code: "tick_not_held" } as never);
    expect(await runShadowTick(s2)).toEqual({ outcome: "executed", conversationsConsidered: 2, executed: 0, blocked: 1, failed: 0 });
    expect(s2.worker).toHaveBeenCalledTimes(1);
    // liberação que falha nunca derruba o tick
    const s3 = spies();
    const st3 = new MemoryShadowStore();
    st3.releaseTick = async () => { throw new Error(CANARY); };
    s3.store.mockResolvedValue(st3);
    s3.candidates.mockResolvedValue({ ok: true, candidates: [] });
    expect((await runShadowTick(s3)).outcome).toBe("executed");
  });
  it("falha de gravação interrompe o tick (medição indisponível não continua)", async () => {
    const s = spies();
    s.candidates.mockResolvedValue({ ok: true, candidates: [candidate(), candidate()] });
    s.worker.mockResolvedValue({ status: "record_failed", decision: "technical_failure" } as never);
    expect(await runShadowTick(s)).toEqual({ outcome: "executed", conversationsConsidered: 2, executed: 0, blocked: 0, failed: 1 });
    expect(s.worker).toHaveBeenCalledTimes(1);
  });
  it("estado/configuração/manifesto inválidos ⇒ nada; candidatas com integridade ⇒ disjuntor global", async () => {
    const cases: Array<[(st: MemoryShadowStore) => void, string]> = [
      [(st) => (st.fail.readControl = true), "state_unreadable"],
      [(st) => (st.control = fullControl({ state: "ready" })), "state_not_running"],
      [(st) => (st.control = fullControl({ maxConversationsPerTick: null })), "limits_missing"],
      [(st) => (st.fail.readManifest = true), "manifest_unreadable"],
      [(st) => (st.manifest = manifestOf(undefined, 9)), "manifest_unreadable"],
      [(st) => (st.manifest = manifestOf([])), "no_enabled_properties"], // E4: nenhum imóvel habilitado
    ];
    for (const [setup, outcome] of cases) {
      const s = spies();
      const st = new MemoryShadowStore();
      setup(st);
      s.store.mockResolvedValue(st);
      expect((await runShadowTick(s)).outcome).toBe(outcome);
      expect(s.worker).not.toHaveBeenCalled();
      // portões ANTES de qualquer efeito: estado/configuração/manifesto inválidos nem chegam a pedir a trava do tick
      expect(st.calls).not.toContain("acquireTick");
    }
    const s = spies();
    const st = new MemoryShadowStore();
    s.store.mockResolvedValue(st);
    s.candidates.mockResolvedValue({ ok: false, integrity: true } as never);
    expect((await runShadowTick(s)).outcome).toBe("tick_failed");
    expect(st.trips).toEqual([{ to: "integrity_violation", reason: "integrity_divergence" }]);
    st.control = fullControl(); // o disparo acima levou a integrity_violation (correto); recomeça para o 2º caso
    s.candidates.mockResolvedValue({ ok: false, integrity: false } as never);
    expect((await runShadowTick(s)).outcome).toBe("tick_failed");
    expect(st.trips).toHaveLength(1);
  });
  it("exceção em qualquer ponto ⇒ `tick_failed` sem conteúdo", async () => {
    const s = spies();
    s.store.mockRejectedValue(new Error(CANARY));
    const r = await runShadowTick(s);
    expect(r.outcome).toBe("tick_failed");
    expect(JSON.stringify(r)).not.toContain(CANARY);
    const r2 = await handleShadowTick(req(), { masterSwitchOn: () => true, verifySecret: () => true, released: true, store: s.store as never, candidates: s.candidates, worker: () => { throw new Error(CANARY); } });
    expect(await r2.text()).not.toContain(CANARY);
  });
  it("portão aberto sem io ⇒ ligação de produção (imports dinâmicos); falha dela ⇒ `tick_failed`", async () => {
    vi.doMock("@/lib/guest-ai/shadow-exec/worker.server", () => ({ productionWorkerIo: async () => { throw new Error(CANARY); }, runShadowWorker: vi.fn() }));
    const r = await handleShadowTick(req(), { masterSwitchOn: () => true, verifySecret: () => true, released: true });
    expect(await r.json()).toEqual({ outcome: "tick_failed", conversationsConsidered: 0, executed: 0, blocked: 0, failed: 0 });
    vi.doUnmock("@/lib/guest-ai/shadow-exec/worker.server");
  });
});
