/**
 * B2.3 · Parser de decisões — formatos aceitos, erros tipados, compatibilidade v1/v2/v3,
 * identificadores adulterados e tentativas de alterar escopo. Erros nunca ecoam valores.
 */
import { describe, expect, it } from "vitest";
import {
  DECISION_PARSE_ERRORS,
  DECISION_TEXT_MAX_CHARS,
  DECISION_FORMAT_SPEC,
  parseDecision,
  parseDecisionText,
  parseModelDecision,
} from "@/lib/guest-ai/orchestrator/decision";
import { COMMITMENT_KINDS, CURRENT_DECISION_VERSION, commitmentKindsOf, decisionSignals } from "@/lib/guest-ai/orchestrator/contracts";
import { validateDecision } from "@/lib/guest-ai/validation/output-validator";
import { resolveCaseOwnership } from "@/lib/guest-ai/orchestrator/case-ownership";
import { validDecision } from "./helpers/decision-fixtures";
import { v2 } from "./helpers/b21-fixtures";
import { v3 } from "./helpers/b23-chain";

const err = (r: ReturnType<typeof parseDecision>) => (r.ok ? null : r.error);

describe("B2.3 · parser — formatos válidos e compatibilidade", () => {
  it("v3 válida: aceita, versão 3, tipos de compromisso normalizados", () => {
    const r = parseDecision(v3({ commitments: ["Vou repassar à equipe"], commitmentKinds: ["team_relay"] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.version).toBe(3);
    expect(commitmentKindsOf(r.decision)).toEqual(["team_relay"]);
    expect(decisionSignals(r.decision).version).toBe(3);
  });
  it("v2 e v1 continuam aceitas (compatibilidade preservada) e parseModelDecision mantém o contrato B1", () => {
    const a = parseDecision(v2());
    const b = parseDecision(validDecision());
    expect(a.ok && a.version).toBe(2);
    expect(b.ok && b.version).toBe(1);
    expect(parseModelDecision(v2())).not.toBeNull();
    expect(parseModelDecision(validDecision())).not.toBeNull();
    expect(commitmentKindsOf(parseModelDecision(v2())!)).toBeNull();
    expect(parseModelDecision({ ...validDecision(), extra: 1 })).toBeNull();
  });
  it("exigência de versão: a cadeia pede v3; v1/v2 viram version_mismatch", () => {
    expect(CURRENT_DECISION_VERSION).toBe(6); // Visão (07/11/2026): a cadeia exige v6; v3–v5 continuam aceitas pelo parser sem exigência
    expect(err(parseDecision(v2(), { expectVersion: 3 }))?.code).toBe("version_mismatch");
    expect(err(parseDecision(validDecision(), { expectVersion: 3 }))?.code).toBe("version_mismatch");
    expect(parseDecision(v3(), { expectVersion: 3 }).ok).toBe(true);
  });
  it("o formato pedido ao modelo descreve commitmentKinds e todos os tipos", () => {
    expect(DECISION_FORMAT_SPEC).toContain('"commitmentKinds"');
    for (const k of COMMITMENT_KINDS) expect(DECISION_FORMAT_SPEC).toContain(`"${k}"`);
  });
});

describe("B2.3 · parser — JSON inválido, truncado, vazio, grande", () => {
  it.each([
    [undefined, "not_text"],
    [{ a: 1 }, "not_text"],
    ["", "empty_output"],
    ["   ", "empty_output"],
    ["{strategy: answer}", "malformed_json"],
    ["{\"strategy\":\"answer\"}}", "malformed_json"],
    ["texto solto", "malformed_json"],
    ['{"strategy":"answer","reply":"O check', "truncated_json"],
    ['{"strategy":"answer","handoff":{"needed":false', "truncated_json"],
    ["[1,2", "truncated_json"],
    ["[]", "not_object"],
    ["null", "not_object"],
    ["42", "not_object"],
  ])("%j ⇒ %s", (text, code) => {
    expect(err(parseDecisionText(text))?.code).toBe(code);
  });
  it("saída acima do teto ⇒ output_too_large (antes de interpretar)", () => {
    expect(err(parseDecisionText(" ".repeat(10) + "x".repeat(DECISION_TEXT_MAX_CHARS + 1)))?.code).toBe("output_too_large");
  });
  it("texto válido passa pelo mesmo parse estrito", () => {
    const r = parseDecisionText(JSON.stringify(v3()), { expectVersion: 3 });
    expect(r.ok).toBe(true);
  });
});

describe("B2.3 · parser — campos ausentes, extras, tipos e enums", () => {
  it.each(["strategy", "reply", "handoff", "caseRelation", "groundedOn", "missingInformation", "capabilityNeeds", "credentialIntent", "commitments"])(
    "sem %s ⇒ missing_field com o nome do campo do contrato",
    (k) => {
      const d: Record<string, unknown> = v3();
      delete d[k];
      expect(err(parseDecision(d))).toEqual({ code: "missing_field", field: k });
    },
  );
  it("chave desconhecida ⇒ unexpected_field, sem ecoar o nome (pode conter segredo)", () => {
    const e = err(parseDecision({ ...v3(), "senha-7319": "7319", outra: 1 }));
    expect(e).toEqual({ code: "unexpected_field", field: null, unexpectedCount: 2 });
    expect(JSON.stringify(e)).not.toContain("7319");
  });
  it("v2 parcial ou v3 sem v2 ⇒ mixed_version", () => {
    const partial: Record<string, unknown> = v2();
    delete partial["speakerName"];
    expect(err(parseDecision(partial))?.code).toBe("mixed_version");
    expect(err(parseDecision({ ...validDecision(), commitmentKinds: [] }))?.code).toBe("mixed_version");
  });
  it.each([
    [{ strategy: "approve" }, "invalid_strategy"],
    [{ strategy: 1 }, "invalid_strategy"],
    [{ reply: 42 }, "invalid_reply"],
    [{ reply: "x".repeat(4_001) }, "invalid_reply"],
    [{ handoff: { needed: "sim", question: null, urgency: null } }, "invalid_handoff"],
    [{ handoff: { needed: false, question: null } }, "invalid_handoff"],
    [{ handoff: { needed: false, question: null, urgency: "critical" } }, "invalid_handoff"],
    [{ caseRelation: "mine" }, "invalid_case_relation"],
    [{ credentialIntent: "deliver_now" }, "invalid_credential_intent"],
    [{ groundedOn: "ctx:fase" }, "invalid_list"],
    [{ groundedOn: [""] }, "invalid_list"],
    [{ commitments: [1] }, "invalid_list"],
    [{ missingInformation: ["x".repeat(301)] }, "invalid_list"],
    [{ capabilityNeeds: [{ capability: "send_message", reason: "x" }] }, "invalid_capability"],
    [{ shouldReply: "false" }, "invalid_signals"],
    [{ intents: [] }, "invalid_signals"],
    [{ intents: ["acknowledgment", "acknowledgment"] }, "invalid_signals"],
    [{ formalChangeRequests: ["upgrade"] }, "invalid_signals"],
    [{ commitmentKinds: ["approve_everything"] }, "invalid_commitment_kinds"],
    [{ commitmentKinds: ["team_relay", "team_relay"] }, "invalid_commitment_kinds"],
    [{ commitmentKinds: "team_relay" }, "invalid_commitment_kinds"],
  ])("%j ⇒ %s", (over, code) => {
    expect(err(parseDecision(v3(over)))?.code).toBe(code);
  });
  it("todos os códigos de erro são de lista fechada", () => {
    expect(new Set(DECISION_PARSE_ERRORS).size).toBe(DECISION_PARSE_ERRORS.length);
  });
});

describe("B2.3 · parser — escopo e identificadores (o modelo não altera tenant, imóvel ou autorização)", () => {
  it.each(["tenantId", "tenant_id", "propertyId", "property_id", "reservationId", "conversationId", "userId", "ownerId", "audiences", "authorization", "permissions", "scope"])(
    "chave de escopo %s no topo ⇒ scope_field_forbidden",
    (k) => {
      expect(err(parseDecision({ ...v3(), [k]: "00000000-0000-4000-8000-000000000999" }))).toEqual({ code: "scope_field_forbidden", field: null });
    },
  );
  it("chave de escopo aninhada (no encaminhamento ou na necessidade de capacidade) também é recusada", () => {
    expect(err(parseDecision(v3({ handoff: { needed: true, question: "q", urgency: "low", propertyId: "p2" } })))?.code).toBe("scope_field_forbidden");
    expect(err(parseDecision(v3({ capabilityNeeds: [{ capability: "portfolio_search", reason: "x", tenant_id: "t2" }] })))?.code).toBe("scope_field_forbidden");
    expect(err(parseDecision(v3({ hospitalityMilestone: { kind: "checkin_confirmed", evidence: ["hist:guest:h1"], reservation_id: "r9" } })))?.code).toBe("scope_field_forbidden");
  });
  it("id de fonte com formato adulterado ⇒ invalid_list; id bem formado mas fora do contexto ⇒ bloqueio estrutural", () => {
    for (const bad of ["ctx fase", "<x>:1", "javascript:alert(1)//" + "x".repeat(200), "dos:alt1:../../etc"]) {
      const r = parseDecision(v3({ groundedOn: [bad] }));
      if (r.ok) {
        // bem formado: precisa existir no contexto composto
        const v = validateDecision({ decision: r.decision, credentialPolicy: "deny", ownership: resolveCaseOwnership([], r.decision.caseRelation), sourceIds: new Set(["ctx:fase"]) });
        expect(v.blocks).toContain("grounding_unknown_source");
      } else {
        expect(r.error.code).toBe("invalid_list");
      }
    }
    const forged = parseDecision(v3({ groundedOn: ["dos:alt9:entrada"] }));
    expect(forged.ok).toBe(true);
    if (forged.ok) {
      const v = validateDecision({ decision: forged.decision, credentialPolicy: "deny", ownership: resolveCaseOwnership([], "no_open_case"), sourceIds: new Set(["dos:principal:a"]) });
      expect(v.blocks).toContain("grounding_unknown_source");
    }
  });
  it("__proto__ e objetos não planos não passam", () => {
    expect(err(parseDecisionText('{"__proto__":{"admin":true},' + JSON.stringify(v3()).slice(1)))?.code).toBe("unexpected_field");
    class Fake {}
    expect(err(parseDecision(Object.assign(new Fake(), v3())))?.code).toBe("not_object");
  });
  it("ausência de informação nunca vira autorização: sem kinds na v2 os compromissos ficam não verificáveis", () => {
    const d = parseModelDecision(v2({ commitments: ["Libero a entrada às 10h"] }))!;
    expect(commitmentKindsOf(d)).toBeNull();
  });
});
