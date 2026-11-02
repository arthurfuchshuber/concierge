import { describe, expect, it } from "vitest";
import type { LlmErrorCode, LlmRequest, LlmResult } from "@/lib/guest-ai/llm/contracts";
import { GuestAiScopeError } from "@/lib/guest-ai/data/scope.server";
import {
  LLM_FALLBACK,
  MIN_LLM_BUDGET_MS,
  POST_LLM_RESERVE_MS,
  isValidTurnRequest,
  runGuestTurn,
  type OrchestratorDeps,
} from "@/lib/guest-ai/orchestrator/orchestrator.server";
import {
  CREDENTIAL_MARKER,
  FALLBACK_KINDS,
  GUEST_AI_DEFAULT_MODEL,
  GUEST_AI_DEFAULT_REASONING,
  TURN_MAX_DEADLINE_MS,
  type ComposedPrompt,
  type ConversationContext,
  type OrchestratorResult,
  type TurnRequest,
} from "@/lib/guest-ai/orchestrator/contracts";
import type { TurnLogEvent } from "@/lib/guest-ai/orchestrator/telemetry";
import type { GuestContext } from "@/lib/guest-ai/types";
import { validDecision } from "./helpers/decision-fixtures";

// ───────────── fixtures ─────────────

const REQ: TurnRequest = {
  surface: "guide_chat",
  conversationId: "11111111-1111-4111-8111-111111111111",
  messageId: "22222222-2222-4222-8222-222222222222",
  expectedOwnerId: "33333333-3333-4333-8333-333333333333",
  mode: "shadow",
  traceId: "run-0001",
};

function guestContext(over: Partial<GuestContext> = {}): GuestContext {
  return {
    version: 1,
    interlocutor: { guestId: "sess-1", conversationId: REQ.conversationId, messageId: REQ.messageId, surface: "guide_chat" },
    property: { id: "p1", tenantId: "t1", name: "Flat ao lado da Santa Casa", timezone: "America/Sao_Paulo", listingFacts: null, dossierKnowledge: null },
    phase: "in_stay",
    stay: null,
    audiences: ["P", "G"],
    access: { credentialsAllowed: false, policyResult: { decision: "allow", allowed: true, reason: "within_release_window", evaluatedAt: "2026-11-02T12:00:00Z" } },
    credentials: null,
    openCases: [],
    uncertainties: [],
    conflicts: [],
    ...over,
  };
}
function ctx(over: Partial<GuestContext> = {}, policy: "allow" | "deny" = "allow"): ConversationContext {
  return {
    guest: guestContext(over),
    credentialPolicy: { decision: policy, reason: policy === "allow" ? "within_release_window" : "outside_release_window" },
    history: { status: "unavailable", reason: "not_loaded" },
    humanOwnership: { openCase: (over.openCases?.length ?? 0) > 0, status: null, handoffReason: null, handoffAt: null },
    hostGuidance: { status: "unavailable", reason: "no_governed_store" },
    precedents: { status: "unavailable", reason: "no_governed_store" },
  };
}
const PROMPT: ComposedPrompt = {
  system: "persona de teste",
  messages: [{ role: "user", content: "Que horas é o check-in?" }],
  sourceIds: new Set(["f:horario_checkin"]),
  promptVersion: "test-v1",
};
const llmTelemetry = (over: Partial<LlmResult["telemetry"]> = {}): LlmResult["telemetry"] => ({
  provider: "fake",
  model: GUEST_AI_DEFAULT_MODEL,
  purpose: "guest_reply",
  latencyMs: 900,
  attempts: 1,
  usage: { inputTokens: 1200, outputTokens: 150, reasoningTokens: 40, totalTokens: 1350, source: "provider" },
  costUsd: 0.000735,
  providerRequestId: "gw-1",
  traceId: REQ.traceId,
  ...over,
});
const llmOk = (json: unknown = validDecision()): LlmResult => ({ ok: true, text: JSON.stringify(json), json, finishReason: "stop", telemetry: llmTelemetry() });
const llmErr = (code: LlmErrorCode, httpStatus: number | null = null): LlmResult => ({ ok: false, error: { code, retryable: false, httpStatus }, telemetry: llmTelemetry({ usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0, source: "none" }, costUsd: 0 }) });

