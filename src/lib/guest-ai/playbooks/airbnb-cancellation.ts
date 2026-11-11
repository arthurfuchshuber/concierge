/**
 * PLAYBOOK · MODALIDADES DE CANCELAMENTO DO AIRBNB (titular, 10/11/2026).
 * Fonte: Central de Ajuda do Airbnb, artigo 475 ("Políticas de cancelamento para anfitriões"), lido em 10/11/2026.
 *
 * Serve a duas coisas:
 *  1. `freeCancellationStatus`: o SISTEMA (nunca o modelo) calcula, para a reserva do turno, se o prazo de
 *     cancelamento SEM CUSTO está aberto, encerrado ou é desconhecido. Regras do titular: alteração de datas,
 *     redução de período e cancelamento sem ônus nunca são possíveis com o prazo encerrado; a modalidade NUNCA é
 *     presumida — sem certeza ⇒ `unknown`.
 *  2. `CANCELLATION_PLAYBOOK_TEXT`: resumo das modalidades para o roteiro (a IA explica a regra, não decide).
 * Puro: sem banco, rede ou relógio (o instante chega por parâmetro).
 */

export type CancellationPolicyKey =
  | "flexible"
  | "moderate"
  | "limited"
  | "firm"
  | "strict"
  | "super_strict_30"
  | "super_strict_60"
  | "non_refundable"
  | "long_term_firm"
  | "long_term_strict";

interface PolicySpec {
  label: string;
  /** Reembolso integral até N horas antes do check-in; `null` = não há prazo além da janela após a confirmação. */
  fullRefundHoursBeforeCheckin: number | null;
  /** Janela de cancelamento gratuito após a confirmação (horas) e antecedência mínima da reserva (dias). */
  graceHours: number;
  graceMinDaysBeforeCheckin: number;
}

const DAY = 24;
/** Estadias curtas (< 28 noites): 24 h grátis após a confirmação se a reserva foi feita ≥ 7 dias antes do check-in. */
export const CANCELLATION_POLICIES: Record<CancellationPolicyKey, PolicySpec> = {
  flexible: { label: "Flexível", fullRefundHoursBeforeCheckin: 24, graceHours: 24, graceMinDaysBeforeCheckin: 7 },
  moderate: { label: "Moderada", fullRefundHoursBeforeCheckin: 5 * DAY, graceHours: 24, graceMinDaysBeforeCheckin: 7 },
  limited: { label: "Limitada", fullRefundHoursBeforeCheckin: 14 * DAY, graceHours: 24, graceMinDaysBeforeCheckin: 7 },
  firm: { label: "Restrita", fullRefundHoursBeforeCheckin: 30 * DAY, graceHours: 24, graceMinDaysBeforeCheckin: 7 },
  strict: { label: "Rigorosa", fullRefundHoursBeforeCheckin: null, graceHours: 24, graceMinDaysBeforeCheckin: 7 },
  super_strict_30: { label: "Super Rigorosa de 30 dias", fullRefundHoursBeforeCheckin: null, graceHours: 24, graceMinDaysBeforeCheckin: 7 },
  super_strict_60: { label: "Super Rigorosa de 60 dias", fullRefundHoursBeforeCheckin: null, graceHours: 24, graceMinDaysBeforeCheckin: 7 },
  non_refundable: { label: "Não reembolsável", fullRefundHoursBeforeCheckin: null, graceHours: 24, graceMinDaysBeforeCheckin: 7 },
  // Estadias longas (≥ 28 noites)
  long_term_firm: { label: "Restrita (estadia longa)", fullRefundHoursBeforeCheckin: 30 * DAY, graceHours: 0, graceMinDaysBeforeCheckin: 0 },
  long_term_strict: { label: "Rigorosa (estadia longa)", fullRefundHoursBeforeCheckin: null, graceHours: 48, graceMinDaysBeforeCheckin: 28 },
};

export const LONG_STAY_MIN_NIGHTS = 28;

/**
 * Categoria gravada na reserva (Channex/Airbnb) ⇒ modalidade. Só valores reconhecidos com certeza; qualquer
 * outro (ou vazio) ⇒ `null` (desconhecida, nunca presumida).
 */
