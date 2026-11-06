/**
 * Cobrança por anúncio conectado ativo (Stripe) — regra pura, sem I/O.
 *
 * Tabela oficial (06/11/2026), preço `PRICE_LOOKUP_KEY`, modo volume, imposto incluso:
 *   1–3 anúncios → R$ 357,00 fixo (piso mínimo de 3)
 *   4–29 → R$ 119,00 / anúncio · 30–39 → R$ 99,00 · 40–49 → R$ 96,00 · 50+ → R$ 89,00
 *
 * Regras de ciclo decididas pelo titular (06/11/2026):
 *  - O ciclo é pago adiantado. Reduzir anúncios (inclusive para zero) não devolve nada.
 *  - BLINDAGEM DO ZERO: a quantidade enviada à Stripe NUNCA é 0 (a faixa fixa cobraria R$ 357).
 *    Com zero anúncios a assinatura entra em pausa de cobrança (`pause_collection: void`) e a
 *    fatura da renovação é anulada.
 *  - VENCIMENTO ÚNICO: todo cliente vence no dia 25 (00:00 de Brasília). A contratação cobra na
 *    hora o proporcional até o próximo dia 25; daí em diante, mês cheio todo dia 25.
 *  - Reativou um anúncio DEPOIS que um novo ciclo começou com a conta em zero: cobra no mesmo
 *    dia o proporcional até o próximo dia 25 (o vencimento continua no dia 25).
 *  - Reativou DENTRO do ciclo já pago: volta sem nova cobrança (até o máximo já pago no ciclo).
 *  - Aumento no meio do ciclo: cobra na hora, proporcional aos dias restantes, só o que passar
 *    do máximo já pago no ciclo (nunca cobra duas vezes o mesmo anúncio no mesmo ciclo).
 */

export const PRICE_LOOKUP_KEY = "conciergeia_connected_listings_monthly_brl_v1";
export const MIN_BILLABLE_LISTINGS = 3;

export type ListingTier = {
  /** Último anúncio da faixa (inclusive); `null` = sem limite. */
  upTo: number | null;
  /** Valor por anúncio, em centavos. */
  unitCents: number;
  /** Valor fixo da faixa, em centavos (só a faixa do piso). */
  flatCents: number;
};

export const LISTING_TIERS: readonly ListingTier[] = [
  { upTo: 3, unitCents: 0, flatCents: 35_700 },
  { upTo: 29, unitCents: 11_900, flatCents: 0 },
  { upTo: 39, unitCents: 9_900, flatCents: 0 },
  { upTo: 49, unitCents: 9_600, flatCents: 0 },
  { upTo: null, unitCents: 8_900, flatCents: 0 },
];

export function tierIndexFor(count: number): number {
  const n = Math.max(1, Math.floor(count));
  const idx = LISTING_TIERS.findIndex((t) => t.upTo == null || n <= t.upTo);
  return idx < 0 ? LISTING_TIERS.length - 1 : idx;
}

/**
 * Condição comercial negociada para uma conta (Admin SaaS). Sem condição = tabela oficial.
 *  - `unitCents`: valor fixo por anúncio (sai da tabela por faixas).
 *  - `minUnits`: piso de anúncios cobrados (padrão 3).
 *  - `courtesy`: cortesia total (100% de desconto), com cartão válido obrigatório mesmo assim.
 *  - `billingStartsAt`: início da cobrança (carência até lá; o cartão fica salvo).
 */
export type BillingTerms = {
  unitCents: number | null;
  minUnits: number | null;
  courtesy: boolean;
  billingStartsAt: string | null;
};

export const STANDARD_TERMS: BillingTerms = { unitCents: null, minUnits: null, courtesy: false, billingStartsAt: null };

export function hasCustomPricing(t: BillingTerms | null | undefined): boolean {
  return !!t && (t.unitCents != null || (t.minUnits != null && t.minUnits !== MIN_BILLABLE_LISTINGS));
}

/** Valor por anúncio da tabela oficial para quem paga `billed` anúncios (sem o piso). */
export function officialUnitCents(billed: number): number {
  const n = Math.max(1, Math.floor(billed));
  if (n <= 29) return 11_900;
  if (n <= 39) return 9_900;
  if (n <= 49) return 9_600;
  return 8_900;
}

/** Anúncios efetivamente cobrados: os ativos, nunca abaixo do piso. */
export function billedUnits(count: number, terms: BillingTerms = STANDARD_TERMS): number {
  return Math.max(Math.floor(count), Math.max(1, terms.minUnits ?? MIN_BILLABLE_LISTINGS));
}

/**
 * Valor mensal em centavos para `count` anúncios ativos. Zero anúncios = nada a cobrar.
 * Regra única: max(anúncios, piso) × valor por anúncio (tabela oficial ou valor negociado).
 * Com piso 3 e tabela oficial, é exatamente o preço vigente da Stripe (1–3 = R$ 357).
 */
