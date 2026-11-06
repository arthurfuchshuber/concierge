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
 *  - Reativou um anúncio DEPOIS que um novo ciclo começou com a conta em zero: cobra no mesmo
 *    dia, e esse dia vira o início do novo ciclo (`billing_cycle_anchor: now`).
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

/** Valor mensal em centavos para `count` anúncios ativos. Zero anúncios = nada a cobrar. */
export function monthlyTotalCents(count: number): number {
  const n = Math.floor(count);
  if (n <= 0) return 0;
  const t = LISTING_TIERS[tierIndexFor(n)];
  return t.flatCents + t.unitCents * n;
}

/** Valor por anúncio exibido ao cliente (na faixa do piso, o piso dividido por 3). */
export function displayUnitCents(count: number): number {
  const t = LISTING_TIERS[tierIndexFor(count)];
  return t.flatCents ? Math.round(t.flatCents / MIN_BILLABLE_LISTINGS) : t.unitCents;
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
  /** Início do período atual (epoch em segundos). */
  periodStart: number;
  /** Maior quantidade já paga no período atual (normalizada pelo chamador). */
  cycleMaxPaid: number;
};

export type StripeUpdateStep = {
  quantity?: number;
  prorationBehavior?: "none" | "always_invoice";
  /** `true` pausa (void), `false` retoma. */
  pause?: boolean;
  billingCycleAnchorNow?: boolean;
  metadata?: Record<string, string>;
};

export type BillingDecision = {
  kind:
    | "noop"
    | "pause_zero"
    | "update_same_cycle"
    | "resume_same_cycle"
    | "resume_new_cycle_charge_today";
  reason: string;
  steps: StripeUpdateStep[];
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
      return {
        kind: "resume_new_cycle_charge_today",
        reason: "reativou após o início de um ciclo não pago: cobra hoje e reinicia o ciclo",
        steps: [
          {
            pause: false,
            quantity: count,
            billingCycleAnchorNow: true,
            prorationBehavior: "none",
            metadata: { zero_since: "", cycle_max_qty: String(count), cycle_start: "" },
          },
        ],
      };
    }
    const steps = sameCycleSteps(s.quantity, count, s.cycleMaxPaid, s.periodStart);
    steps.unshift({ pause: false, metadata: { zero_since: "" } });
    return { kind: "resume_same_cycle", reason: "reativou dentro do ciclo já pago", steps };
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
