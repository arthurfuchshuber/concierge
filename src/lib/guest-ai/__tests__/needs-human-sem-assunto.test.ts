import { describe, expect, it } from "vitest";
import { resolveCaseOwnership } from "../orchestrator/case-ownership";
import type { OpenCase } from "../types";

// Auditoria 15/11/2026: status da conversa sem assunto não limita a IA nem exige relação do modelo.
const semAssunto: OpenCase = { id: "c", source: "conversation_status", topic: null, status: "needs_human" };
const decisao: OpenCase = { id: "d", source: "decision", topic: "late_checkout", status: "pending" };

describe("chamado sem assunto não trava a IA", () => {
  it("só status da conversa: atendimento normal, sem case_relation_missing", () => {
    const o = resolveCaseOwnership([semAssunto], "no_open_case");
    expect(o.relationMissing).toBe(false);
    expect(o.openCaseCount).toBe(0);
    expect(o.gate.humanOwnsTopic).toBe(false);
    expect(o.gate.needsClarification).toBe(false);
  });
  it("mesmo se o modelo disser related, sem assunto não protege nada", () => {
    expect(resolveCaseOwnership([semAssunto], "related").gate.humanOwnsTopic).toBe(false);
  });
  it("chamado COM assunto continua delimitando: related protege e ausência de relação é sinalizada", () => {
    expect(resolveCaseOwnership([decisao], "related").gate.humanOwnsTopic).toBe(true);
    expect(resolveCaseOwnership([decisao], "no_open_case").relationMissing).toBe(true);
    expect(resolveCaseOwnership([semAssunto, decisao], "independent").openCaseCount).toBe(1);
  });
});
