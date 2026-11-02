/**
 * F2-B · B1 — POSSE HUMANA POR ASSUNTO (puro).
 *
 * Um chamado aberto NUNCA bloqueia a IA globalmente (não existe `if (hasOpenTicket) blockAI`).
 * A relação entre a mensagem e os chamados é INTERPRETADA pelo modelo (`caseRelation`); a REGRA é
 * determinística e vem do F1 (`evaluateCaseGate`):
 *  - related   ⇒ o assunto é da equipe: a resposta não pode assumir compromisso sobre ele;
 *  - ambiguous ⇒ esclarecer antes de assumir que é o mesmo assunto;
 *  - independent / new ⇒ atendimento normal.
 *
 * VÁRIOS CHAMADOS ABERTOS: o contrato atual da decisão traz UMA relação para o turno (não uma por
 * chamado). Comportamento, deliberadamente conservador:
 *  - "related" com 1 chamado ⇒ atribuído a ele (`attribution: "single"`, `caseId` preenchido);
 *  - "related" com 2+ chamados ⇒ a regra vale (sem compromissos), mas NÃO se sabe qual chamado
 *    (`attribution: "unattributed"`, `caseId: null`) — o F1 apontaria o primeiro, o que seria um palpite;
 *  - "ambiguous" ⇒ esclarecer, qualquer que seja o número de chamados;
 *  - "independent"/"new" ⇒ independente de TODOS os chamados: atendimento normal.
 * A associação granular por chamado exige o contrato mínimo da B2 (ver AGENTS.md / relatório).
 */
import { evaluateCaseGate, type CaseGate } from "@/lib/guest-ai/policy/engine";
import type { CaseRelation, OpenCase } from "@/lib/guest-ai/types";
import type { ModelCaseRelation } from "./contracts";

export interface CaseOwnership {
  gate: CaseGate;
  /** Havia chamado aberto e o modelo não classificou a relação com ele. */
  relationMissing: boolean;
  openCaseCount: number;
  /** A quem a posse humana do assunto foi atribuída. */
  attribution: "none" | "single" | "unattributed";
}

export function resolveCaseOwnership(openCases: readonly OpenCase[], modelRelation: ModelCaseRelation): CaseOwnership {
  const openCaseCount = openCases.length;
  if (openCaseCount === 0) {
    // Sem chamado aberto, qualquer relação declarada é irrelevante: atendimento normal.
    return { gate: evaluateCaseGate([], "new"), relationMissing: false, openCaseCount, attribution: "none" };
  }
  const relationMissing = modelRelation === "no_open_case";
  // Há chamado e o modelo ignorou: tratado como ambíguo (esclarecer), e sinalizado.
  const relation: CaseRelation = relationMissing ? "ambiguous" : (modelRelation as CaseRelation);
  const gate = evaluateCaseGate([...openCases], relation);
  if (!gate.humanOwnsTopic) return { gate, relationMissing, openCaseCount, attribution: "none" };
  if (openCaseCount === 1) return { gate, relationMissing, openCaseCount, attribution: "single" };
  // 2+ chamados: a regra (sem compromissos) vale, mas o chamado específico é desconhecido.
  return { gate: { ...gate, caseId: null }, relationMissing, openCaseCount, attribution: "unattributed" };
}
