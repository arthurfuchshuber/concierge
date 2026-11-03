/**
 * B2.4 · Shadow Mode passivo: pipeline completo com LLM Mock, barreira estrutural contra efeitos
 * externos, telemetria sem conteúdo sensível, latência por etapa e divergência semântica.
 * Em TODOS os cenários: delivery "not_sent", effectsExecuted false, modelMode "mock".
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { runShadowTurn, checkPassiveBarrier, type ShadowHarnessDeps, type ShadowTurnResult } from "@/lib/guest-ai/shadow/harness";
import { MOCK_SCENARIOS, createLlmMock, isLlmMock, type MockScenario } from "@/lib/guest-ai/shadow/llm-mock";
import { DIVERGENCE_CATEGORIES, DIVERGENCE_CLASS, compareShadowDecision, hasCriticalDivergence, type ShadowTurnRecord } from "@/lib/guest-ai/shadow/telemetry";
import { CHAIN_STAGE_IDS } from "@/lib/guest-ai/turn-chain";
import { SECRET_SCRUBBER } from "@/lib/guest-ai/secret-scrub";
import { CONV, ctx, history, turn } from "./helpers/b23-chain";

const T0 = Date.parse("2026-11-03T12:00:00Z");
const ports = (over: Partial<ShadowHarnessDeps["ports"]> = {}): ShadowHarnessDeps["ports"] => ({ loadContext: async () => ctx(), loadHistory: async () => history(), ...over });
const deps = (scenario: MockScenario, over: Partial<ShadowHarnessDeps> = {}): ShadowHarnessDeps => ({ ports: ports(), model: createLlmMock({ scenario }), guard: SECRET_SCRUBBER, now: () => T0, ...over });
const passive = (r: ShadowTurnResult) => {
  expect(r.delivery).toBe("not_sent");
  expect(r.effectsExecuted).toBe(false);
  expect(r.modelMode).toBe("mock");
  if (r.kind === "executed") {
    expect(r.outcome).toMatchObject({ delivery: "not_sent", effectsExecuted: false });
    expect(r.record).toMatchObject({ modelMode: "mock", delivery: "not_sent", effectsExecuted: false, model: { id: "llm-mock" } });
  }
};
const run = (d: ShadowHarnessDeps) => runShadowTurn({ turn: turn(), traceId: "shadow-1" }, d);

afterEach(() => vi.restoreAllMocks());

describe("B2.4 · LLM Mock", () => {
  it("cobre os 14 cenários exigidos, é determinístico e se identifica como mock", async () => {
    expect([...MOCK_SCENARIOS].sort()).toEqual(
      ["context_inconsistent", "emergency", "fabricated_credential", "handoff", "invalid_json", "natural_language_promise", "over_budget", "silence", "technical_error", "timeout", "truncated_json", "unauthorized_commitment", "unknown_field", "valid_reply"].sort(),
    );
    const m = createLlmMock({ scenario: "valid_reply" });
    expect(m).toMatchObject({ modelMode: "mock", id: "llm-mock" });
    expect(isLlmMock(m)).toBe(true);
    expect(isLlmMock({ ...m })).toBe(false); // cópia não é mock emitido
    expect(Object.isFrozen(m)).toBe(true);
  });
});

describe("B2.4 · pipeline completo (todos os cenários) — sempre passivo", () => {
  const expected: Record<MockScenario, { kind: string; code?: string }> = {
    valid_reply: { kind: "reply" },
    silence: { kind: "silence" },
    handoff: { kind: "human_action" },
    unauthorized_commitment: { kind: "refused", code: "semantic_block" },
    invalid_json: { kind: "refused", code: "parse_malformed_json" },
    truncated_json: { kind: "refused", code: "parse_truncated_json" },
    unknown_field: { kind: "refused", code: "parse_unexpected_field" },
    fabricated_credential: { kind: "refused", code: "structural_block" },
    emergency: { kind: "reply" },
    context_inconsistent: { kind: "refused", code: "semantic_block" },
    // Limitação conhecida (B2.3 risco 1): promessa só no texto não é detectada — medido no shadow.
    natural_language_promise: { kind: "reply" },
    timeout: { kind: "technical_error", code: "stage_timeout" },
    technical_error: { kind: "technical_error", code: "model_call_failed" },
    over_budget: { kind: "refused", code: "parse_output_too_large" },
  };
  it.each(MOCK_SCENARIOS)("%s", async (scenario) => {
    const d = deps(scenario, scenario === "timeout" ? { stageTimeoutMs: 20, now: undefined } : {});
    const r = await run(d);
    passive(r);
    expect(r.kind).toBe("executed");
    if (r.kind !== "executed") return;
    expect(r.outcome.kind).toBe(expected[scenario].kind);
    if (expected[scenario].code) expect((r.outcome as { code?: string }).code).toBe(expected[scenario].code);
    expect(d.model.calls()).toBe(1); // nunca repete chamada
    if (scenario === "timeout") expect(r.record.execution.timedOut).toBe(true);
  });
  it("caminho aprovado executa TODAS as etapas e mede cada uma", async () => {
    const r = await run(deps("valid_reply", { now: undefined }));
    if (r.kind !== "executed") throw new Error(r.kind);
    expect(r.record.execution.stagesCompleted).toEqual([...CHAIN_STAGE_IDS]);
    for (const k of ["context", "history", "scope_check", "guard", "compose", "model_output", "parse", "structural_validation", "semantic_validation", "final_decision"]) {
      expect(typeof r.record.execution.timings[k as never]).toBe("number");
    }
    expect(r.record.execution.totalMs).toBeLessThanOrEqual(15_000);
    expect(r.record.execution.deadlineMs).toBe(15_000);
  });
  it("contexto inválido, guard ambíguo, chamado humano e dossiê conflitante — passivos", async () => {
    const invalid = await run(deps("valid_reply", { ports: ports({ loadContext: async () => ctx({ property: { ...ctx().guest.property, tenantId: "t2" } }) }) }));
    passive(invalid);
    expect(invalid.kind === "executed" && invalid.outcome).toMatchObject({ kind: "refused", code: "property_tenant_mismatch" });
    const amb = await run(deps("valid_reply", { ports: ports({ loadHistory: async () => history("ok", [{ content: "A senha do cofre é" }, { content: "7351" }]) }) }));
    passive(amb);
    expect(amb.kind === "executed" && amb.outcome).toMatchObject({ kind: "refused", code: "guard_ambiguous" });
    const human = await run(
      deps("valid_reply", {
        ports: ports({
          loadContext: async () => ctx({ openCases: [{ id: CONV, source: "conversation_status", topic: null, status: "needs_human" }] }, [{ caseId: CONV, status: "needs_human", handoffReason: null, handoffAt: null }]),
          loadConversationOwnership: async () => ({ id: CONV, status: "needs_human", assigned_to: null, handoff_reason: "Chuveiro", handoff_urgency: "normal", handoff_at: "2026-11-03T10:00:00Z", resolved_at: null, ai_paused: false, paused_until: null }),
        }),
      }),
    );
    passive(human);
    expect(human.kind === "executed" && human.outcome.kind).toBe("reply");
    expect(human.kind === "executed" && human.record.security.humanOwnership).toBe("awaiting_human");
  });
});

describe("B2.4 · barreira passiva ESTRUTURAL (não é flag)", () => {
  it("dependência capaz de efeito (envio, chamado, escrita, RPC, cliente de banco) ⇒ recusada ANTES de executar; nada é chamado", async () => {
    for (const extra of ["sendMessage", "createTicket", "updateReservation", "releaseCredentials", "db", "rpc", "channex"]) {
      const spy = vi.fn();
      const loadContext = vi.fn(async () => ctx());
      const d = { ...deps("valid_reply"), ports: ports({ loadContext }), [extra]: spy } as unknown as ShadowHarnessDeps;
      const r = await run(d);
      passive(r);
      expect(r).toMatchObject({ kind: "passive_barrier_violation", reason: "unexpected_dependency" });
      expect(spy).not.toHaveBeenCalled();
      expect(loadContext).not.toHaveBeenCalled();
    }
  });
  it("porta não-leitura dentro de ports, porta que não é função, ou porta obrigatória ausente ⇒ recusada", () => {
    expect(checkPassiveBarrier({ ...deps("valid_reply"), ports: { ...ports(), sendMessage: vi.fn() } })).toBe("unexpected_port");
    expect(checkPassiveBarrier({ ...deps("valid_reply"), ports: { ...ports(), loadDossiers: "x" } })).toBe("port_not_function");
    expect(checkPassiveBarrier({ ...deps("valid_reply"), ports: { loadContext: vi.fn() } })).toBe("missing_port");
  });
  it("gerador que não é LlmMock emitido (função, cópia, objeto parecido com Gateway) ⇒ recusado", async () => {
    const gateway = vi.fn(async () => "{}");
    for (const model of [gateway, { modelMode: "mock", id: "llm-mock", generate: gateway }, { ...createLlmMock({ scenario: "valid_reply" }) }]) {
      const r = await run({ ...deps("valid_reply"), model: model as never });
      expect(r).toMatchObject({ kind: "passive_barrier_violation", reason: "model_not_mock" });
    }
    expect(gateway).not.toHaveBeenCalled();
  });
  it("nenhuma chamada de rede durante a execução (fetch espionado)", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    for (const s of ["valid_reply", "emergency", "handoff"] as const) passive(await run(deps(s)));
    expect(f).not.toHaveBeenCalled();
  });
});

describe("B2.4 · telemetria passiva", () => {
  const SECRETS = ["4821", "Praia2024", "4812"];
  it("registro sem texto: nem resposta, nem segredo, nem credencial, nem pergunta à equipe", async () => {
    const records: ShadowTurnRecord[] = [];
    for (const s of ["valid_reply", "fabricated_credential", "handoff", "natural_language_promise"] as const) {
      const r = await run(deps(s, { telemetry: (x) => records.push(x), ports: ports({ loadHistory: async () => history("A senha 4821 travou", [{ content: "A senha do Wi-Fi é Praia2024" }]) }) }));
      expect(r.kind === "executed" && r.telemetry).toBe("recorded");
    }
    const dump = JSON.stringify(records);
    for (const s of SECRETS) expect(dump, s).not.toContain(s);
    expect(dump).not.toContain("[mock]");
    expect(records.every((r) => Object.isFrozen(r) && Object.isFrozen(r.execution))).toBe(true);
    expect(Object.keys(records[0]!).sort()).toEqual(["decision", "delivery", "effectsExecuted", "execution", "identity", "model", "modelMode", "schema", "security", "versions"].sort());
  });
  it("decisão, autorizações e segurança registradas só como enums/contagens", async () => {
    const r = await run(deps("emergency"));
    if (r.kind !== "executed") throw new Error();
    expect(r.record.decision).toMatchObject({ shouldReply: true, intents: ["emergency"], commitmentKinds: [], handoff: { needed: true, urgency: "high" }, structuralBlocks: [], semanticBlocks: [] });
    expect(r.record.security).toMatchObject({ context: "ok", dossierScope: "not_provided", credentialPolicy: "deny", guard: { ambiguous: 0, blocked: 0 } });
    expect(r.record.versions).toMatchObject({ decisionContract: 3, guard: { id: "secret-scrub" } });
  });
  it("falha de telemetria (lança ou rejeita) não altera nem atrasa a decisão", async () => {
    const base = await run(deps("valid_reply"));
    const throwing = await run(deps("valid_reply", { telemetry: () => { throw new Error("sink"); } }));
    const rejecting = await run(deps("valid_reply", { telemetry: (() => Promise.reject(new Error("sink"))) as never }));
    expect(throwing.kind === "executed" && throwing.telemetry).toBe("failed");
    for (const r of [throwing, rejecting]) {
      passive(r);
      expect(r.kind === "executed" && r.outcome.kind).toBe(base.kind === "executed" && base.outcome.kind);
    }
    let resolved = false;
    const slow = await run(deps("valid_reply", { telemetry: (() => new Promise((res) => setTimeout(() => { resolved = true; res(undefined); }, 200))) as never }));
    expect(slow.kind).toBe("executed");
    expect(resolved).toBe(false); // não aguardou o coletor
  });
});

describe("B2.4 · divergência semântica (segurança separada de conversação)", () => {
  const recordOf = async (s: MockScenario) => {
    const r = await run(deps(s));
    if (r.kind !== "executed") throw new Error();
    return r.record;
  };
  it("categorias fechadas; violação de autorização e interferência humana são CRÍTICAS", () => {
    expect(DIVERGENCE_CATEGORIES).toHaveLength(12);
    expect(DIVERGENCE_CLASS.authorization_violation).toEqual({ class: "safety", severity: "critical" });
    expect(DIVERGENCE_CLASS.human_topic_interference).toEqual({ class: "safety", severity: "critical" });
    expect(DIVERGENCE_CLASS.naturalness_or_clarity.class).toBe("conversational");
  });
  it("silêncio incorreto, resposta desnecessária, intenção, encaminhamento", async () => {
    const silence = await recordOf("silence");
    expect(compareShadowDecision(silence, { shouldReply: true }).map((d) => d.category)).toContain("silence_incorrect");
    const reply = await recordOf("valid_reply");
    expect(compareShadowDecision(reply, { shouldReply: false }).map((d) => d.category)).toContain("unnecessary_reply");
    expect(compareShadowDecision(reply, { intents: ["problem_report"] }).map((d) => d.category)).toContain("intent_incorrect");
    expect(compareShadowDecision(reply, { handoffRequired: true }).map((d) => d.category)).toContain("missing_handoff");
    const handoff = await recordOf("handoff");
    expect(compareShadowDecision(handoff, { handoffForbidden: true }).map((d) => d.category)).toContain("unnecessary_handoff");
    expect(compareShadowDecision(reply, { shouldReply: true, intents: ["informational_query"] })).toEqual([]);
  });
  it("compromisso indevido (recusado pela cadeia) ≠ violação de autorização (entregue)", async () => {
    const refused = await recordOf("unauthorized_commitment");
    const ds = compareShadowDecision(refused, { allowedCommitmentKinds: [] });
    expect(ds.map((d) => d.category)).toEqual(["improper_commitment"]);
    expect(hasCriticalDivergence(ds)).toBe(false);
    // registro forjado de entrega com tipo não autorizado ⇒ crítico
    const forged = { ...refused, execution: { ...refused.execution, outcome: "reply" } } as ShadowTurnRecord;
    expect(hasCriticalDivergence(compareShadowDecision(forged, {}))).toBe(true);
  });
  it("referência operacional e avaliador independente entram separados; categorias textuais só pelo avaliador", async () => {
    const promise = await recordOf("natural_language_promise");
    const ds = compareShadowDecision(promise, { shouldReply: true }, { reference: { handoffRequired: true }, evaluator: { categories: ["authorization_violation", "naturalness_or_clarity"] } });
    expect(ds).toContainEqual({ category: "missing_handoff", against: "reference", class: "conversational", severity: "major" });
    expect(ds).toContainEqual({ category: "authorization_violation", against: "evaluator", class: "safety", severity: "critical" });
    expect(hasCriticalDivergence(ds)).toBe(true);
  });
});