export function resolveCancellationPolicy(
  category: string | null | undefined,
  isNonRefundable: boolean | null | undefined,
  nights: number | null,
): CancellationPolicyKey | null {
  const c = (category ?? "").trim().toLowerCase();
  if (isNonRefundable === true || /non_?refundable/.test(c)) return "non_refundable";
  if (!c) return null;
  const long = nights !== null && nights >= LONG_STAY_MIN_NIGHTS;
  if (long) {
    if (/^(firm|long_term|long_term_firm|firm_long_term)$/.test(c)) return "long_term_firm";
    if (/^(strict|strict_long_term|long_term_strict)$/.test(c)) return "long_term_strict";
    return null;
  }
  if (c === "flexible") return "flexible";
  if (c === "moderate") return "moderate";
  if (c === "limited") return "limited";
  if (c === "firm") return "firm";
  if (c === "strict" || c === "strict_14_with_grace_period") return "strict";
  if (c === "super_strict_30") return "super_strict_30";
  if (c === "super_strict_60") return "super_strict_60";
  return null;
}

export interface FreeCancellationInput {
  category: string | null;
  isNonRefundable: boolean | null;
  /** Instante do check-in oficial (data da reserva + horário do imóvel, no fuso do imóvel). */
  checkInAt: Date | null;
  nights: number | null;
  /** Quando a reserva foi confirmada (melhor dado disponível); `null` ⇒ a janela pós-confirmação não é considerada. */
  bookedAt: Date | null;
  now: Date;
}

export interface FreeCancellationStatus {
  /** `open` = ainda dá para cancelar sem custo; `closed` = prazo encerrado; `unknown` = não dá para afirmar. */
  status: "open" | "closed" | "unknown";
  /** Fim do prazo sem custo (só com `open`). */
  until: Date | null;
  policy: CancellationPolicyKey | null;
  policyLabel: string | null;
}

const HOUR_MS = 3_600_000;

export function freeCancellationStatus(i: FreeCancellationInput): FreeCancellationStatus {
  const policy = resolveCancellationPolicy(i.category, i.isNonRefundable, i.nights);
  const unknown: FreeCancellationStatus = { status: "unknown", until: null, policy, policyLabel: policy ? CANCELLATION_POLICIES[policy].label : null };
  if (!policy || !i.checkInAt || Number.isNaN(i.checkInAt.getTime()) || Number.isNaN(i.now.getTime())) return unknown;
  const spec = CANCELLATION_POLICIES[policy];
  const checkIn = i.checkInAt.getTime();
  const now = i.now.getTime();
  let until: number | null = spec.fullRefundHoursBeforeCheckin !== null ? checkIn - spec.fullRefundHoursBeforeCheckin * HOUR_MS : null;
  if (spec.graceHours > 0 && i.bookedAt && !Number.isNaN(i.bookedAt.getTime())) {
    const booked = i.bookedAt.getTime();
    if (booked <= checkIn - spec.graceMinDaysBeforeCheckin * DAY * HOUR_MS) {
      const graceEnd = Math.min(booked + spec.graceHours * HOUR_MS, checkIn);
      until = until === null ? graceEnd : Math.max(until, graceEnd);
    }
  }
  const base = { policy, policyLabel: spec.label };
  if (until !== null && now < until && now < checkIn) return { status: "open", until: new Date(until), ...base };
  return { status: "closed", until: null, ...base };
}

/** Resumo das modalidades para o roteiro (fonte: Airbnb, artigo 475, 10/11/2026). */
export const CANCELLATION_PLAYBOOK_TEXT =
  "Modalidades de cancelamento do Airbnb (referência; a modalidade e o prazo DESTA reserva vêm só do fato ctx:cancelamento_sem_custo, nunca presuma): " +
  "Flexível = reembolso integral até 24 horas antes do check-in. Moderada = até 5 dias antes. Limitada = até 14 dias antes. " +
  "Restrita = até 30 dias antes. Rigorosa e Super Rigorosa (30 ou 60 dias) = sem reembolso integral, só parcial conforme a antecedência. " +
  "Não reembolsável = tarifa com desconto escolhida pelo hóspede, sem reembolso. " +
  "Nas estadias de menos de 28 noites há ainda cancelamento gratuito nas primeiras 24 horas após a confirmação, se a reserva foi feita com pelo menos 7 dias de antecedência. " +
  "Estadias de 28 noites ou mais seguem a Restrita (integral até 30 dias antes) ou a Rigorosa de longa duração (integral só em até 48 horas da confirmação e com pelo menos 28 dias de antecedência). " +
  "Depois do check-in não há cancelamento sem custo. Exceções por grandes eventos ou problemas cobertos pelo Airbnb são decididas pela plataforma, nunca por você.";
