/**
 * Proactive Rules Engine — regras declarativas de antecipação.
 *
 * Cada regra define o gatilho, a ação recomendada e o LIMITE DE AUTONOMIA:
 *   low    → executa automaticamente
 *   medium → executa após validação humana
 *   high   → sempre exige humano
 */

export type ProactiveAutonomy = "low" | "medium" | "high";

export type ProactiveTrigger =
  | "reservation_created"
  | "checkin_upcoming"
  | "stay_started"
  | "checkout_upcoming"
  | "returning_guest"
  | "recurring_issue"
  | "low_satisfaction"
  | "silent_guest";

export type ProactiveSignal = {
  trigger: ProactiveTrigger;
  tenantId: string;
  ownerId: string;
  propertyId: string;
  propertyName?: string | null;
  reservationId?: string | null;
  conversationId?: string | null;
  guestId?: string | null;
  guestName?: string | null;
  /** Dados brutos do evento (datas, contadores, sentimento). */
  payload: Record<string, unknown>;
};

export type ProactiveRule = {
  key: string;
  trigger: ProactiveTrigger;
  description: string;
  autonomy: ProactiveAutonomy;
  /** Janela em horas antes/depois do evento em que a ação faz sentido. */
  windowHours?: number;
  /** Decide se o sinal atende à regra. */
  matches: (signal: ProactiveSignal) => boolean;
  /** Ação recomendada, em linguagem operacional. */
  action: (signal: ProactiveSignal) => string;
};

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0));

export const PROACTIVE_RULES: ProactiveRule[] = [
  {
    key: "welcome_pre_checkin",
    trigger: "checkin_upcoming",
    description: "Enviar instruções personalizadas de chegada antes do check-in.",
    autonomy: "low",
    windowHours: 48,
    matches: (s) => num(s.payload.hoursToCheckin) <= 48 && num(s.payload.hoursToCheckin) > 0,
    action: (s) =>
      `Enviar mensagem de boas-vindas com instruções de chegada, acesso e horário para ${s.guestName ?? "o hóspede"}.`,
  },
  {
    key: "reservation_briefing",
    trigger: "reservation_created",
    description: "Preparar briefing interno da reserva recém-criada.",
    autonomy: "low",
    matches: () => true,
    action: (s) =>
      `Gerar briefing da reserva (datas, perfil do hóspede, particularidades do imóvel ${s.propertyName ?? ""}).`,
  },
  {
    key: "returning_guest_recognition",
    trigger: "returning_guest",
    description: "Reconhecer hóspede recorrente e aplicar preferências conhecidas.",
    autonomy: "low",
    matches: (s) => num(s.payload.previousStays) >= 1,
    action: (s) =>
      `Reconhecer retorno de ${s.guestName ?? "hóspede"} e aplicar preferências registradas (${num(s.payload.previousStays)} estadias anteriores).`,
  },
  {
    key: "checkout_instructions",
    trigger: "checkout_upcoming",
    description: "Enviar instruções de saída antes do checkout.",
    autonomy: "low",
    windowHours: 24,
    matches: (s) => num(s.payload.hoursToCheckout) <= 24 && num(s.payload.hoursToCheckout) > 0,
    action: () => "Enviar instruções de saída (horário, chaves, lixo, itens esquecidos).",
  },
  {
    key: "recurring_issue_alert",
    trigger: "recurring_issue",
    description: "Alerta preventivo para problema recorrente no imóvel.",
    autonomy: "medium",
    matches: (s) => num(s.payload.recurrenceCount) >= 2,
    action: (s) =>
      `Abrir alerta preventivo de manutenção: "${String(s.payload.category ?? "problema")}" reincidente (${num(s.payload.recurrenceCount)}x).`,
  },
  {
    key: "low_satisfaction_recovery",
    trigger: "low_satisfaction",
    description: "Acionar recuperação quando a satisfação cai.",
    autonomy: "high",
    matches: (s) => String(s.payload.sentiment ?? "") === "negativo" || num(s.payload.score) < 0.4,
    action: (s) =>
      `Acionar recuperação de experiência para ${s.guestName ?? "o hóspede"} — avaliar gesto de cortesia com o anfitrião.`,
  },
  {
    key: "silent_guest_checkin",
    trigger: "silent_guest",
    description: "Hóspede em estadia sem nenhuma interação — confirmar se está tudo bem.",
    autonomy: "low",
    matches: (s) => num(s.payload.hoursSinceLastMessage) >= 24,
    action: () => "Enviar um toque leve perguntando se está tudo certo na estadia.",
  },
];

export function rulesFor(trigger: ProactiveTrigger): ProactiveRule[] {
  return PROACTIVE_RULES.filter((r) => r.trigger === trigger);
}

/** Traduz autonomia em status inicial de aprovação. */
export function approvalFor(autonomy: ProactiveAutonomy): {
  status: "pending" | "approved";
  approval: "not_required" | "waiting_human";
} {
  if (autonomy === "low") return { status: "approved", approval: "not_required" };
  return { status: "pending", approval: "waiting_human" };
}