export function monthlyTotalCents(count: number, terms: BillingTerms = STANDARD_TERMS): number {
  if (Math.floor(count) <= 0 || terms.courtesy) return 0;
  const billed = billedUnits(count, terms);
  return billed * displayUnitCents(count, terms);
}

/** Valor por anúncio exibido ao cliente. */
export function displayUnitCents(count: number, terms: BillingTerms = STANDARD_TERMS): number {
  if (terms.courtesy) return 0;
  if (terms.unitCents != null) return terms.unitCents;
  return officialUnitCents(billedUnits(count, terms));
}

/**
 * Faixas do preço da Stripe para uma condição (modo volume). A faixa do piso tem valor fixo e
 * valor por anúncio zero, então a Stripe nunca cobra abaixo do piso.
 */
export function stripeTiersFor(terms: BillingTerms): Array<{ up_to: number | "inf"; unit_amount: number; flat_amount?: number }> {
  const min = Math.max(1, terms.minUnits ?? MIN_BILLABLE_LISTINGS);
  if (terms.unitCents != null) {
    if (min <= 1) return [{ up_to: "inf", unit_amount: terms.unitCents }];
    return [
      { up_to: min, unit_amount: 0, flat_amount: min * terms.unitCents },
      { up_to: "inf", unit_amount: terms.unitCents },
    ];
  }
  const bands: Array<[number | "inf", number]> = [[29, 11_900], [39, 9_900], [49, 9_600], ["inf", 8_900]];
  const out: Array<{ up_to: number | "inf"; unit_amount: number; flat_amount?: number }> = [];
  if (min > 1) out.push({ up_to: min, unit_amount: 0, flat_amount: min * officialUnitCents(min) });
  for (const [upTo, unit] of bands) {
    if (upTo !== "inf" && upTo <= min) continue;
    out.push({ up_to: upTo, unit_amount: unit });
  }
  return out;
}

// ───────────────────────── Vencimento no dia 25 ─────────────────────────

/** Dia de vencimento único de todos os clientes. */
export const BILLING_ANCHOR_DAY = 25;
/** 00:00 em Brasília (UTC-3, sem horário de verão desde 2019) = 03:00 UTC. */
const ANCHOR_UTC_HOUR = 3;

/** Próximo dia 25 (00:00 de Brasília) estritamente depois de `fromSeconds`, em segundos. */
export function nextBillingAnchor(fromSeconds: number): number {
  const d = new Date(fromSeconds * 1000);
  let y = d.getUTCFullYear();
  let m = d.getUTCMonth();
  let at = Date.UTC(y, m, BILLING_ANCHOR_DAY, ANCHOR_UTC_HOUR) / 1000;
  if (at <= fromSeconds) {
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
    at = Date.UTC(y, m, BILLING_ANCHOR_DAY, ANCHOR_UTC_HOUR) / 1000;
  }
  return at;
}

/** Valor proporcional (centavos) de `fromSeconds` até o fim do período, sobre o valor mensal. */
export function proratedCents(monthlyCents: number, fromSeconds: number, periodStart: number, periodEnd: number): number {
  const total = periodEnd - periodStart;
  if (monthlyCents <= 0 || total <= 0 || fromSeconds >= periodEnd) return 0;
  const left = periodEnd - Math.max(fromSeconds, periodStart);
  return Math.round((monthlyCents * left) / total);
}

// ───────────────────────── Decisão de sincronização ─────────────────────────

export type BillingSubscriptionState = {
  status: string;
  /** Quantidade atual no item da Stripe (nunca 0, por construção). */
  quantity: number;
  /** `pause_collection` ativo. */
  paused: boolean;
  /** Quando a conta foi a zero (epoch em segundos), gravado nos metadados ao pausar. */
  zeroSince: number | null;
  /** Início e fim do período atual (epoch em segundos; o fim é sempre um dia 25). */
  periodStart: number;
  periodEnd: number;
  /** Maior quantidade já paga no período atual (normalizada pelo chamador). */
  cycleMaxPaid: number;
};

export type StripeUpdateStep = {
  quantity?: number;
  prorationBehavior?: "none" | "always_invoice";
  /** `true` pausa (void), `false` retoma. */
  pause?: boolean;
  metadata?: Record<string, string>;
};

/** Cobrança avulsa imediata (reativação após ciclo não pago): proporcional até o próximo dia 25. */
export type ProratedCharge = {
  amountCents: number;
  periodStart: number;
  periodEnd: number;
  description: string;
};

export type BillingDecision = {
  kind:
    | "noop"
    | "pause_zero"
    | "update_same_cycle"
    | "resume_same_cycle"
    | "resume_charge_prorated_to_anchor";
  reason: string;
  steps: StripeUpdateStep[];
  charge?: ProratedCharge;
};

const INACTIVE = new Set(["canceled", "incomplete_expired", "incomplete"]);

