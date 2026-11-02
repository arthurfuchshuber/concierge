import { describe, expect, it } from "vitest";
import { resolveCaseOwnership } from "@/lib/guest-ai/orchestrator/case-ownership";
import { CREDENTIAL_MARKER, type ModelDecision } from "@/lib/guest-ai/orchestrator/contracts";
import { looksLikeFabricatedCredential, validateDecision, type ValidationInput } from "@/lib/guest-ai/validation/output-validator";
import type { OpenCase } from "@/lib/guest-ai/types";

const OPEN: OpenCase[] = [{ id: "c1", source: "conversation_status", topic: null, status: "needs_human" }];
const decision = (over: Partial<ModelDecision> = {}): ModelDecision => ({
  strategy: "answer",
  reply: "O check-in é a partir das 15h.",
  handoff: { needed: false, question: null, urgency: null },
  caseRelation: "no_open_case",
  groundedOn: [],
  missingInformation: [],
  capabilityNeeds: [],
  credentialIntent: "none",
  commitments: [],
  ...over,
});
const input = (d: ModelDecision, over: Partial<ValidationInput> = {}): ValidationInput => ({
  decision: d,
  credentialPolicy: "deny",
  ownership: resolveCaseOwnership([], d.caseRelation),
  sourceIds: null,
  ...over,
});
const blocks = (i: ValidationInput) => validateDecision(i).blocks;

describe("B1 · posse humana por assunto (sem bloqueio global)", () => {
  it("sem chamado aberto: atendimento normal, qualquer relação declarada", () => {
    for (const r of ["related", "independent", "ambiguous", "new", "no_open_case"] as const) {
      const o = resolveCaseOwnership([], r);
      expect(o.gate).toMatchObject({ aiMayAnswer: true, humanOwnsTopic: false, needsClarification: false });
      expect(o.relationMissing).toBe(false);
    }
  });
  it("com chamado: related ⇒ assunto da equipe; ambiguous ⇒ esclarecer; independent/new ⇒ normal; a IA SEMPRE pode responder", () => {
    expect(resolveCaseOwnership(OPEN, "related").gate).toMatchObject({ aiMayAnswer: true, humanOwnsTopic: true, caseId: "c1" });
    expect(resolveCaseOwnership(OPEN, "ambiguous").gate).toMatchObject({ aiMayAnswer: true, needsClarification: true });
    expect(resolveCaseOwnership(OPEN, "independent").gate).toMatchObject({ aiMayAnswer: true, humanOwnsTopic: false, needsClarification: false });
    expect(resolveCaseOwnership(OPEN, "new").gate).toMatchObject({ aiMayAnswer: true, humanOwnsTopic: false });
  });
  it("com chamado e o modelo ignorando a relação ⇒ marcado e tratado como ambíguo", () => {
    expect(resolveCaseOwnership(OPEN, "no_open_case")).toMatchObject({ relationMissing: true, gate: { needsClarification: true } });
  });
  it("validação: compromisso sobre assunto da equipe bloqueia; resposta independente passa", () => {
    const related = decision({ caseRelation: "related", commitments: ["vou trocar o chuveiro hoje"] });
    expect(blocks(input(related, { ownership: resolveCaseOwnership(OPEN, "related") }))).toEqual(["human_owned_topic_commitment"]);
    const ok = decision({ caseRelation: "related", reply: "A equipe já está cuidando disso e te atualiza por aqui." });
    expect(validateDecision(input(ok, { ownership: resolveCaseOwnership(OPEN, "related") })).verdict).toBe("pass");
    const indep = decision({ caseRelation: "independent", commitments: ["envio o horário do mercado"] });
    expect(validateDecision(input(indep, { ownership: resolveCaseOwnership(OPEN, "independent") })).verdict).toBe("pass");
  });
  it("validação: ambíguo exige esclarecer; relação ausente com chamado aberto bloqueia", () => {
    expect(blocks(input(decision({ caseRelation: "ambiguous" }), { ownership: resolveCaseOwnership(OPEN, "ambiguous") }))).toEqual(["ambiguous_case_requires_clarify"]);
    expect(validateDecision(input(decision({ caseRelation: "ambiguous", strategy: "clarify", reply: "É sobre o chuveiro ou outra coisa?" }), { ownership: resolveCaseOwnership(OPEN, "ambiguous") })).verdict).toBe("pass");
    expect(blocks(input(decision(), { ownership: resolveCaseOwnership(OPEN, "no_open_case") }))).toEqual(["case_relation_missing", "ambiguous_case_requires_clarify"]);
  });
});