function harness(over: Partial<OrchestratorDeps> = {}) {
  let clock = 0;
  const timers: Array<{ at: number; fn: () => void; done: boolean }> = [];
  const logs: TurnLogEvent[] = [];
  const calls: LlmRequest[] = [];
  const advance = (ms: number) => {
    clock += ms;
    for (const t of [...timers].sort((a, b) => a.at - b.at)) if (!t.done && t.at <= clock) { t.done = true; t.fn(); }
  };
  const deps: OrchestratorDeps = {
    loadContext: async () => ctx(),
    composePrompt: () => PROMPT,
    generate: async (r) => { calls.push(r); clock += 900; return llmOk(); },
    now: () => clock,
    schedule: (fn, ms) => { const t = { at: clock + ms, fn, done: false }; timers.push(t); return () => { t.done = true; }; },
    log: (e) => logs.push(e),
    ...over,
  };
  return { deps, logs, calls, advance, tick: (ms: number) => { clock += ms; }, clock: () => clock };
}
const isFallback = (r: OrchestratorResult, kind: string) => r.kind === "fallback" && r.fallback === kind;

// ───────────── fluxo feliz ─────────────

describe("B1 · Orchestrator — fluxo completo com Gateway simulado", () => {
  it("contexto → prompt → Gateway → decisão → validação ⇒ rascunho shadow com telemetria", async () => {
    const h = harness();
    const r = await runGuestTurn(REQ, h.deps);
    expect(r.kind).toBe("draft");
    if (r.kind !== "draft") return;
    expect(r.decision.strategy).toBe("answer");
    expect(r.validation).toEqual({ verdict: "pass", blocks: [] });
    expect(r.telemetry).toMatchObject({ traceId: "run-0001", mode: "shadow", model: GUEST_AI_DEFAULT_MODEL, reasoningEffort: "low", deadlineMs: 15_000, stage: "done", promptVersion: "test-v1", latencyMs: 900 });
    expect(r.telemetry.llm?.costUsd).toBe(0.000735);
  });

  it("pedido ao Gateway: modelo padrão gemini-3.8-flash, raciocínio low, JSON, system + mensagens, prazo restante, sinal e traceId", async () => {
    const h = harness();
    await runGuestTurn(REQ, h.deps);
    expect(GUEST_AI_DEFAULT_MODEL).toBe("google/gemini-3.8-flash");
    expect(GUEST_AI_DEFAULT_REASONING).toBe("low");
    const c = h.calls[0]!;
    expect(c).toMatchObject({ purpose: "guest_reply", model: "google/gemini-3.8-flash", reasoningEffort: "low", responseFormat: "json", maxOutputTokens: 1024, traceId: "run-0001" });
    expect(c.messages).toEqual([{ role: "system", content: "persona de teste" }, { role: "user", content: "Que horas é o check-in?" }]);
    expect(c.timeoutMs).toBe(TURN_MAX_DEADLINE_MS - POST_LLM_RESERVE_MS);
    expect(c.signal).toBeInstanceOf(AbortSignal);
    expect(c.forbiddenValues).toBeUndefined(); // não há credencial alguma em memória para proteger
  });

  it("o prazo do Gateway desconta o tempo já gasto com o contexto", async () => {
    const h = harness();
    h.deps.loadContext = async () => { h.tick(4_000); return ctx(); };
    await runGuestTurn(REQ, h.deps);
    expect(h.calls[0]!.timeoutMs).toBe(15_000 - 4_000 - POST_LLM_RESERVE_MS);
  });

  it("um log por turno, só campos da lista branca, sem nenhum texto (resposta, pergunta, compromissos, prompt)", async () => {
    const h = harness();
    h.deps.generate = async () => llmOk(validDecision({ reply: "Resposta secreta ao hóspede", commitments: ["compromisso secreto"], missingInformation: ["lacuna secreta"] }));
    await runGuestTurn(REQ, h.deps);
    expect(h.logs).toHaveLength(1);
    expect(Object.keys(h.logs[0]!).sort()).toEqual(
      ["event", "traceId", "mode", "outcome", "fallback", "llmCode", "stage", "model", "reasoningEffort", "latencyMs", "deadlineMs", "llmLatencyMs", "inputTokens", "outputTokens", "reasoningTokens", "costUsd", "validatorVerdict", "validatorBlocks", "strategy", "credentialIntent", "handoffNeeded", "groundedOnCount", "capabilityNeedsCount", "promptVersion"].sort(),
    );
    const json = JSON.stringify(h.logs);
    for (const leak of ["Resposta secreta", "compromisso secreto", "lacuna secreta", "persona de teste", "Que horas"]) expect(json).not.toContain(leak);
    expect(h.logs[0]).toMatchObject({ event: "guest_ai.turn", outcome: "draft", inputTokens: 1200, outputTokens: 150, reasoningTokens: 40, costUsd: 0.000735, validatorVerdict: "pass", strategy: "answer" });
  });
});