/**
 * Steps para levar a quantidade de `current` para `target` dentro do ciclo, cobrando
 * proporcionalmente só o que passar de `cycleMaxPaid`.
 */
function sameCycleSteps(
  current: number,
  target: number,
  cycleMaxPaid: number,
  periodStart: number,
): StripeUpdateStep[] {
  const steps: StripeUpdateStep[] = [];
  const paid = Math.max(cycleMaxPaid, 1);
  // O máximo pago no ciclo fica gravado na Stripe: uma redução seguida de novo aumento no mesmo
  // ciclo não pode cobrar de novo o que já foi pago.
  const cycleMeta = { cycle_start: String(periodStart), cycle_max_qty: String(Math.max(paid, target)) };
  if (target <= paid) {
    if (target !== current) steps.push({ quantity: target, prorationBehavior: "none", metadata: cycleMeta });
    return steps;
  }
  // Acima do já pago: primeiro sobe (sem cobrança) até o já pago, depois cobra só a diferença.
  if (current !== paid) steps.push({ quantity: paid, prorationBehavior: "none" });
  steps.push({ quantity: target, prorationBehavior: "always_invoice", metadata: cycleMeta });
  return steps;
}

export function decideBillingAction(
  activeListings: number,
  s: BillingSubscriptionState,
  nowSeconds: number,
  terms: BillingTerms = STANDARD_TERMS,
): BillingDecision {
  const count = Math.max(0, Math.floor(activeListings));
  if (INACTIVE.has(s.status)) {
    return { kind: "noop", reason: `assinatura ${s.status}`, steps: [] };
  }

  if (count === 0) {
    if (s.paused) return { kind: "noop", reason: "zero anúncios, já pausada", steps: [] };
    return {
      kind: "pause_zero",
      reason: "zero anúncios: pausa a cobrança (nunca envia quantidade 0)",
      steps: [
        {
          pause: true,
          metadata: {
            zero_since: String(nowSeconds),
            cycle_start: String(s.periodStart),
            cycle_max_qty: String(Math.max(s.cycleMaxPaid, s.quantity)),
          },
        },
      ],
    };
  }

  if (s.paused) {
    const newCycleStarted = s.zeroSince != null && s.periodStart > s.zeroSince;
    if (newCycleStarted) {
      const monthly = monthlyTotalCents(count, terms);
      const amount = proratedCents(monthly, nowSeconds, s.periodStart, s.periodEnd);
      const fmt = (sec: number) => {
        const d = new Date((sec - 3 * 3600) * 1000);
        return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      };
      return {
        kind: "resume_charge_prorated_to_anchor",
        reason: "reativou após um ciclo não pago: cobra hoje o proporcional até o próximo dia 25",
        steps: [
          {
            pause: false,
            quantity: count,
            prorationBehavior: "none",
            metadata: { zero_since: "", cycle_start: String(s.periodStart), cycle_max_qty: String(count) },
          },
        ],
        charge:
          amount > 0
            ? {
                amountCents: amount,
                periodStart: nowSeconds,
                periodEnd: s.periodEnd,
                description: `Proporcional de ${fmt(nowSeconds)} a ${fmt(s.periodEnd)} · ${count} anúncio(s)`,
              }
            : undefined,
      };
    }
    const steps = sameCycleSteps(s.quantity, count, s.cycleMaxPaid, s.periodStart);
    steps.unshift({ pause: false, metadata: { zero_since: "" } });
    return { kind: "resume_same_cycle", reason: "reativou dentro do ciclo já pago", steps };
  }

  if (s.status === "trialing") {
    // Carência: só acompanha a quantidade, nunca cobra proporcional.
    if (count === s.quantity) return { kind: "noop", reason: "quantidade já correta (carência)", steps: [] };
    return { kind: "update_same_cycle", reason: "ajuste durante a carência", steps: [{ quantity: count, prorationBehavior: "none" }] };
  }
  const steps = sameCycleSteps(s.quantity, count, s.cycleMaxPaid, s.periodStart);
  if (!steps.length) return { kind: "noop", reason: "quantidade já correta", steps };
  return {
    kind: "update_same_cycle",
    reason: count > s.cycleMaxPaid ? "aumento acima do já pago: cobra proporcional hoje" : "ajuste sem cobrança",
    steps,
  };
}

/**
 * Normaliza o máximo pago no ciclo a partir dos metadados: se o ciclo gravado não é o atual,
 * a renovação acabou de cobrar a quantidade atual.
 */
export function cycleMaxFromMetadata(
  metadata: Record<string, string | undefined> | null | undefined,
  periodStart: number,
  quantity: number,
): number {
  const start = Number(metadata?.cycle_start ?? "");
  const max = Number(metadata?.cycle_max_qty ?? "");
  if (start === periodStart && Number.isFinite(max) && max > 0) return Math.max(max, quantity);
  return quantity;
}
