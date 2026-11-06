/**
 * Condição comercial por conta (Admin SaaS): valor por anúncio, piso, cortesia e carência.
 *
 * Guardada em `billing_terms` (uma linha por conta; sem linha = tabela oficial). Vale antes de a
 * conta assinar (o checkout já nasce com ela) e depois (a assinatura é ajustada aqui).
 *
 * Mapeamento na Stripe:
 *  - valor/piso diferentes da tabela oficial → um preço próprio da conta, modo volume, com a faixa
 *    do piso em valor fixo (`stripeTiersFor`), aplicado a partir do próximo dia 25 (sem proporcional);
 *  - cortesia total → cupom de 100% sem prazo (o cartão continua obrigatório);
 *  - carência → `trial_end` num dia 25 (o vencimento de todos os clientes é o dia 25).
 */
import {
  hasCustomPricing,
  nextBillingAnchor,
  PRICE_LOOKUP_KEY,
  STANDARD_TERMS,
  stripeTiersFor,
  type BillingTerms,
} from "@/lib/billing/listing-billing";
import {
  getListingPrice,
  stripeRequest,
  subscriptionItem,
  type StripeSubscription,
} from "@/lib/billing/stripe.server";

export const COURTESY_COUPON_ID = "conciergeia_cortesia_100";

export async function loadBillingTerms(db: any, ownerId: string): Promise<BillingTerms> {
  const { data, error } = await db
    .from("billing_terms")
    .select("unit_cents, min_units, courtesy, billing_starts_at")
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw new Error(`Falha ao ler a condição comercial: ${error.message}`);
  if (!data) return STANDARD_TERMS;
  return {
    unitCents: data.unit_cents ?? null,
    minUnits: data.min_units ?? null,
    courtesy: !!data.courtesy,
    billingStartsAt: data.billing_starts_at ?? null,
  };
}

/** Preço da Stripe que a condição exige (o oficial, ou um da própria conta). */
export async function priceIdForTerms(ownerId: string, terms: BillingTerms): Promise<string> {
  const official = await getListingPrice();
  if (!hasCustomPricing(terms)) return official.id;
  const min = terms.minUnits ?? 3;
  const lookup = `${PRICE_LOOKUP_KEY}__conta_${ownerId.replace(/-/g, "").slice(0, 12)}_${terms.unitCents ?? "tabela"}_${min}`;
  const found = await stripeRequest<{ data: Array<{ id: string }> }>("GET", "/prices", {
    lookup_keys: [lookup],
    active: true,
    limit: 1,
  });
  if (found.data[0]) return found.data[0].id;
  const created = await stripeRequest<{ id: string }>(
    "POST",
    "/prices",
    {
      product: official.productId,
      currency: "brl",
      nickname: `Condição negociada · ${terms.unitCents != null ? `R$ ${(terms.unitCents / 100).toFixed(2)}/anúncio` : "tabela oficial"} · piso ${min}`,
      lookup_key: lookup,
      tax_behavior: "inclusive",
      recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
      billing_scheme: "tiered",
      tiers_mode: "volume",
      tiers: stripeTiersFor(terms),
      metadata: { app: "conciergeia", billing_model: "connected_listings", user_id: ownerId, custom_terms: "1" },
    },
    { idempotencyKey: `terms-price:${lookup}` },
  );
  return created.id;
}

export async function ensureCourtesyCoupon(): Promise<string> {
  try {
    await stripeRequest("GET", `/coupons/${COURTESY_COUPON_ID}`);
  } catch {
    await stripeRequest(
      "POST",
      "/coupons",
      { id: COURTESY_COUPON_ID, percent_off: 100, duration: "forever", name: "Cortesia total ConciergeIA", metadata: { app: "conciergeia" } },
      { idempotencyKey: `coupon:${COURTESY_COUPON_ID}` },
    );
  }
  return COURTESY_COUPON_ID;
}

/** Fim da carência em segundos: sempre um dia 25 (a data escolhida já é um dia 25). */
export function courtesyEndSeconds(terms: BillingTerms, nowSeconds: number): number | null {
  if (!terms.billingStartsAt) return null;
  const at = Math.floor(Date.parse(terms.billingStartsAt) / 1000);
  if (!Number.isFinite(at) || at <= nowSeconds) return null;
  // Normaliza para o dia 25 (00:00 de Brasília) do mês escolhido ou seguinte.
  return nextBillingAnchor(at - 1);
}

function hasCourtesyDiscount(sub: any): boolean {
  const list = (sub.discounts ?? []) as any[];
  return list.some((d) => (typeof d === "string" ? false : d?.coupon?.id === COURTESY_COUPON_ID || d?.source?.coupon === COURTESY_COUPON_ID));
}

/**
 * Leva a assinatura para a condição vigente: preço da condição, cortesia e carência.
 * Seguro para repetir (só envia o que difere). Devolve o estado atualizado.
 */
export async function applyTermsToSubscription(sub: StripeSubscription, terms: BillingTerms): Promise<StripeSubscription> {
  if (["canceled", "incomplete_expired"].includes(sub.status)) return sub;
  const ownerId = sub.metadata?.user_id;
  if (!ownerId) return sub;
  const item = subscriptionItem(sub);
  const now = Math.floor(Date.now() / 1000);
  const params: Record<string, any> = {};

  const wantPrice = await priceIdForTerms(ownerId, terms);
  if (item.price.id !== wantPrice) {
    params.items = [{ id: item.id, price: wantPrice, quantity: item.quantity }];
    params.proration_behavior = "none"; // vale a partir do próximo dia 25
  }

  const fresh = await stripeRequest<any>("GET", `/subscriptions/${encodeURIComponent(sub.id)}`, { expand: ["discounts"] });
  const courtesyOn = hasCourtesyDiscount(fresh);
  if (terms.courtesy && !courtesyOn) params.discounts = [{ coupon: await ensureCourtesyCoupon() }];
  if (!terms.courtesy && courtesyOn) params.discounts = "";

  const trialEnd = courtesyEndSeconds(terms, now);
  const currentTrialEnd = (fresh.trial_end as number | null) ?? null;
  if (trialEnd && currentTrialEnd !== trialEnd) {
    params.trial_end = trialEnd;
    params.proration_behavior = "none";
  } else if (!trialEnd && sub.status === "trialing" && currentTrialEnd && currentTrialEnd > now) {
    // Carência retirada: termina no próximo dia 25, para o vencimento continuar no dia 25.
    const next = nextBillingAnchor(now);
    if (currentTrialEnd !== next) {
      params.trial_end = next;
      params.proration_behavior = "none";
    }
  }

  if (!Object.keys(params).length) return sub;
  const key = `terms:${sub.id}:${wantPrice}:${terms.courtesy ? 1 : 0}:${params.trial_end ?? "-"}`;
  return stripeRequest<StripeSubscription>("POST", `/subscriptions/${encodeURIComponent(sub.id)}`, params, {
    idempotencyKey: key,
  });
}