// ───────────── fallbacks ─────────────

describe("B1 · Orchestrator — fallbacks tipados (fail-closed)", () => {
  it("mapeamento EXAUSTIVO dos 17 códigos do Gateway", async () => {
    const codes = Object.keys(LLM_FALLBACK) as LlmErrorCode[];
    expect(codes).toHaveLength(17);
    for (const code of codes) {
      expect(FALLBACK_KINDS).toContain(LLM_FALLBACK[code]);
      const h = harness({ generate: async () => llmErr(code, 503) });
      const r = await runGuestTurn(REQ, h.deps);
      expect(r).toMatchObject({ kind: "fallback", fallback: LLM_FALLBACK[code], llmCode: code });
      expect(h.logs[0]).toMatchObject({ outcome: "fallback", llmCode: code, stage: "llm" });
    }
    expect(LLM_FALLBACK).toMatchObject({
      timeout: "deadline_exceeded",
      aborted: "aborted",
      rate_limited: "llm_unavailable",
      billing: "llm_unavailable",
      provider_unavailable: "llm_unavailable",
      truncated_response: "llm_output_invalid",
      content_filtered: "llm_output_invalid",
      sensitive_content_blocked: "sensitive_content_blocked",
      invalid_request: "llm_request_invalid",
      internal_error: "internal_error",
    });
  });

  it.each<[string, Partial<TurnRequest>]>([
    ["modo diferente de shadow", { mode: "live" as never }],
    ["superfície inválida", { surface: "email" as never }],
    ["conversa não-UUID", { conversationId: "abc" }],
    ["mensagem não-UUID", { messageId: "" }],
    ["dono malformado", { expectedOwnerId: "x" }],
    ["traceId inválido", { traceId: "tem espaço" }],
  ])("pedido inválido (%s) ⇒ scope_invalid, sem contexto nem Gateway", async (_n, over) => {
    const h = harness();
    let loaded = 0;
    h.deps.loadContext = async () => { loaded += 1; return ctx(); };
    expect(isFallback(await runGuestTurn({ ...REQ, ...over }, h.deps), "scope_invalid")).toBe(true);
    expect(loaded).toBe(0);
    expect(h.calls).toHaveLength(0);
  });
  it("pedido nulo não lança", async () => {
    expect(isFallback(await runGuestTurn(null as never, harness().deps), "scope_invalid")).toBe(true);
    expect(isValidTurnRequest(REQ)).toBe(true);
  });

  it("escopo recusado pelo F0 ⇒ scope_invalid; outra falha de contexto ⇒ context_unavailable", async () => {
    expect(isFallback(await runGuestTurn(REQ, harness({ loadContext: async () => { throw new GuestAiScopeError("tenant_mismatch"); } }).deps), "scope_invalid")).toBe(true);
    expect(isFallback(await runGuestTurn(REQ, harness({ loadContext: async () => { throw new Error("db"); } }).deps), "context_unavailable")).toBe(true);
    expect(isFallback(await runGuestTurn(REQ, harness({ loadContext: async () => null as never }).deps), "context_unavailable")).toBe(true);
  });

  it("DEFESA: contexto com credenciais ⇒ credentials_present, e o Gateway NUNCA é chamado", async () => {
    const h = harness({ loadContext: async () => ctx({ credentials: { lockCode: "4821" } }) });
    const r = await runGuestTurn(REQ, h.deps);
    expect(isFallback(r, "credentials_present")).toBe(true);
    expect(h.calls).toHaveLength(0);
    expect(JSON.stringify([r, h.logs])).not.toContain("4821");
  });

  it("sem compositor de prompt instalado (B2) ⇒ prompt_unavailable; compositor que lança ⇒ internal_error", async () => {
    const h = harness();
    delete h.deps.composePrompt;
    expect(isFallback(await runGuestTurn(REQ, h.deps), "prompt_unavailable")).toBe(true);
    expect(h.calls).toHaveLength(0);
    expect(isFallback(await runGuestTurn(REQ, harness({ composePrompt: () => { throw new Error("x"); } }).deps), "internal_error")).toBe(true);
    expect(isFallback(await runGuestTurn(REQ, harness({ composePrompt: () => ({ ...PROMPT, system: "" }) }).deps), "prompt_unavailable")).toBe(true);
    expect(isFallback(await runGuestTurn(REQ, harness({ composePrompt: () => ({ ...PROMPT, messages: [] }) }).deps), "prompt_unavailable")).toBe(true);
  });

  it("modelo fora do registro ⇒ llm_request_invalid sem chamar o Gateway", async () => {
    const h = harness({ model: "openai/gpt-qualquer" });
    expect(isFallback(await runGuestTurn(REQ, h.deps), "llm_request_invalid")).toBe(true);
    expect(h.calls).toHaveLength(0);
  });

  it("decisão inválida (JSON fora do schema ou ausente) ⇒ invalid_decision", async () => {
    expect(isFallback(await runGuestTurn(REQ, harness({ generate: async () => llmOk({ strategy: "answer" }) }).deps), "invalid_decision")).toBe(true);
    const noJson: LlmResult = { ok: true, text: "texto", finishReason: "stop", telemetry: llmTelemetry() };
    expect(isFallback(await runGuestTurn(REQ, harness({ generate: async () => noJson }).deps), "invalid_decision")).toBe(true);
  });

  it("bloqueio do Validator ⇒ validator_block com o relatório; o texto bloqueado não sai do Orchestrator", async () => {
    const h = harness({ generate: async () => llmOk(validDecision({ reply: "A senha do cadeado é 4821" })) });
    const r = await runGuestTurn(REQ, h.deps);
    expect(r).toMatchObject({ kind: "fallback", fallback: "validator_block", validation: { verdict: "block", blocks: ["possible_fabricated_credential"] } });
    expect(JSON.stringify(r)).not.toContain("4821");
    expect(h.logs[0]).toMatchObject({ validatorVerdict: "block", validatorBlocks: ["possible_fabricated_credential"], strategy: null });
  });

  it("D9 negada e o modelo tentando entregar credenciais ⇒ bloqueado", async () => {
    const h = harness({
      loadContext: async () => ctx({}, "deny"),
      generate: async () => llmOk(validDecision({ credentialIntent: "would_deliver", reply: `Senha: ${CREDENTIAL_MARKER}` })),
    });
    expect(await runGuestTurn(REQ, h.deps)).toMatchObject({ kind: "fallback", fallback: "validator_block", validation: { blocks: ["credential_intent_against_policy"] } });
  });

  it("fundamento citado inexistente ⇒ bloqueado", async () => {
    const h = harness({ generate: async () => llmOk(validDecision({ groundedOn: ["f:inventado"] })) });
    expect(await runGuestTurn(REQ, h.deps)).toMatchObject({ fallback: "validator_block", validation: { blocks: ["grounding_unknown_source"] } });
  });

  it("chamado aberto NÃO bloqueia a IA: assunto independente segue normalmente", async () => {
    const open = [{ id: REQ.conversationId, source: "conversation_status" as const, topic: null, status: "needs_human" }];
    const h = harness({ loadContext: async () => ctx({ openCases: open }), generate: async () => llmOk(validDecision({ caseRelation: "independent" })) });
    expect((await runGuestTurn(REQ, h.deps)).kind).toBe("draft");
    const h2 = harness({ loadContext: async () => ctx({ openCases: open }), generate: async () => llmOk(validDecision({ caseRelation: "related", commitments: ["resolvo agora"] })) });
    expect(await runGuestTurn(REQ, h2.deps)).toMatchObject({ fallback: "validator_block", validation: { blocks: ["human_owned_topic_commitment"] } });
  });

  it("Gateway que lança (violando o contrato) ⇒ internal_error, sem propagar", async () => {
    expect(isFallback(await runGuestTurn(REQ, harness({ generate: async () => { throw new Error("boom"); } }).deps), "internal_error")).toBe(true);
  });

  it("FAIL-CLOSED: exceção em QUALQUER etapa nunca propaga", async () => {
    const throwing: Array<Partial<OrchestratorDeps>> = [
      { loadContext: () => { throw new Error("sync"); } },
      { composePrompt: () => { throw new Error("sync"); } },
      { generate: () => { throw new Error("sync"); } },
      { now: () => { throw new Error("clock"); } },
      { schedule: () => { throw new Error("timer"); } },
      { log: () => { throw new Error("log"); } },
    ];
    // relógio quebrado: não só não lança, como cai explicitamente em internal_error
    expect(await runGuestTurn(REQ, { ...harness().deps, now: () => { throw new Error("clock"); } })).toMatchObject({ kind: "fallback", fallback: "internal_error" });
    expect(await runGuestTurn(REQ, { ...harness().deps, now: () => Number.NaN })).toMatchObject({ kind: "fallback", fallback: "internal_error" });
    let loadedWithBrokenClock = 0;
    await runGuestTurn(REQ, { ...harness().deps, now: () => Number.NaN, loadContext: async () => { loadedWithBrokenClock += 1; return ctx(); } });
    expect(loadedWithBrokenClock).toBe(0); // relógio quebrado: nem carrega contexto
    for (const over of throwing) {
      const r = await runGuestTurn(REQ, { ...harness().deps, ...over }).catch((e) => ({ thrown: e }));
      expect(r, JSON.stringify(Object.keys(over))).not.toHaveProperty("thrown");
    }
  });
});