describe("B1 · validação estrutural", () => {
  it("resposta vazia fora de handoff; handoff puro pode ser vazio", () => {
    expect(blocks(input(decision({ reply: "" })))).toEqual(["reply_missing"]);
    expect(validateDecision(input(decision({ strategy: "handoff", reply: "", handoff: { needed: true, question: "Libera às 13h?", urgency: "normal" } }))).verdict).toBe("pass");
  });
  it("coerência do encaminhamento", () => {
    expect(blocks(input(decision({ strategy: "handoff", reply: "" })))).toEqual(["handoff_inconsistent"]);
    expect(blocks(input(decision({ handoff: { needed: true, question: "x", urgency: null } })))).toEqual(["handoff_inconsistent"]);
    expect(blocks(input(decision({ strategy: "answer_and_handoff", handoff: { needed: true, question: null, urgency: null } })))).toEqual(["handoff_inconsistent"]);
  });
  it("resposta acima do limite", () => {
    expect(blocks(input(decision({ reply: "a".repeat(4_001) })))).toContain("reply_too_long");
  });
  it("fundamento: id inexistente bloqueia quando a composição fornece ids; sem ids, não é checado", () => {
    const d = decision({ groundedOn: ["f:checkin", "faq:inexistente"] });
    expect(blocks(input(d, { sourceIds: new Set(["f:checkin"]) }))).toEqual(["grounding_unknown_source"]);
    expect(validateDecision(input(d, { sourceIds: new Set(["f:checkin", "faq:inexistente"]) })).verdict).toBe("pass");
    expect(validateDecision(input(d, { sourceIds: null })).verdict).toBe("pass");
  });
});

describe("B1 · credenciais: o modelo nunca as vê", () => {
  it("intenção de entregar exige marcador único, e só com D9 = allow", () => {
    const deliver = decision({ credentialIntent: "would_deliver", reply: `Aqui está a senha temporária: ${CREDENTIAL_MARKER}` });
    expect(validateDecision(input(deliver, { credentialPolicy: "allow" })).verdict).toBe("pass");
    expect(blocks(input(deliver, { credentialPolicy: "deny" }))).toEqual(["credential_intent_against_policy"]);
    expect(blocks(input(decision({ credentialIntent: "would_deliver" }), { credentialPolicy: "allow" }))).toEqual(["credential_intent_without_marker"]);
    expect(blocks(input(decision({ reply: `Senha: ${CREDENTIAL_MARKER}` }), { credentialPolicy: "allow" }))).toEqual(["credential_marker_without_intent"]);
    expect(blocks(input(decision({ credentialIntent: "would_deliver", reply: `${CREDENTIAL_MARKER} e ${CREDENTIAL_MARKER}` }), { credentialPolicy: "allow" }))).toEqual(["credential_marker_repeated"]);
  });
  it.each([
    "A senha do cadeado é 4821",
    "o código do portão: 7733#",
    "Your door code is 5521",
    "PIN 0042",
    "senha temporária do cofre é 1234",
    "a contraseña es 9988",
    `Senha: ${CREDENTIAL_MARKER} 4821`,
    `4821 ${CREDENTIAL_MARKER}`,
  ])("código fabricado bloqueia: %s", (reply) => {
    expect(looksLikeFabricatedCredential(reply)).toBe(true);
  });
  it.each([
    "O check-in é às 15:00 e o checkout às 11h.",
    "A senha do Wi-Fi chega no dia do check-in.",
    `A senha temporária do cadeado é ${CREDENTIAL_MARKER}.`,
    "O código de acesso será enviado no dia da chegada, a partir das 15h.",
    "Temos 2 vagas e 3 quartos; o prédio fica a 500 m do centro.",
    "Sua reserva de 12/11 a 15/11 está confirmada. 😊",
    "Desculpa a demora! Já te explico como funciona o portão.",
    "Haha, entendo! O código de conduta do condomínio pede silêncio após 22h.",
    "A senha chega no dia 02/11/2026, junto com as instruções.",
    "O código do portão é enviado às 14:30.",
  ])("texto natural NÃO é bloqueado (não é censura de estilo): %s", (reply) => {
    expect(looksLikeFabricatedCredential(reply)).toBe(false);
    expect(validateDecision(input(decision({ reply, credentialIntent: reply.includes(CREDENTIAL_MARKER) ? "would_deliver" : "none" }), { credentialPolicy: "allow" })).verdict).toBe("pass");
  });
  it("código fabricado aparece como bloqueio na validação", () => {
    expect(blocks(input(decision({ reply: "A senha do cadeado é 4821" })))).toEqual(["possible_fabricated_credential"]);
  });
});
