import { readFileSync } from "node:fs";
import path from "node:path";
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

describe("Fechamento B1 · item 3 — posse humana com 2+ chamados abertos", () => {
  const TWO: OpenCase[] = [
    { id: "case-chuveiro", source: "conversation_status", topic: null, status: "needs_human" },
    { id: "case-estacionamento", source: "conversation_status", topic: null, status: "assigned" },
  ];
  const THREE: OpenCase[] = [...TWO, { id: "case-limpeza", source: "conversation_status", topic: null, status: "needs_human" }];

  it("(d) evaluateCaseGate (F1) com N itens: decide pela relação; caseId do F1 seria sempre o 1º (palpite) — por isso não é usado", async () => {
    const { evaluateCaseGate } = await import("@/lib/guest-ai/policy/engine");
    expect(evaluateCaseGate(TWO, "related")).toEqual({ aiMayAnswer: true, humanOwnsTopic: true, needsClarification: false, caseId: "case-chuveiro" });
    expect(evaluateCaseGate(TWO, "independent")).toEqual({ aiMayAnswer: true, humanOwnsTopic: false, needsClarification: false, caseId: null });
    expect(evaluateCaseGate(THREE, "ambiguous")).toEqual({ aiMayAnswer: true, humanOwnsTopic: false, needsClarification: true, caseId: null });
  });

  it("(a) relacionada a UM chamado e independente do outro: regra da equipe vale (sem compromisso), atribuição 'unattributed', caseId nulo", () => {
    const o = resolveCaseOwnership(TWO, "related");
    expect(o).toMatchObject({ openCaseCount: 2, attribution: "unattributed", relationMissing: false, gate: { aiMayAnswer: true, humanOwnsTopic: true, caseId: null } });
    // a IA pode responder (reconhecer que a equipe cuida), mas não pode assumir compromisso
    expect(validateDecision(input(decision({ caseRelation: "related", reply: "A equipe já está cuidando disso." }), { ownership: o })).verdict).toBe("pass");
    expect(blocks(input(decision({ caseRelation: "related", commitments: ["vaga liberada amanhã"] }), { ownership: o }))).toEqual(["human_owned_topic_commitment"]);
  });

  it("(b) independente de TODOS os chamados: atendimento normal, compromissos permitidos", () => {
    for (const cases of [TWO, THREE]) {
      const o = resolveCaseOwnership(cases, "independent");
      expect(o).toMatchObject({ openCaseCount: cases.length, attribution: "none", gate: { humanOwnsTopic: false, needsClarification: false } });
      expect(validateDecision(input(decision({ caseRelation: "independent", commitments: ["envio o horário do mercado"] }), { ownership: o })).verdict).toBe("pass");
    }
    expect(resolveCaseOwnership(TWO, "new").gate.humanOwnsTopic).toBe(false);
  });

  it("(c) ambígua entre os chamados: exige esclarecer; resposta que esclarece passa", () => {
    const o = resolveCaseOwnership(THREE, "ambiguous");
    expect(o).toMatchObject({ openCaseCount: 3, attribution: "none", gate: { needsClarification: true, humanOwnsTopic: false } });
    expect(blocks(input(decision({ caseRelation: "ambiguous" }), { ownership: o }))).toEqual(["ambiguous_case_requires_clarify"]);
    expect(validateDecision(input(decision({ caseRelation: "ambiguous", strategy: "clarify", reply: "É sobre o chuveiro ou o estacionamento?" }), { ownership: o })).verdict).toBe("pass");
  });

  it("com 2+ chamados e o modelo dizendo 'no_open_case': marcado e tratado como ambíguo", () => {
    expect(resolveCaseOwnership(TWO, "no_open_case")).toMatchObject({ relationMissing: true, gate: { needsClarification: true } });
  });

  it("NUNCA bloqueio global: em todas as combinações a IA pode responder", () => {
    for (const cases of [[], OPEN, TWO, THREE]) {
      for (const r of ["related", "independent", "ambiguous", "new", "no_open_case"] as const) {
        expect(resolveCaseOwnership(cases, r).gate.aiMayAnswer).toBe(true);
      }
    }
  });
});

