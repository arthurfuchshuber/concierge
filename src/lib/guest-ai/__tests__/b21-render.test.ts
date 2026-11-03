import { describe, expect, it } from "vitest";
import { renderTurn } from "@/lib/guest-ai/render";
import { CREDENTIAL_MARKER, type ModelDecision, type OrchestratorResult } from "@/lib/guest-ai/orchestrator/contracts";
import { parseModelDecision } from "@/lib/guest-ai/orchestrator/decision";
import { GUEST_AI_DEFAULT_MODEL } from "@/lib/guest-ai/orchestrator/contracts";
import { validDecision } from "./helpers/decision-fixtures";
import { v2 } from "./helpers/b21-fixtures";

const telemetry = { traceId: "t", mode: "shadow" as const, model: GUEST_AI_DEFAULT_MODEL, reasoningEffort: "low" as const, latencyMs: 1, deadlineMs: 15000, stage: "done" as const, llm: null, promptVersion: "x" };
const draft = (raw: unknown, validation: { verdict: "pass" | "block"; blocks: never[] } = { verdict: "pass", blocks: [] }): OrchestratorResult => ({
  kind: "draft",
  decision: parseModelDecision(raw) as ModelDecision,
  validation,
  telemetry,
});

function deepValues(o: unknown, key: string, out: unknown[] = []): unknown[] {
  if (Array.isArray(o)) o.forEach((x) => deepValues(x, key, out));
  else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { if (k === key) out.push(v); deepValues(v, key, out); }
  return out;
}

describe("B2.1 · render — fallback e silêncio", () => {
  it("fallback passa adiante com o código do Gateway e sem envio", () => {
    expect(renderTurn({ kind: "fallback", fallback: "llm_unavailable", llmCode: "rate_limited", validation: null, telemetry })).toEqual({
      kind: "fallback", fallback: "llm_unavailable", llmCode: "rate_limited", delivery: "not_sent", effectsExecuted: false,
    });
  });
  it("silêncio aprovado vira `silence`, sem texto e sem fallback", () => {
    const out = renderTurn(draft(v2({ shouldReply: false, strategy: "silence", reply: "", intents: ["acknowledgment"], speakerName: "Ana" })));
    expect(out).toEqual({ kind: "silence", intentCategories: ["acknowledgment"], observations: { missingInformation: [], groundedOn: ["f:horario_checkin"] }, speaker: { declaredName: "Ana", verified: false }, delivery: "not_sent", effectsExecuted: false });
  });
  it("silêncio BLOQUEADO não vira silêncio: fica draft bloqueado, sem texto", () => {
    const out = renderTurn(draft(v2({ shouldReply: false, strategy: "silence", reply: "", intents: ["problem_report"] }), { verdict: "block", blocks: ["silence_not_allowed"] as never[] }));
    expect(out.kind).toBe("draft");
    if (out.kind === "draft") expect(out.conversational).toBeNull();
  });
});

describe("B2.1 · render — rascunho bloqueado nunca expõe texto", () => {
  it("draft bloqueado com resposta preenchida ⇒ conversational null (o texto não sai)", () => {
    const out = renderTurn(draft(v2({ reply: "Pode entrar às 11h, está liberado!", commitments: ["entrada às 11h"] }), { verdict: "block", blocks: ["formal_change_commitment"] as never[] }));
    expect(out.kind).toBe("draft");
    if (out.kind !== "draft") return;
    expect(out.verdict).toBe("block");
    expect(out.conversational).toBeNull();
    expect(out.blocks).toEqual(["formal_change_commitment"]);
  });
});

