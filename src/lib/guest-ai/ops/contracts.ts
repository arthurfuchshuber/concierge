/**
 * GATE G2 · AÇÕES OPERACIONAIS DA IA — contratos (puro).
 *
 * Diretrizes do titular (06/11/2026): conclusão de check-in, conclusão de check-out e previsão de horário
 * informada pelo hóspede, nos cards de `guest_arrival_status`. Decisões D-G2-1 a D-G2-5.
 *
 * ETAPA G2a: só OBSERVAÇÃO. O modo `shadow` registra em auditoria (`guest_ai_ops_actions`) o que a IA
 * faria, sem escrever em card nenhum. O modo `on` não existe nesta etapa: qualquer valor diferente de
 * `shadow` é `off`. A escrita nos cards entra só nas etapas G2c/G2d, com nova homologação.
 */

/** Modos aceitos nesta etapa. `on` NÃO é aceito (G2a): vira `off`. */
export const OPS_MODES = ["off", "shadow"] as const;
export type OpsMode = (typeof OPS_MODES)[number];
export const OPS_MODE_ENV = "GUEST_AI_OPS_MODE";
/** Piloto opcional: lista de ids de imóvel; ausente/vazia ⇒ todos os imóveis da conta. */
export const OPS_PROPERTIES_ENV = "GUEST_AI_OPS_PROPERTY_IDS";

/**
 * `early_departure` (diretriz 3): o hóspede confirma, com fato consumado, que JÁ saiu antes da data final da
 * reserva ⇒ o card de checkout seria puxado para HOJE (data local do imóvel) e concluído.
 */
export const OPS_ACTIONS = [
  "eta_checkin",
  "eta_checkout",
  "checkin_done",
  "checkout_done",
  "early_departure",
] as const;
export type OpsAction = (typeof OPS_ACTIONS)[number];

/** Desfechos registráveis na G2a (a migration aceita só estes). */
export const OPS_OUTCOMES = ["would_apply", "refused"] as const;
export type OpsOutcome = (typeof OPS_OUTCOMES)[number];

/**
 * Madrugada (diretriz 1): chegada entre 00:00 e 05:00 (exclusivo) no fuso do imóvel pertence à NOITE da
 * reserva que está começando — nunca "amanhã". O card de chegada continua sendo o da data de entrada.
 */
export const MADRUGADA_END_MINUTES = 5 * 60;

/** Origem com que a previsão da IA SERÁ gravada (D-G2-2; o auto-checkout a ignora). Não usada na G2a. */
export const GUEST_AI_ARRIVAL_SOURCE = "guest_ai" as const;

/** Motivos fechados de recusa (sem texto do hóspede). */
export const OPS_REFUSAL_CODES = [
  // evidência
  "quote_missing",
  "evidence_not_guest",
  "evidence_not_current",
  "quote_not_in_message",
  "lexical_negation",
  "lexical_future",
  "lexical_question",
  "lexical_problem",
  "lexical_conditional",
  "lexical_temporary_leave",
  "lexical_not_property_access",
  "lexical_uncertain",
  "time_not_in_quote",
  // reserva e datas
  "no_reservation",
  "reservation_not_active",
  "no_timezone",
  "not_in_stay",
  "not_checkout_day",
  "early_departure_not_certain",
  "eta_date_mismatch",
  "eta_phase_mismatch",
  "eta_out_of_bounds",
  // card
  "card_done",
  "card_muted",
  "staff_prediction",
  // equipe e negociações
  "assigned_to_team",
  "team_in_command",
  "open_case",
  "handoff_needed",
  "problem_or_negotiation",
  // dados
  "state_unavailable",
] as const;
export type OpsRefusalCode = (typeof OPS_REFUSAL_CODES)[number];

/** Estado de um card (`guest_arrival_status`); `null` = sem linha (pendente por padrão). */
export interface OpsCardState {
  status: string | null;
  doneAt: string | null;
  arrivalTimeOverride: string | null;
  arrivalTimeSource: string | null;
  mutedUntil: string | null;
}

/** Estado da conversa relevante para as travas (pedido 6 da diretriz). */
export interface OpsConversationState {
  status: string | null;
  assignedTo: string | null;
  handoffReason: string | null;
  handoffUrgency: string | null;
  aiPaused: boolean | null;
  pausedUntil: string | null;
}

export interface OpsPropertyTimes {
  checkinTime: string | null;
  checkinTimeMax: string | null;
  checkoutTime: string | null;
  checkoutTimeMin: string | null;
}

export interface OpsReservationState {
  id: string;
  status: string | null;
  checkinDate: string | null;
  checkoutDate: string | null;
}

/** Resultado da política para UM sinal (registrado em auditoria). */
export interface OpsEvaluation {
  action: OpsAction;
  outcome: OpsOutcome;
  code: OpsRefusalCode | null;
  /** Id real da mensagem do hóspede com a evidência (quando identificada). */
  evidenceMessageId: string | null;
  /** Previsão proposta (`eta_*`) ou nova data do card de saída (`early_departure`). */
  proposedDate: string | null;
  proposedTime: string | null;
  /** Previsão de chegada na madrugada (00:00–05:00), atribuída à noite da data de entrada. */
  madrugada: boolean;
  /** Estado do card antes (foto para auditoria e para o futuro "Desfazer"). */
  cardBefore: OpsCardState | null;
}