describe("Fechamento B1 · item 4 — consistência formato × parser × validator × posse humana", () => {
  it("o texto de formato cita todas as capacidades, urgências, o marcador e os limites do parser", async () => {
    const { DECISION_FORMAT_SPEC, DECISION_LIMITS, parseModelDecision } = await import("@/lib/guest-ai/orchestrator/decision");
    const { CAPABILITY_IDS } = await import("@/lib/guest-ai/orchestrator/capabilities");
    const { HANDOFF_URGENCIES } = await import("@/lib/guest-ai/orchestrator/contracts");
    for (const c of CAPABILITY_IDS) expect(DECISION_FORMAT_SPEC).toContain(`"${c}"`);
    for (const u of HANDOFF_URGENCIES) expect(DECISION_FORMAT_SPEC).toContain(`"${u}"`);
    expect(DECISION_FORMAT_SPEC).toContain(CREDENTIAL_MARKER);
    expect(DECISION_FORMAT_SPEC).toContain(String(DECISION_LIMITS.replyMaxChars));
    // o limite do Validator é o mesmo do parser (fonte única)
    const { REPLY_MAX_CHARS } = await import("@/lib/guest-ai/validation/output-validator");
    expect(REPLY_MAX_CHARS).toBe(DECISION_LIMITS.replyMaxChars);
    // uma decisão que segue o formato à risca passa no parser E no validator
    const raw = { strategy: "answer", reply: "Ok!", handoff: { needed: false, question: null, urgency: null }, caseRelation: "no_open_case", groundedOn: ["faq:1"], missingInformation: [], capabilityNeeds: [{ capability: "local_places", reason: "x" }], credentialIntent: "none", commitments: [] };
    const d = parseModelDecision(raw)!;
    expect(validateDecision(input(d, { sourceIds: new Set(["faq:1"]) })).verdict).toBe("pass");
  });

  it("as relações do formato cobrem exatamente as do F1 + 'no_open_case'", async () => {
    const { CASE_RELATIONS } = await import("@/lib/guest-ai/orchestrator/contracts");
    expect([...CASE_RELATIONS].sort()).toEqual(["ambiguous", "independent", "new", "no_open_case", "related"]);
  });

  it("matriz marcador × intenção × D9", () => {
    const M = CREDENTIAL_MARKER;
    const cases: Array<[string, "none" | "would_deliver", "allow" | "deny", string[]]> = [
      [`Senha temporária: ${M}`, "would_deliver", "allow", []],
      [`Senha temporária: ${M}`, "would_deliver", "deny", ["credential_intent_against_policy"]],
      ["Já te envio a senha.", "would_deliver", "allow", ["credential_intent_without_marker"]],
      ["Já te envio a senha.", "would_deliver", "deny", ["credential_intent_without_marker", "credential_intent_against_policy"]],
      [`Senha: ${M}`, "none", "allow", ["credential_marker_without_intent"]],
      [`Senha: ${M}`, "none", "deny", ["credential_marker_without_intent"]],
      ["A senha chega no dia do check-in.", "none", "deny", []],
      ["A senha chega no dia do check-in.", "none", "allow", []],
    ];
    for (const [reply, credentialIntent, credentialPolicy, expected] of cases) {
      expect(blocks(input(decision({ reply, credentialIntent }), { credentialPolicy })), `${reply} | ${credentialIntent} | ${credentialPolicy}`).toEqual(expected);
    }
  });

  it("códigos inventados estruturais: 3+ dígitos após palavra de acesso detectados; 2 dígitos e horários não", () => {
    expect(looksLikeFabricatedCredential("senha 123")).toBe(true);
    expect(looksLikeFabricatedCredential("SENHA: 4821")).toBe(true);
    expect(looksLikeFabricatedCredential("código A7K29")).toBe(true);
    expect(looksLikeFabricatedCredential("senha 12")).toBe(false);
    expect(looksLikeFabricatedCredential("a senha vale até 23:59")).toBe(false);
    expect(looksLikeFabricatedCredential("senha do portão")).toBe(false);
  });

  it("compromissos: bloqueados SÓ sobre assunto da equipe; com 1 chamado e relação independente, permitidos", () => {
    const own = resolveCaseOwnership(OPEN, "related");
    expect(blocks(input(decision({ caseRelation: "related", commitments: ["x"] }), { ownership: own }))).toEqual(["human_owned_topic_commitment"]);
    expect(validateDecision(input(decision({ caseRelation: "independent", commitments: ["x"] }), { ownership: resolveCaseOwnership(OPEN, "independent") })).verdict).toBe("pass");
    expect(validateDecision(input(decision({ commitments: ["x"] }))).verdict).toBe("pass");
  });

  it("groundedOn: ids citados precisam existir; conjunto vazio de fontes bloqueia qualquer citação; sem citação passa", () => {
    expect(blocks(input(decision({ groundedOn: ["f:x"] }), { sourceIds: new Set() }))).toEqual(["grounding_unknown_source"]);
    expect(validateDecision(input(decision({ groundedOn: [] }), { sourceIds: new Set() })).verdict).toBe("pass");
    expect(validateDecision(input(decision({ groundedOn: ["f:x", "faq:2"] }), { sourceIds: new Set(["f:x", "faq:2", "review:1"]) })).verdict).toBe("pass");
  });

  it("REGRA VINCULANTE: o Validator não é filtro de estilo — nenhuma lista de frases, desculpas, emojis ou humor no código", () => {
    // código sem comentários (o cabeçalho explica, em texto, que NÃO há filtro de estilo)
    const src = readFileSync(path.resolve(__dirname, "../validation/output-validator.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(src).not.toMatch(/desculp|sinto muito|lamento|perd[aã]o|sorry|apolog|emoji|\\p\{Emoji|haha|kkk|g[ií]ria/i);
    for (const reply of ["Sinto muito pelo transtorno! Já vou te ajudar 😅", "Desculpe a demora, kkk", "Haha, adorei! 🎉🎉", "Peço desculpas, lamento muito."]) {
      expect(validateDecision(input(decision({ reply }))).verdict).toBe("pass");
    }
  });
});
