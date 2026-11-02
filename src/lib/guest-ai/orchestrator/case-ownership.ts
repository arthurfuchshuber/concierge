/**
 * F2-B · B1 — POSSE HUMANA POR ASSUNTO (puro).
 *
 * Um chamado aberto NUNCA bloqueia a IA globalmente (não existe `if (hasOpenTicket) blockAI`).
 * A relação entre a mensagem e o chamado é INTERPRETADA pelo modelo (`caseRelation`); a REGRA é
 * determinística e vem do F1 (`evaluateCaseGate`):
 *  - related   ⇒ o assunto é da equipe: a resposta não pode assumir compromisso sobre ele;
 *  - ambiguous ⇒ esclarecer antes de assumir que é o mesmo assunto;
 *  - independent / new ⇒ atendimento normal.
 */
import { evaluateCaseGate, type CaseGate } from "@/lib/guest-ai/policy/engine";
import type { CaseRelation, OpenCase } from "@/lib/guest-ai/types";
import type { ModelCaseRelation } from "./contracts";

export interface CaseOwnership {
  gate: CaseGate;
  /** Havia chamado aberto e o modelo não classificou a relação com ele. */
  relationMissing: boolean;
}

export function resolveCaseOwnership(openCases: readonly OpenCase[], modelRelation: ModelCaseRelation): CaseOwnership {
  const hasOpen = openCases.length > 0;
  if (!hasOpen) {
    // Sem chamado aberto, qualquer relação declarada é irrelevante: atendimento normal.
    return { gate: evaluateCaseGate([], "new"), relationMissing: false };
  }
  if (modelRelation === "no_open_case") {
    // Há chamado e o modelo ignorou: tratado como ambíguo (esclarecer), e sinalizado.
    return { gate: evaluateCaseGate([...openCases], "ambiguous"), relationMissing: true };
  }
  const relation: CaseRelation = modelRelation;
  return { gate: evaluateCaseGate([...openCases], relation), relationMissing: false };
}
