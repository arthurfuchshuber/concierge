import { describe, expect, it } from "vitest";
import { DECISION_FORMAT_SPEC, DECISION_LIMITS, parseModelDecision } from "@/lib/guest-ai/orchestrator/decision";
import { CAPABILITIES, CAPABILITY_IDS, enabledCapabilities, isCapabilityId } from "@/lib/guest-ai/orchestrator/capabilities";
import { CASE_RELATIONS, STRATEGIES } from "@/lib/guest-ai/orchestrator/contracts";
import { validDecision } from "./helpers/decision-fixtures";


describe("B1 · decisão do modelo: parse estrito", () => {
  it("decisão válida é aceita e normalizada (trim, ids únicos)", () => {
    const d = parseModelDecision(validDecision({ reply: "  Olá!  ", groundedOn: ["f:a", "f:a", "faq:1"] }));
    expect(d).toMatchObject({ reply: "Olá!", groundedOn: ["f:a", "faq:1"] });
  });
  it("todas as estratégias e relações do contrato são aceitas", () => {
    for (const strategy of STRATEGIES) expect(parseModelDecision(validDecision({ strategy }))).not.toBeNull();
    for (const caseRelation of CASE_RELATIONS) expect(parseModelDecision(validDecision({ caseRelation }))).not.toBeNull();
  });
  it("encaminhamento com pergunta e urgência", () => {
    const d = parseModelDecision(validDecision({ strategy: "answer_and_handoff", handoff: { needed: true, question: " Pode liberar às 13h? ", urgency: "high" } }));
    expect(d?.handoff).toEqual({ needed: true, question: "Pode liberar às 13h?", urgency: "high" });
    expect(parseModelDecision(validDecision({ handoff: { needed: false, question: "   ", urgency: null } }))?.handoff.question).toBeNull();
  });
  it("capacidade futura declarada é aceita só com id conhecido", () => {
    expect(parseModelDecision(validDecision({ capabilityNeeds: [{ capability: "local_places", reason: "restaurante perto" }] }))?.capabilityNeeds).toEqual([
      { capability: "local_places", reason: "restaurante perto" },
    ]);
    expect(parseModelDecision(validDecision({ capabilityNeeds: [{ capability: "send_whatsapp", reason: "x" }] }))).toBeNull();
    expect(parseModelDecision(validDecision({ capabilityNeeds: [{ capability: "distance", reason: "" }] }))).toBeNull();
    expect(parseModelDecision(validDecision({ capabilityNeeds: [{ capability: "distance", reason: "x", extra: 1 }] }))).toBeNull();
  });

  it.each<[string, unknown]>([
    ["não-objeto", "texto"],
    ["array", []],
    ["nulo", null],
    ["chave a mais", validDecision({ tool: "x" })],
    ["chave a menos", (() => { const o = validDecision() as Record<string, unknown>; delete o["commitments"]; return o; })()],
    ["estratégia desconhecida", validDecision({ strategy: "refund" })],
    ["reply não-texto", validDecision({ reply: 42 })],
    ["reply acima do limite", validDecision({ reply: "x".repeat(DECISION_LIMITS.replyMaxChars + 1) })],
    ["handoff sem chave", validDecision({ handoff: { needed: true, question: "x" } })],
    ["handoff.needed não-booleano", validDecision({ handoff: { needed: "yes", question: null, urgency: null } })],
    ["urgência desconhecida", validDecision({ handoff: { needed: true, question: "x", urgency: "critical" } })],
    ["pergunta longa demais", validDecision({ handoff: { needed: true, question: "x".repeat(501), urgency: null } })],
    ["relação desconhecida", validDecision({ caseRelation: "maybe" })],
    ["intenção de credencial desconhecida", validDecision({ credentialIntent: "deliver_now" })],
    ["id de fonte malformado", validDecision({ groundedOn: ["isso não é id"] })],
    ["lista com item vazio", validDecision({ missingInformation: [""] })],
    ["lista com não-texto", validDecision({ commitments: [1] })],
    ["lista longa demais", validDecision({ missingInformation: Array.from({ length: 21 }, (_, i) => `x${i}`) })],
    ["capabilityNeeds não-lista", validDecision({ capabilityNeeds: {} })],
  ])("%s ⇒ inválida (null)", (_n, raw) => {
    expect(parseModelDecision(raw)).toBeNull();
  });

  it("o texto de formato do prompt cita exatamente as chaves e enums do parser", () => {
    for (const k of ["strategy", "reply", "handoff", "caseRelation", "groundedOn", "missingInformation", "capabilityNeeds", "credentialIntent", "commitments"]) expect(DECISION_FORMAT_SPEC).toContain(`"${k}"`);
    for (const s of STRATEGIES) expect(DECISION_FORMAT_SPEC).toContain(`"${s}"`);
    for (const r of CASE_RELATIONS) expect(DECISION_FORMAT_SPEC).toContain(`"${r}"`);
  });
});

describe("B1 · capacidades futuras (F2-C) declaradas e desabilitadas", () => {
  it("todas existem, com escopo declarado, e NENHUMA está habilitada", () => {
    expect(CAPABILITY_IDS.length).toBe(6);
    for (const id of CAPABILITY_IDS) {
      expect(CAPABILITIES[id].id).toBe(id);
      expect(CAPABILITIES[id].enabled).toBe(false);
    }
    expect(enabledCapabilities()).toEqual([]);
    expect(Object.isFrozen(CAPABILITIES)).toBe(true);
  });
  it("distância e rota exigem fonte confiável (nunca inventar)", () => {
    expect(CAPABILITIES.distance.requiresTrustedSource).toBe(true);
    expect(CAPABILITIES.route_estimate.requiresTrustedSource).toBe(true);
    expect(isCapabilityId("route_estimate")).toBe(true);
    expect(isCapabilityId("execute_sql")).toBe(false);
  });
});