// ───────────── prazo ─────────────

describe("B1 · Orchestrator — prazo total ≤ 15 s", () => {
  it("o prazo nunca passa de 15 s, mesmo se pedido maior; mínimo 1 s", async () => {
    const r1 = await runGuestTurn(REQ, harness({ deadlineMs: 60_000 }).deps);
    expect(r1.telemetry.deadlineMs).toBe(15_000);
    const r2 = await runGuestTurn(REQ, harness({ deadlineMs: 10 }).deps);
    expect(r2.telemetry.deadlineMs).toBe(1_000);
  });

  it("contexto que trava ⇒ deadline_exceeded exatamente no prazo, e o Gateway não é chamado", async () => {
    const h = harness();
    let signalSeen: AbortSignal | null = null;
    h.deps.loadContext = (_r, signal) => { signalSeen = signal; return new Promise(() => undefined); };
    const p = runGuestTurn(REQ, h.deps);
    await Promise.resolve();
    h.advance(14_999);
    await Promise.resolve();
    expect(signalSeen!.aborted).toBe(false);
    h.advance(1);
    const r = await p;
    expect(isFallback(r, "deadline_exceeded")).toBe(true);
    expect(r.telemetry.stage).toBe("context");
    expect(signalSeen!.aborted).toBe(true);
    expect(h.calls).toHaveLength(0);
  });

  it("contexto lento que deixa < 1 s para o modelo ⇒ deadline_exceeded sem chamar o Gateway", async () => {
    const h = harness();
    h.deps.loadContext = async () => { h.tick(15_000 - POST_LLM_RESERVE_MS - MIN_LLM_BUDGET_MS + 1); return ctx(); };
    expect(isFallback(await runGuestTurn(REQ, h.deps), "deadline_exceeded")).toBe(true);
    expect(h.calls).toHaveLength(0);
  });

  it("Gateway que trava além do prazo do turno ⇒ deadline_exceeded (corrida), sinal entregue ao Gateway é abortado", async () => {
    const h = harness();
    let sig: AbortSignal | undefined;
    h.deps.generate = (r) => { sig = r.signal; return new Promise(() => undefined); };
    const p = runGuestTurn(REQ, h.deps);
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    h.advance(15_000);
    const r = await p;
    expect(isFallback(r, "deadline_exceeded")).toBe(true);
    expect(r.telemetry.stage).toBe("llm");
    expect(sig?.aborted).toBe(true);
  });

  it("cancelamento externo ⇒ aborted; sinal já cancelado ⇒ nem carrega contexto", async () => {
    const ac = new AbortController();
    const h = harness();
    h.deps.loadContext = () => new Promise(() => undefined);
    const p = runGuestTurn(REQ, { ...h.deps, signal: ac.signal });
    await Promise.resolve();
    ac.abort();
    expect(isFallback(await p, "aborted")).toBe(true);

    const pre = new AbortController();
    pre.abort();
    let loaded = 0;
    const h2 = harness({ loadContext: async () => { loaded += 1; return ctx(); } });
    expect(isFallback(await runGuestTurn(REQ, { ...h2.deps, signal: pre.signal }), "aborted")).toBe(true);
    expect(loaded).toBe(0);
  });

  it("prazo estoura enquanto o modelo responde (temporizador dispara) ⇒ deadline_exceeded, não rascunho", async () => {
    const h = harness();
    h.deps.generate = async () => { h.advance(15_000); return llmOk(); };
    expect(isFallback(await runGuestTurn(REQ, h.deps), "deadline_exceeded")).toBe(true);
  });
  it("prazo ultrapassado pelo RELÓGIO sem o temporizador ter disparado ⇒ deadline_exceeded após validar", async () => {
    const h = harness();
    h.deps.generate = async () => { h.tick(15_001); return llmOk(); };
    const r = await runGuestTurn(REQ, h.deps);
    expect(r).toMatchObject({ kind: "fallback", fallback: "deadline_exceeded", validation: { verdict: "pass" } });
    expect(r.telemetry.stage).toBe("validation");
  });
});
