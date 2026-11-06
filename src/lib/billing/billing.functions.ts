/**
 * Funções de servidor da assinatura (Stripe, cobrança por anúncio conectado ativo).
 *
 * Toda ação resolve a conta pelo `resolveAuthorizedAccountOwnerId` (titular, membro ativo ou admin
 * SaaS). Contratar e gerenciar o cartão são ações do titular (ou admin SaaS), nunca de membro.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PlanFeatures } from "@/lib/billing/plan";

export type BillingSubscription = {
  id: string;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  billingPaused: boolean;
  listingQuantity: number | null;
  isManual: boolean;
  /** Assinatura com cobrança real na Stripe (liberação manual = false). */
  hasStripeBilling: boolean;
  trialEndsAt: string | null;
  customPriceCents: number | null;
  maxGuidesOverride: number | null;
  adminNotes: string | null;
  environment: string;
  createdAt: string;
};

export type PaymentRow = {
  id: string;
  /** paid | failed | open */
  status: string;
  createdAt: string;
  /** Centavos. */
  amount: number;
  currency: string;
  invoiceUrl: string | null;
};

export type PaymentMethodSummary = {
  type: string;
  brand: string | null;
  last4: string | null;
  expiryMonth: number | null;
  expiryYear: number | null;
  cardholderName: string | null;
};

const OwnerInput = z.object({ ownerId: z.string().uuid().nullish() }).optional();

const SUB_COLUMNS =
  "id, status, current_period_start, current_period_end, cancel_at_period_end, billing_paused, listing_quantity, is_manual, stripe_subscription_id, trial_ends_at, custom_price_cents, max_guides_override, admin_notes, environment, created_at";

function toBillingSubscription(r: any): BillingSubscription {
  return {
    id: r.id,
    status: r.status,
    currentPeriodStart: r.current_period_start ?? null,
    currentPeriodEnd: r.current_period_end ?? null,
    cancelAtPeriodEnd: !!r.cancel_at_period_end,
    billingPaused: !!r.billing_paused,
    listingQuantity: r.listing_quantity ?? null,
    isManual: !!r.is_manual,
    hasStripeBilling: !!r.stripe_subscription_id,
    trialEndsAt: r.trial_ends_at ?? null,
    customPriceCents: r.custom_price_cents ?? null,
    maxGuidesOverride: r.max_guides_override ?? null,
    adminNotes: r.admin_notes ?? null,
    environment: r.environment,
    createdAt: r.created_at,
  };
}

async function ownerFor(context: any, ownerId?: string | null): Promise<string> {
  const { resolveAuthorizedAccountOwnerId } = await import("@/lib/account-scope.server");
  return resolveAuthorizedAccountOwnerId(context.supabase, context.userId, ownerId ?? null);
}

async function assertTitularOrAdmin(context: any, ownerId: string): Promise<void> {
  if (ownerId === context.userId) return;
  const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (!isAdmin) throw new Error("Apenas o titular da conta pode gerenciar a assinatura.");
}

/** Assinatura efetiva da conta + o que ela libera. */
export const getAccountBilling = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ownerId?: string | null } | undefined) => OwnerInput.parse(d))
  .handler(async ({ data, context }) => {
    const ownerId = await ownerFor(context, data?.ownerId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resolveOwnerPlanAdmin } = await import("@/lib/plan-guard.server");
    const [{ data: rows, error }, plan] = await Promise.all([
      (supabaseAdmin as any)
        .from("subscriptions")
        .select(SUB_COLUMNS)
        .eq("user_id", ownerId)
        .order("created_at", { ascending: false }),
      resolveOwnerPlanAdmin(supabaseAdmin as never, ownerId),
    ]);
    if (error) throw new Error("Não foi possível carregar a assinatura da conta.");
    const { stripeEnvOrNull } = await import("@/lib/billing/stripe.server");
    const env = stripeEnvOrNull();
    const list = (rows ?? []) as any[];
    const match = list.find((r) => r.environment === env && r.stripe_subscription_id) ?? list.find((r) => r.is_manual) ?? list[0] ?? null;
    return {
      ownerId,
      subscription: match ? toBillingSubscription(match) : null,
      hasAccess: plan.hasAccess,
      status: plan.status,
      maxGuides: plan.maxGuides,
      features: plan.features as PlanFeatures,
    };
  });