describe("B2.1 · render — separação dos elementos da decisão", () => {
  const out = renderTurn(
    draft(
      v2({
        strategy: "answer_and_handoff",
        reply: `Vou passar para a equipe 🙂 ${CREDENTIAL_MARKER}`,
        credentialIntent: "would_deliver",
        handoff: { needed: true, question: "Hóspede pede +1 noite", urgency: "normal" },
        intents: ["formal_change_request", "arrival_confirmation"],
        formalChangeRequests: ["dates"],
        hospitalityMilestone: { kind: "checkin_confirmed", evidence: ["hist:guest:h3"] },
        missingInformation: ["preço da noite extra"],
        capabilityNeeds: [{ capability: "property_availability", reason: "ver disponibilidade" }],
        speakerName: "Marina",
      }),
    ),
  );
  it("cada elemento no seu lugar, tipado", () => {
    expect(out.kind).toBe("draft");
    if (out.kind !== "draft") return;
    expect(out.decisionVersion).toBe(2);
    expect(out.conversational).toEqual({ text: `Vou passar para a equipe 🙂 ${CREDENTIAL_MARKER}`, containsCredentialMarker: true });
    expect(out.intentCategories).toEqual(["formal_change_request", "arrival_confirmation"]);
    expect(out.formalChangeRequests).toEqual([{ kind: "dates", status: "requested", authorization: "not_granted" }]);
    expect(out.humanIntervention).toEqual({ needed: true, question: "Hóspede pede +1 noite", urgency: "normal", withReply: true });
    expect(out.clarification).toEqual({ requested: false });
    expect(out.observations.missingInformation).toEqual(["preço da noite extra"]);
    expect(out.systemRequests.credential).toEqual({ declared: "would_deliver", executable: false });
    expect(out.systemRequests.capabilities).toEqual([{ capability: "property_availability", reason: "ver disponibilidade", executable: false }]);
    expect(out.speaker).toEqual({ declaredName: "Marina", verified: false });
    expect(out.reservationHolder).toEqual({ status: "not_in_context" });
    expect(out.hospitalityMilestone).toEqual({ kind: "checkin_confirmed", evidence: ["hist:guest:h3"], operationalEffect: "none" });
  });
  it("o marcador de credenciais NUNCA é substituído", () => {
    expect(JSON.stringify(out)).toContain(CREDENTIAL_MARKER);
  });
  it("NADA concede autorização nem é executável", () => {
    expect(new Set(deepValues(out, "authorization"))).toEqual(new Set(["not_granted"]));
    expect(new Set(deepValues(out, "executable"))).toEqual(new Set([false]));
    expect(deepValues(out, "verified")).toEqual([false]);
    expect(out.delivery).toBe("not_sent");
    expect(out.effectsExecuted).toBe(false);
  });
  it("compromissos declarados saem not_granted; ausência de compromissos não cria autorização", () => {
    const withC = renderTurn(draft(v2({ commitments: ["vou verificar"] })));
    expect(withC.kind === "draft" && withC.commitments).toEqual([{ text: "vou verificar", authorization: "not_granted", executable: false }]);
    const none = renderTurn(draft(v2()));
    expect(none.kind === "draft" && none.commitments).toEqual([]);
    expect(JSON.stringify(none)).not.toMatch(/"authorization":"granted"|"authorized":true|"approved"/);
  });
  it("esclarecimento é distinguido", () => {
    const c = renderTurn(draft(v2({ strategy: "clarify", reply: "É sobre o chuveiro ou o estacionamento?" })));
    expect(c.kind === "draft" && c.clarification.requested).toBe(true);
  });
  it("decisão v1 (B1) continua renderizável com sinais conservadores", () => {
    const r = renderTurn(draft(validDecision()));
    expect(r.kind === "draft" && r.decisionVersion).toBe(1);
    expect(r.kind === "draft" && r.intentCategories).toEqual(["other"]);
  });
  it("sem censura de estilo: emoji, humor e desculpa contextual passam intactos", () => {
    const reply = "Desculpe a demora! Haha, o Wi-Fi é 'FlatSantaCasa' 😄";
    const r = renderTurn(draft(v2({ reply })));
    expect(r.kind === "draft" && r.conversational?.text).toBe(reply);
  });
});

describe("B2.1 · render — fail-closed", () => {
  it("decisão que não sobrevive ao parser estrito ⇒ invalid_decision", () => {
    const tampered = { ...(parseModelDecision(v2()) as ModelDecision), extra: 1 } as unknown as ModelDecision;
    expect(renderTurn({ kind: "draft", decision: tampered, validation: { verdict: "pass", blocks: [] }, telemetry })).toMatchObject({ kind: "fallback", fallback: "invalid_decision" });
    const unnormalized = { ...(parseModelDecision(v2()) as ModelDecision), reply: "  com espaços  " };
    expect(renderTurn({ kind: "draft", decision: unnormalized, validation: { verdict: "pass", blocks: [] }, telemetry })).toMatchObject({ kind: "fallback", fallback: "invalid_decision" });
  });
  it("veredito incoerente ⇒ internal_error", () => {
    const d = parseModelDecision(v2()) as ModelDecision;
    expect(renderTurn({ kind: "draft", decision: d, validation: { verdict: "pass", blocks: ["reply_missing"] }, telemetry })).toMatchObject({ kind: "fallback", fallback: "internal_error" });
    expect(renderTurn({ kind: "draft", decision: d, validation: { verdict: "block", blocks: [] }, telemetry })).toMatchObject({ kind: "fallback", fallback: "internal_error" });
    expect(renderTurn({ kind: "draft", decision: d, validation: null as never, telemetry })).toMatchObject({ kind: "fallback", fallback: "internal_error" });
    expect(renderTurn({ kind: "draft", decision: d, validation: { verdict: "maybe" as never, blocks: [] }, telemetry })).toMatchObject({ kind: "fallback", fallback: "internal_error" });
  });
  it("entrada inválida ⇒ internal_error", () => {
    expect(renderTurn(null as never)).toMatchObject({ kind: "fallback", fallback: "internal_error" });
    expect(renderTurn({ kind: "other" } as never)).toMatchObject({ kind: "fallback", fallback: "internal_error" });
  });
});
