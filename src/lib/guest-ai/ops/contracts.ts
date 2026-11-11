/**
 * GATE G2 · AÇÕES OPERACIONAIS DA IA — contratos (puro).
 *
 * Diretrizes do titular (06/11/2026): conclusão de check-in, conclusão de check-out e previsão de horário
 * informada pelo hóspede, nos cards de `guest_arrival_status`. Decisões D-G2-1 a D-G2-5.
 *
 * Modos (`GUEST_AI_OPS_MODE`):
 *  - `live` (ou `on`) — G2c, decisão do titular (06/11/2026, sem período de observação): a ação é EXECUTADA
 *    no card com as rotinas oficiais do painel e auditada (`claimed` → `applied`, com fotos antes e depois);
 *  - `shadow` — só registra em auditoria o que a IA faria, sem escrever em card;
 *  - AUSENTE — `live` (08/11/2026: a falta do segredo não desliga mais os bastidores em silêncio);
 *  - qualquer outro valor explícito (ex.: `off`) — desligado.
 * A resposta ao hóspede continua sendo só sugestão do Copiloto (`slot.server.ts` devolve `null`).
 */

export const OPS_MODES = ["off", "shadow", "live"] as const;
export type OpsMode = (typeof OPS_MODES)[number];
export const OPS_MODE_ENV = "GUEST_AI_OPS_MODE";
/** Piloto opcional: lista de ids de imóvel; ausente/vazia ⇒ todos os imóveis da conta. */
export const OPS_PROPERTIES_ENV = "GUEST_AI_OPS_PROPERTY_IDS";

/**
 * `late_checkout` (G2c, diretriz de 06/11/2026, item 3): concessão EXPRESSA de horário de saída estendido
 * feita por atendente humano da equipe no chat ⇒ registrada no card de saída com autoria do atendente
 * (`internal_set_late_checkout`). Pedido do hóspede nunca é autorização.
 *
 * `early_departure` (diretriz 3): o hóspede confirma, com fato consumado, que JÁ saiu antes da data final da
 * reserva ⇒ o card de checkout é concluído e puxado para HOJE (data local do imóvel).
 */
export const OPS_ACTIONS = [
  "eta_checkin",
  "eta_checkout",
  "checkin_done",
  "checkout_done",
  "early_departure",
  "late_checkout",
] as const;
export type OpsAction = (typeof OPS_ACTIONS)[number];

/** Veredito da política para um sinal. */
const OPS_VERDICTS = ["would_apply", "refused"] as const;
export type OpsVerdict = (typeof OPS_VERDICTS)[number];
/** Desfechos gravados em `guest_ai_ops_actions` (shadow: would_apply|refused; live: claimed → applied|refused). */
export const OPS_AUDIT_OUTCOMES = ["would_apply", "claimed", "applied", "refused"] as const;

/**
 * Madrugada (diretriz 1): chegada entre 00:00 e 05:00 (exclusivo) no fuso do imóvel pertence à NOITE da
 * reserva que está começando — nunca "amanhã". O card de chegada continua sendo o da data de entrada.
 */
export const MADRUGADA_END_MINUTES = 5 * 60;

/** Origem com que a previsão da IA é gravada no card (D-G2-2). Informativa: previsão nenhuma dá baixa. */
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
  // acesso destravado no dia da entrada (14/11 · bastidores): exige o dia do check-in e o suporte de acesso antes
  "not_checkin_day",
  "access_context_missing",
  "not_checkout_day",
  "early_departure_not_certain",
  // late checkout concedido pela equipe (G2c)
  "staff_grant_ambiguous",
  "staff_grant_not_explicit",
  "not_checkout_window",
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
  // execução (live): a rotina oficial do painel recusou ou falhou; a previsão encontrou a da equipe
  "panel_refused",
  "apply_failed",
  "staff_prediction_race",
  "staff_author_unknown",
  "staff_not_authorized",
  "late_checkout_rejected",
  // LEITOR DOS BASTIDORES: o turno terminou SEM avançar nenhum card e o motivo fica na auditoria (sem buraco negro)
  "reader_no_signal",
  "reader_no_history",
  "reader_no_timezone",
  "reader_budget",
  "reader_deadline",
  "reader_timeout",
  "reader_model_failed",
  "reader_truncated",
  "reader_invalid_output",
  "reader_abstain_not_entry",
  "reader_abstain_question_or_plan",
  "reader_abstain_access_unresolved",
  "reader_abstain_context_unclear",
  "reader_abstain_no_fact",
  // UMA CABEÇA SÓ (11/11/2026): a decisão validada da resposta não trouxe marco nem previsão
  "response_no_signal",
] as const;
export type OpsRefusalCode = (typeof OPS_REFUSAL_CODES)[number];

/**
 * Códigos que o PRÓPRIO leitor devolve quando decide não declarar marco (`milestoneAbstain`). Fechados: nunca
 * texto livre. Cada um vira o código `reader_abstain_<x>` na auditoria.
 */
export const OPS_READER_ABSTAIN_CODES = [
  "not_entry",
  "question_or_plan",
  "access_unresolved",
  "context_unclear",
  "no_fact",
] as const;
export type OpsReaderAbstain = (typeof OPS_READER_ABSTAIN_CODES)[number];

/** Estado de um card (`guest_arrival_status`); `null` = sem linha (pendente por padrão). */
export interface OpsCardState {
  status: string | null;
  doneAt: string | null;
  arrivalTimeOverride: string | null;
  arrivalTimeSource: string | null;
  mutedUntil: string | null;
  /** Late checkout formal já registrado no card de saída (R6), e quando foi aprovado. */
  lateCheckoutTime: string | null;
  lateCheckoutApprovedAt: string | null;
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
  outcome: OpsVerdict;
  code: OpsRefusalCode | null;
  /** Id real da mensagem com a evidência (do hóspede; em `late_checkout`, a da equipe que concedeu). */
  evidenceMessageId: string | null;
  /** Previsão proposta (`eta_*`) ou nova data do card de saída (`early_departure`). */
  proposedDate: string | null;
  proposedTime: string | null;
  /** Previsão de chegada na madrugada (00:00–05:00), atribuída à noite da data de entrada. */
  madrugada: boolean;
  /** Estado do card antes (foto para auditoria e para o futuro "Desfazer"). */
  cardBefore: OpsCardState | null;
}