/** Garante um cliente na Stripe para a conta (reaproveita o existente; leva CPF/CNPJ e e-mail). */
async function ensureStripeCustomer(ownerId: string): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { stripeRequest, stripeEnv } = await import("@/lib/billing/stripe.server");
  const db = supabaseAdmin as any;
  const { data: prev } = await db
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", ownerId)
    .eq("environment", stripeEnv())
    .not("stripe_customer_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (prev?.stripe_customer_id) return prev.stripe_customer_id as string;

  const found = await stripeRequest<{ data: Array<{ id: string }> }>("GET", "/customers/search", {
    query: `metadata['user_id']:'${ownerId}'`,
    limit: 1,
  }).catch(() => ({ data: [] as Array<{ id: string }> }));
  if (found.data[0]) return found.data[0].id;

  const [{ data: profile }, { data: authUser }] = await Promise.all([
    db.from("profiles").select("full_name, cpf, phone").eq("id", ownerId).maybeSingle(),
    db.auth.admin.getUserById(ownerId),
  ]);
  const doc = String(profile?.cpf ?? "").replace(/\D/g, "");
  const taxId =
    doc.length === 11
      ? { type: "br_cpf", value: doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") }
      : doc.length === 14
        ? { type: "br_cnpj", value: doc.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5") }
        : null;
  const created = await stripeRequest<{ id: string }>(
    "POST",
    "/customers",
    {
      email: authUser?.user?.email ?? undefined,
      name: profile?.full_name ?? undefined,
      preferred_locales: ["pt-BR"],
      metadata: { user_id: ownerId, app: "conciergeia" },
      ...(taxId ? { tax_id_data: [taxId] } : {}),
    },
    { idempotencyKey: `customer:${ownerId}` },
  );
  return created.id;
}

function originUrl(path: string): Promise<string> {
  return import("@tanstack/react-start/server").then(({ getRequest }) => {
    const origin = new URL(getRequest().url).origin;
    return new URL(path, origin).toString();
  });
}

/**
 * Abre o checkout da Stripe (página hospedada). Quantidade = anúncios ativos (mínimo 1; o piso
 * de R$ 357 já está na tabela). Após o pagamento, o webhook grava a assinatura e a fila acerta a
 * quantidade com a contagem real.
 */
export const createCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ownerId?: string | null; returnPath?: string } | undefined) =>
    z
      .object({
        ownerId: z.string().uuid().nullish(),
        returnPath: z.string().regex(/^\/[A-Za-z0-9/_\-?=&.]*$/).max(200).optional(),
      })
      .optional()
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const ownerId = await ownerFor(context, data?.ownerId);
    await assertTitularOrAdmin(context, ownerId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { stripeRequest, stripeEnv, getListingPrice } = await import("@/lib/billing/stripe.server");
    const { loadConnectedListings } = await import("@/lib/billing/connected-listings.server");

    const { data: live } = await (supabaseAdmin as any)
      .from("subscriptions")
      .select("id")
      .eq("user_id", ownerId)
      .eq("environment", stripeEnv())
      .not("stripe_subscription_id", "is", null)
      .in("status", ["active", "past_due", "trialing", "unpaid"])
      .limit(1);
    if ((live ?? []).length) throw new Error("A conta já tem uma assinatura ativa. Gerencie pelo botão de cartão.");

    const [price, customer, listings] = await Promise.all([
      getListingPrice(),
      ensureStripeCustomer(ownerId),
      loadConnectedListings(supabaseAdmin, ownerId),
    ]);
    const back = data?.returnPath ?? "/admin/assinatura";
    const sep = back.includes("?") ? "&" : "?";
    const session = await stripeRequest<{ url: string }>("POST", "/checkout/sessions", {
      mode: "subscription",
      customer,
      client_reference_id: ownerId,
      locale: "pt-BR",
      line_items: [{ price: price.id, quantity: Math.max(1, listings.length) }],
      subscription_data: { metadata: { user_id: ownerId, app: "conciergeia" } },
      metadata: { user_id: ownerId },
      success_url: await originUrl(`${back}${sep}checkout=success`),
      cancel_url: await originUrl(`${back}${sep}checkout=canceled`),
    });
    const { auditBilling } = await import("@/lib/audit/platform.server");
    await auditBilling("checkout_opened", {
      userId: ownerId,
      description: `Checkout aberto com ${listings.length} anúncio(s) ativo(s).`,
      metadata: { activeListings: listings.length },
    });
    return { url: session.url };
  });

let portalConfigCache: string | null = null;

/**
 * Configuração do portal do cliente: só cartão, dados de cobrança e faturas. A quantidade é
 * controlada pelo sistema (anúncios ativos) e nunca pelo portal.
 */
async function portalConfigurationId(): Promise<string> {
  if (portalConfigCache) return portalConfigCache;
  const { stripeRequest } = await import("@/lib/billing/stripe.server");
  const list = await stripeRequest<{ data: Array<{ id: string; active: boolean; metadata: Record<string, string> }> }>(
    "GET",
    "/billing_portal/configurations",
    { active: true, limit: 100 },
  );
  const mine = list.data.find((c) => c.metadata?.app === "conciergeia");
  if (mine) return (portalConfigCache = mine.id);
  const created = await stripeRequest<{ id: string }>(
    "POST",
    "/billing_portal/configurations",
    {
      business_profile: { headline: "ConciergeIA — Assinatura por Anúncio" },
      features: {
        customer_update: { enabled: true, allowed_updates: ["email", "address", "tax_id"] },
        invoice_history: { enabled: true },
        payment_method_update: { enabled: true },
        subscription_cancel: { enabled: false },
        subscription_update: { enabled: false },
      },
      metadata: { app: "conciergeia" },
    },
    { idempotencyKey: "portal-config:conciergeia:v1" },
  );
  return (portalConfigCache = created.id);
}

