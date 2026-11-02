/**
 * POLICY ENGINE — decide o que é permitido. Independente do Context Engine
 * (que só recupera e organiza) e de qualquer LLM. Não gera frases nem roteiros:
 * devolve decisões estruturadas.
 */
import type {
  AccessPolicyResult,
  CaseRelation,
  GuestAudience,
  OpenCase,
  PolicyOutcome,
  StayPhase,
} from "@/lib/guest-ai/types";
import { normalizeReservationStatus } from "./status";

/** Traduz o resultado D9 para o vocabulário do engine (permitido / negado / contexto insuficiente ou inconsistente). */
export function evaluateCredentialAccess(result: AccessPolicyResult): PolicyOutcome<AccessPolicyResult> {
  if (result.allowed) return { kind: "allowed", value: result };
  switch (result.reason) {
    case "missing_timezone":
    case "missing_checkin_time":
    case "reservation_invalid":
      return { kind: "insufficient_context", reason: result.reason };
    case "invalid_operational_state":
      return { kind: "inconsistent_context", reason: result.reason };
    default:
      return { kind: "denied", reason: result.reason };
  }
}

export interface AudienceInput {
  stayExists: boolean;
  status: string | null;
  phase: StayPhase;
  noShow: boolean;
}

/**
 * Audiências do Dossiê concedidas ao interlocutor.
 *  - P (Público): qualquer interlocutor com identidade/escopo já validados, mesmo sem reserva.
 *  - G (Reserva Ativa): só com reserva confirmada, não cancelada, sem no-show e antes do fim da estadia.
 *  - I (Equipe Interna): NUNCA para um hóspede.
 * Credenciais NÃO passam por aqui: seguem exclusivamente a D9.
 */
export function decideAudiences(i: AudienceInput): { audiences: GuestAudience[]; reasons: string[] } {
  const audiences: GuestAudience[] = ["P"];
  const reasons: string[] = ["public_always"];
  const active =
    i.stayExists &&
    normalizeReservationStatus(i.status) === "valid" &&
    !i.noShow &&
    (i.phase === "pre_stay" || i.phase === "in_stay");
  if (active) {
    audiences.push("G");
    reasons.push("active_reservation");
  } else {
    reasons.push(i.stayExists ? `reservation_not_active:${i.phase}` : "no_reservation");
  }
  return { audiences, reasons };
}

export interface CaseGate {
  /** SEMPRE true: um chamado aberto jamais bloqueia a conversa inteira. */
  aiMayAnswer: true;
  /** O assunto da mensagem pertence a um chamado em responsabilidade humana. */
  humanOwnsTopic: boolean;
  /** O assunto é ambíguo: perguntar ao hóspede antes de assumir que é o mesmo problema. */
  needsClarification: boolean;
  caseId: string | null;
}

/**
 * Relação entre a mensagem e os chamados abertos. A `relation` é fornecida por
 * quem classifica o assunto (nas próximas fases, o agente via ferramenta); F1
 * só garante a regra: a responsabilidade humana vale PARA AQUELE assunto.
 */
export function evaluateCaseGate(openCases: OpenCase[], relation: CaseRelation): CaseGate {
  const first = openCases[0] ?? null;
  return {
    aiMayAnswer: true,
    humanOwnsTopic: relation === "related" && first !== null,
    needsClarification: relation === "ambiguous" && first !== null,
    caseId: relation === "related" && first ? first.id : null,
  };
}
