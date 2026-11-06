import { describe, expect, it } from "vitest";
import { DECISION_FORMAT_SPEC, parseModelDecision } from "@/lib/guest-ai/orchestrator/decision";
import {
  FORMAL_CHANGE_KINDS,
  HOSPITALITY_MILESTONES,
  INTENT_CATEGORIES,
  decisionSignals,
  type ModelDecision,
} from "@/lib/guest-ai/orchestrator/contracts";
import { resolveCaseOwnership } from "@/lib/guest-ai/orchestrator/case-ownership";
import { currentGuestRef, validateDecision, type ValidationInput } from "@/lib/guest-ai/validation/output-validator";
import { validDecision } from "./helpers/decision-fixtures";
import { v2 } from "./helpers/b21-fixtures";

const SOURCES = new Set(["ctx:fase", "hist:guest:h1", "hist:team:h2", "hist:guest:h3", "f:horario_checkin"]);
const parsed = (raw: unknown) => {
  const d = parseModelDecision(raw);
  if (!d) throw new Error("decisão inválida no fixture");
  return d;
};
const run = (d: ModelDecision, over: Partial<ValidationInput> = {}) =>
  validateDecision({ decision: d, credentialPolicy: "deny", ownership: resolveCaseOwnership([], d.caseRelation), sourceIds: SOURCES, ...over });
const blocks = (raw: unknown, over: Partial<ValidationInput> = {}) => run(parsed(raw), over).blocks;

describe("B2.1 · decisão v2 — parse estrito e versionado", () => {
  it("v1 (B1) continua válida e ganha sinais conservadores (responder, sem ritual, sem alteração)", () => {
    const d = parsed(validDecision());
    expect(d.shouldReply).toBeUndefined();
    expect(decisionSignals(d)).toEqual({ version: 1, shouldReply: true, intents: ["other"], formalChangeRequests: [], hospitalityMilestone: null, speakerName: null });
  });
  it("v2 completa é aceita e normalizada", () => {
    const d = parsed(v2({ speakerName: "  Marina ", hospitalityMilestone: { kind: "checkin_confirmed", evidence: ["hist:guest:h3", "hist:guest:h3"] }, intents: ["arrival_confirmation"] }));
    expect(d.speakerName).toBe("Marina");
    expect(d.hospitalityMilestone).toEqual({ kind: "checkin_confirmed", evidence: ["hist:guest:h3"] });
    expect(decisionSignals(d).version).toBe(2);
  });
  it("mistura parcial v1/v2 é inválida (todos os campos novos ou nenhum)", () => {
    for (const k of ["shouldReply", "intents", "formalChangeRequests", "hospitalityMilestone", "speakerName"]) {
      const raw = v2() as Record<string, unknown>;
      delete raw[k];
      expect(parseModelDecision(raw), `sem ${k}`).toBeNull();
    }
    expect(parseModelDecision(validDecision({ shouldReply: false }))).toBeNull();
    expect(parseModelDecision(v2({ extra: 1 }))).toBeNull();
  });
  it.each([
    ["shouldReply não-booleano", v2({ shouldReply: "false" })],
    ["intents vazio", v2({ intents: [] })],
    ["intent desconhecida", v2({ intents: ["chitchat"] })],
    ["intent repetida", v2({ intents: ["acknowledgment", "acknowledgment"] })],
    ["intents demais", v2({ intents: [...INTENT_CATEGORIES].slice(0, 6) })],
    ["alteração desconhecida", v2({ formalChangeRequests: ["refund"] })],
    ["alteração repetida", v2({ formalChangeRequests: ["dates", "dates"] })],
    ["marco desconhecido", v2({ hospitalityMilestone: { kind: "welcome", evidence: ["hist:guest:h3"] } })],
    ["marco sem evidência", v2({ hospitalityMilestone: { kind: "checkin_confirmed", evidence: [] } })],
    ["marco com chave extra", v2({ hospitalityMilestone: { kind: "checkin_confirmed", evidence: ["hist:guest:h3"], at: "x" } })],
    ["evidência fora do padrão de id", v2({ hospitalityMilestone: { kind: "checkin_confirmed", evidence: ["mensagem 3"] } })],
    ["nome vazio", v2({ speakerName: "  " })],
    ["nome longo demais", v2({ speakerName: "x".repeat(81) })],
    ["nome não-texto", v2({ speakerName: 7 })],
  ])("%s ⇒ inválida", (_n, raw) => {
    expect(parseModelDecision(raw)).toBeNull();
  });
  it("enums completos aceitos", () => {
    for (const k of FORMAL_CHANGE_KINDS) expect(parseModelDecision(v2({ intents: ["formal_change_request"], formalChangeRequests: [k] }))).not.toBeNull();
    for (const m of HOSPITALITY_MILESTONES) expect(parseModelDecision(v2({ hospitalityMilestone: { kind: m, evidence: ["hist:guest:h3"] } }))).not.toBeNull();
  });
  it("o formato do prompt cita as chaves e enums novos (fonte única com o parser)", () => {
    for (const k of ["shouldReply", "intents", "formalChangeRequests", "hospitalityMilestone", "speakerName", "silence"]) expect(DECISION_FORMAT_SPEC).toContain(`"${k}"`);
    for (const i of INTENT_CATEGORIES) expect(DECISION_FORMAT_SPEC).toContain(`"${i}"`);
    for (const c of FORMAL_CHANGE_KINDS) expect(DECISION_FORMAT_SPEC).toContain(`"${c}"`);
    for (const m of HOSPITALITY_MILESTONES) expect(DECISION_FORMAT_SPEC).toContain(`"${m}"`);
  });
});

