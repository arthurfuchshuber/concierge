/**
 * Cenários 13–40 da diretriz B2.1 ponta a ponta, SEM modelo real:
 * contexto + histórico → composer (guard de teste) → Orchestrator (Gateway simulado devolvendo a
 * decisão) → parser estrito → validador → render. Verifica o tratamento ESTRUTURAL de cada cenário.
 * A classificação semântica feita pelo modelo real fica para avaliação futura autorizada (ver
 * `semanticOnly` nos cenários).
 */
import { describe, expect, it } from "vitest";
import { composeTurnPrompt, toComposedPrompt } from "@/lib/guest-ai/composer";
import { normalizeHistory } from "@/lib/guest-ai/history";
import { runGuestTurn } from "@/lib/guest-ai/orchestrator/orchestrator.server";
import type { ConversationContext, OrchestratorResult, TurnRequest } from "@/lib/guest-ai/orchestrator/contracts";
import { GUEST_AI_DEFAULT_MODEL } from "@/lib/guest-ai/orchestrator/contracts";
import type { LlmRequest, LlmResult } from "@/lib/guest-ai/llm/contracts";
import { renderTurn } from "@/lib/guest-ai/render";
import { CONV, MSG, TEST_GUARD, conversationContext, row, v2 } from "./helpers/b21-fixtures";
import { SCENARIOS, type Scenario } from "./helpers/b21-scenarios";

const REQ: TurnRequest = { surface: "guide_chat", conversationId: CONV, messageId: MSG, expectedOwnerId: null, mode: "shadow", traceId: "b21-scenario" };
const T = (i: number) => new Date(Date.UTC(2026, 10, 3, 12, 0, i)).toISOString();
/** Texto neutro de teste no lugar do que o modelo escreveria. NÃO é resposta padrão. */
const FREE_TEXT = "[texto livre do modelo]";

function llmOk(json: unknown): LlmResult {
  return {
    ok: true,
    text: JSON.stringify(json),
    json,
    finishReason: "stop",
    telemetry: { provider: "fake", model: GUEST_AI_DEFAULT_MODEL, purpose: "guest_reply", latencyMs: 10, attempts: 1, usage: { inputTokens: 1, outputTokens: 1, reasoningTokens: 0, totalTokens: 2, source: "provider" }, costUsd: 0, providerRequestId: null, traceId: REQ.traceId },
  };
}

function setup(s: Scenario) {
  const prior = (s.prior ?? []).map((p, i) => row({ created_at: T(i), ...p }));
  const history = normalizeHistory([...prior, row({ id: MSG, created_at: T(50), content: s.message })], { conversationId: CONV, currentMessageId: MSG });
  const ctx: ConversationContext = conversationContext(s.context ?? {});
  if (s.credentialPolicy) ctx.credentialPolicy = s.credentialPolicy;
  const currentRef = history.status === "available" ? history.entries.at(-1)!.ref : "";
  return { history, ctx, currentRef };
}

function compliantDecision(s: Scenario, currentRef: string): Record<string, unknown> {
  const e = s.expected;
  const silent = !e.shouldReply;
  return v2({
    strategy: silent ? "silence" : (e.strategy ?? "answer"),
    reply: silent ? "" : FREE_TEXT,
    handoff: e.handoff ? { needed: true, question: "[pergunta objetiva à equipe]", urgency: "normal" } : { needed: false, question: null, urgency: null },
    groundedOn: e.groundedOn ?? [],
    shouldReply: e.shouldReply,
    intents: e.intents,
    formalChangeRequests: e.formalChanges,
    hospitalityMilestone: e.milestone ? { kind: e.milestone, evidence: [currentRef] } : null,
    speakerName: e.speakerName ?? null,
  });
}

async function runScenario(s: Scenario, decision: unknown): Promise<{ result: OrchestratorResult; calls: LlmRequest[] }> {
  const { history, ctx } = setup(s);
  const calls: LlmRequest[] = [];
  const result = await runGuestTurn(REQ, {
    loadContext: async () => ctx,
    composePrompt: (c) => toComposedPrompt(composeTurnPrompt({ context: c, history }, { guard: TEST_GUARD })),
    generate: async (r) => {
      calls.push(r);
      return llmOk(decision);
    },
    log: () => {},
  });
  return { result, calls };
}