/** Portal da Stripe para trocar cartão e baixar faturas. */
export const createPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ownerId?: string | null; returnPath?: string } | undefined) =>
    z
      .object({
        ownerId: z.string().uuid().nullish(),
        returnPath: z.string().regex(/^\/[A-Za-z0-9/_\-?=&.]*$/).max(200).optional(),
      })
      .optional()
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const ownerId = await ownerFor(context, data?.ownerId);
    await assertTitularOrAdmin(context, ownerId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { stripeRequest, stripeEnv } = await import("@/lib/billing/stripe.server");
    const { data: sub } = await (supabaseAdmin as any)
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", ownerId)
      .eq("environment", stripeEnv())
      .not("stripe_customer_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!sub?.stripe_customer_id) {
      throw new Error("Esta conta não tem cobrança recorrente ativa — não há cartão a gerenciar.");
    }
    const session = await stripeRequest<{ url: string }>("POST", "/billing_portal/sessions", {
      customer: sub.stripe_customer_id,
      configuration: await portalConfigurationId(),
      locale: "pt-BR",
      return_url: await originUrl(data?.returnPath ?? "/admin/assinatura"),
    });
    return { url: session.url };
  });

async function customerOf(ownerId: string): Promise<{ customer: string | null; subscription: string | null }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { stripeEnvOrNull } = await import("@/lib/billing/stripe.server");
  const env = stripeEnvOrNull();
  if (!env) return { customer: null, subscription: null };
  const { data } = await (supabaseAdmin as any)
    .from("subscriptions")
    .select("stripe_customer_id, stripe_subscription_id")
    .eq("user_id", ownerId)
    .eq("environment", env)
    .not("stripe_customer_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { customer: data?.stripe_customer_id ?? null, subscription: data?.stripe_subscription_id ?? null };
}

/** Extrato da conta: faturas da Stripe (anuladas por pausa de cobrança ficam de fora). */
export const listMyPayments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ownerId?: string | null } | undefined) => OwnerInput.parse(d))
  .handler(async ({ data, context }): Promise<{ payments: PaymentRow[] }> => {
    const ownerId = await ownerFor(context, data?.ownerId);
    const { customer } = await customerOf(ownerId);
    if (!customer) return { payments: [] };
    const { stripeRequest } = await import("@/lib/billing/stripe.server");
    try {
      const list = await stripeRequest<{ data: any[] }>("GET", "/invoices", { customer, limit: 24 });
      const payments: PaymentRow[] = list.data
        .filter((inv) => inv.status !== "void" && inv.status !== "draft" && inv.total > 0)
        .map((inv) => ({
          id: inv.id,
          status: inv.status === "paid" ? "paid" : inv.status === "open" && inv.attempt_count > 0 ? "failed" : inv.status,
          createdAt: new Date((inv.status_transitions?.finalized_at ?? inv.created) * 1000).toISOString(),
          amount: inv.status === "paid" ? inv.amount_paid : inv.amount_due,
          currency: String(inv.currency ?? "brl").toUpperCase(),
          invoiceUrl: inv.hosted_invoice_url ?? null,
        }));
      return { payments };
    } catch {
      return { payments: [] };
    }
  });

/** Cartão em uso na assinatura (só bandeira, final e validade). */
export const getAccountPaymentMethod = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ownerId?: string | null } | undefined) => OwnerInput.parse(d))
  .handler(async ({ data, context }): Promise<{ paymentMethod: PaymentMethodSummary | null }> => {
    const ownerId = await ownerFor(context, data?.ownerId);
    const { customer, subscription } = await customerOf(ownerId);
    if (!customer) return { paymentMethod: null };
    const { stripeRequest } = await import("@/lib/billing/stripe.server");
    try {
      let pm: any = null;
      if (subscription) {
        const sub = await stripeRequest<any>("GET", `/subscriptions/${encodeURIComponent(subscription)}`, {
          expand: ["default_payment_method"],
        });
        pm = sub.default_payment_method;
      }
      if (!pm) {
        const cus = await stripeRequest<any>("GET", `/customers/${encodeURIComponent(customer)}`, {
          expand: ["invoice_settings.default_payment_method"],
        });
        pm = cus.invoice_settings?.default_payment_method;
      }
      if (!pm || typeof pm === "string") return { paymentMethod: null };
      return {
        paymentMethod: {
          type: pm.type ?? "card",
          brand: pm.card?.brand ?? null,
          last4: pm.card?.last4 ?? null,
          expiryMonth: pm.card?.exp_month ?? null,
          expiryYear: pm.card?.exp_year ?? null,
          cardholderName: pm.billing_details?.name ?? null,
        },
      };
    } catch {
      return { paymentMethod: null };
    }
  });