describe("B2.1 · validador — silêncio (§6)", () => {
  const silent = (over: Record<string, unknown> = {}) => v2({ shouldReply: false, strategy: "silence", reply: "", intents: ["acknowledgment"], groundedOn: [], ...over });
  it("silêncio legítimo passa", () => {
    expect(blocks(silent())).toEqual([]);
    expect(blocks(silent({ intents: ["arrival_confirmation"] }))).toEqual([]);
    expect(blocks(silent({ intents: ["acknowledgment", "departure_confirmation"] }))).toEqual([]);
  });
  it("silêncio com texto ⇒ silence_with_reply (nada de cortesia escondida)", () => {
    expect(blocks(silent({ reply: "Por nada!" }))).toContain("silence_with_reply");
  });
  it("estratégia e shouldReply precisam concordar", () => {
    expect(blocks(silent({ strategy: "answer" }))).toContain("silence_strategy_mismatch");
    expect(blocks(v2({ strategy: "silence" }))).toContain("silence_strategy_mismatch");
    // v1 com `silence` (v1 sempre significa responder) também é bloqueada
    expect(blocks(validDecision({ strategy: "silence", reply: "" }))).toContain("silence_strategy_mismatch");
  });
  it.each([
    ["pergunta junto com cortesia", { intents: ["acknowledgment", "informational_query"] }],
    ["problema", { intents: ["problem_report"] }],
    ["emergência", { intents: ["emergency"] }],
    ["pedido operacional", { intents: ["operational_request"] }],
    ["alteração formal", { intents: ["formal_change_request"], formalChangeRequests: ["dates"] }],
    ["outro (incerteza)", { intents: ["other"] }],
    ["encaminhamento", { handoff: { needed: true, question: "?", urgency: "normal" } }],
    ["compromisso", { commitments: ["x"] }],
    ["intenção de credencial", { credentialIntent: "would_deliver" }],
    ["marco de hospitalidade", { intents: ["arrival_confirmation"], hospitalityMilestone: { kind: "checkin_confirmed", evidence: ["hist:guest:h3"] } }],
  ])("silêncio com %s ⇒ silence_not_allowed", (_n, over) => {
    expect(blocks(silent(over))).toContain("silence_not_allowed");
  });
  it("resposta normal não precisa de texto só quando é encaminhamento puro ou silêncio", () => {
    expect(blocks(v2({ reply: "" }))).toContain("reply_missing");
    expect(blocks(silent())).not.toContain("reply_missing");
  });
});