describe("B2.1 · cenários da diretriz (13–40) — tratamento estrutural ponta a ponta", () => {
  it("o conjunto cobre os itens 13–40 (exceto 18, provado à parte) e não guarda texto de resposta", () => {
    const ids = SCENARIOS.map((s) => s.id).sort((a, b) => a - b);
    expect(ids).toEqual([13, 14, 15, 16, 17, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40]);
    for (const s of SCENARIOS) {
      expect(Object.keys(s.expected)).not.toContain("reply");
      expect(s.violations.length, `#${s.id}`).toBeGreaterThan(0);
    }
  });

  for (const s of SCENARIOS) {
    describe(`#${s.id} · ${s.title}`, () => {
      it("a mensagem chega ao modelo como DADO (mensagem atual, bloco único) e a decisão coerente é aceita sem envio", async () => {
        const { currentRef } = setup(s);
        const { result, calls } = await runScenario(s, compliantDecision(s, currentRef));
        // composição: 2 mensagens ao Gateway; a mensagem do hóspede só no bloco de histórico, marcada atual
        expect(calls).toHaveLength(1);
        expect(calls[0]!.messages).toHaveLength(2);
        expect(calls[0]!.messages[0]!.content).not.toContain(s.message);
        const user = calls[0]!.messages[1]!.content;
        expect(user).toContain(JSON.stringify(s.message).slice(1, -1).replace(/[<>&]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`));
        expect(user).toContain(`"atual":true`);

        expect(result.kind).toBe("draft");
        if (result.kind !== "draft") return;
        expect(result.validation.verdict, JSON.stringify(result.validation.blocks)).toBe("pass");

        const out = renderTurn(result);
        expect(out.delivery).toBe("not_sent");
        expect(out.effectsExecuted).toBe(false);
        if (!s.expected.shouldReply) {
          expect(out.kind).toBe("silence");
          if (out.kind === "silence") expect(out.intentCategories).toEqual(s.expected.intents);
          return;
        }
        expect(out.kind).toBe("draft");
        if (out.kind !== "draft") return;
        expect(out.conversational?.text).toBe(FREE_TEXT);
        expect(out.intentCategories).toEqual(s.expected.intents);
        expect(out.hospitalityMilestone?.kind ?? null).toBe(s.expected.milestone);
        if (out.hospitalityMilestone) expect(out.hospitalityMilestone.operationalEffect).toBe("none");
        expect(out.formalChangeRequests.map((f) => f.kind)).toEqual(s.expected.formalChanges);
        for (const f of out.formalChangeRequests) expect(f.authorization).toBe("not_granted");
        expect(out.speaker.verified).toBe(false);
        expect(out.speaker.declaredName).toBe(s.expected.speakerName ?? null);
        expect(out.reservationHolder).toEqual({ status: "not_in_context" });
        expect(out.commitments).toEqual([]);
      });

      for (const v of s.violations) {
        it(`violação bloqueada: ${v.name} ⇒ ${v.expect}`, async () => {
          const { currentRef } = setup(s);
          const { result } = await runScenario(s, { ...compliantDecision(s, currentRef), ...v.patch });
          const out = renderTurn(result);
          expect(out.delivery).toBe("not_sent");
          if (v.expect === "invalid_decision") {
            expect(result).toMatchObject({ kind: "fallback", fallback: "invalid_decision" });
            expect(out.kind).toBe("fallback");
            return;
          }
          // B1: bloqueio do Validator ⇒ fallback humano `validator_block`, com o relatório anexado.
          expect(result).toMatchObject({ kind: "fallback", fallback: "validator_block" });
          if (result.kind !== "fallback") return;
          expect(result.validation?.verdict).toBe("block");
          expect(result.validation?.blocks).toContain(v.expect);
          expect(out).toMatchObject({ kind: "fallback", fallback: "validator_block" });
          expect(JSON.stringify(out)).not.toContain(FREE_TEXT);
        });
      }
    });
  }
});

describe("B2.1 · cenário 18 — shouldReply:false não envia resposta nem fallback", () => {
  it("silêncio aprovado é resultado do turno (não erro): sem texto, sem cortesia, sem fallback", async () => {
    const s = SCENARIOS.find((x) => x.id === 13)!;
    const { currentRef } = setup(s);
    const { result } = await runScenario(s, compliantDecision(s, currentRef));
    expect(result.kind).toBe("draft"); // não é fallback
    const out = renderTurn(result);
    expect(out).toEqual({
      kind: "silence",
      intentCategories: ["acknowledgment"],
      observations: { missingInformation: [], groundedOn: [] },
      speaker: { declaredName: null, verified: false },
      delivery: "not_sent",
      effectsExecuted: false,
    });
    expect(JSON.stringify(out)).not.toMatch(/reply|text|fallback/);
  });
});