describe("B2.1 · validador — alterações formais (§7.3)", () => {
  it("coerência intenção ⇔ lista", () => {
    expect(blocks(v2({ intents: ["formal_change_request"], formalChangeRequests: ["dates"], strategy: "answer_and_handoff", handoff: { needed: true, question: "Hóspede pede +1 noite", urgency: "normal" } }))).toEqual([]);
    expect(blocks(v2({ intents: ["formal_change_request"], formalChangeRequests: [] }))).toContain("formal_change_inconsistent");
    expect(blocks(v2({ intents: ["informational_query"], formalChangeRequests: ["price"] }))).toContain("formal_change_inconsistent");
  });
  it.each(FORMAL_CHANGE_KINDS.map((k) => [k]))("%s com compromisso ⇒ formal_change_commitment (nunca aprova na conversa)", (k) => {
    expect(blocks(v2({ intents: ["formal_change_request"], formalChangeRequests: [k], commitments: ["Está aprovado"] }))).toContain("formal_change_commitment");
  });
});

describe("B2.1 · validador — marcos de hospitalidade (§9)", () => {
  const milestone = (kind: string, evidence: string[], intents: string[]) => v2({ intents, hospitalityMilestone: { kind, evidence } });
  it("marco provado pela mensagem ATUAL do hóspede passa (pode citar mensagens anteriores do hóspede também)", () => {
    expect(blocks(milestone("checkin_confirmed", ["hist:guest:h3"], ["arrival_confirmation"]))).toEqual([]);
    expect(blocks(milestone("checkout_confirmed", ["hist:guest:h1", "hist:guest:h3"], ["departure_confirmation", "problem_report"]))).toEqual([]);
  });
  it("marco sem a intenção correspondente ⇒ milestone_inconsistent", () => {
    expect(blocks(milestone("checkin_confirmed", ["hist:guest:h3"], ["informational_query"]))).toContain("milestone_inconsistent");
    expect(blocks(milestone("checkout_confirmed", ["hist:guest:h3"], ["arrival_confirmation"]))).toContain("milestone_inconsistent");
  });
  it.each([
    ["só mensagem ANTIGA do hóspede (ritual repetido)", ["hist:guest:h1"]],
    ["mensagem da equipe", ["hist:team:h2"]],
    ["id inexistente no contexto", ["hist:guest:h9"]],
    ["fato do contexto (horário chegou, credencial liberada)", ["ctx:fase"]],
    ["atual + equipe", ["hist:guest:h3", "hist:team:h2"]],
  ])("evidência = %s ⇒ milestone_without_current_guest_evidence", (_n, evidence) => {
    expect(blocks(milestone("checkin_confirmed", evidence, ["arrival_confirmation"]))).toContain("milestone_without_current_guest_evidence");
  });
  it("sem ids de contexto (composição sem histórico) o marco não pode ser comprovado", () => {
    expect(blocks(milestone("checkin_confirmed", ["hist:guest:h3"], ["arrival_confirmation"]), { sourceIds: null })).toContain("milestone_without_current_guest_evidence");
  });
  it("currentGuestRef = maior posição entre as mensagens do hóspede (comparação numérica)", () => {
    expect(currentGuestRef(new Set(["hist:guest:h9", "hist:guest:h10", "hist:team:h11"]))).toBe("hist:guest:h10");
    expect(currentGuestRef(new Set(["hist:team:h1"]))).toBeNull();
    expect(currentGuestRef(null)).toBeNull();
  });
});

describe("B2.1 · validador — sem censura de estilo também na v2", () => {
  it("desculpa contextual, emoji, humor e informalidade passam", () => {
    for (const reply of ["Desculpe a confusão de ontem, já está tudo certo 🙂", "Haha, boa pergunta! Fica a 2 quadras.", "Valeu! Qualquer coisa chama aqui 😉"]) {
      expect(blocks(v2({ reply }))).toEqual([]);
    }
  });
});
