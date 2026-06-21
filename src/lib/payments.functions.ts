import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { gatewayFetch, getPaddleClient, type PaddleEnv } from "@/lib/paddle.server";

// Plan tiers and feature limits
export const PLANS = {
  starter: {
    id: "starter_plan",
    priceId: "starter_monthly",
    name: "Starter",
    priceLabel: "R$ 99",
    priceNumeric: 99,
    maxGuides: 3,
    tier: 1,
    description: "Para começar a criar guias manualmente.",
    features: { autoImport: false, ai: false, customBrand: false },
    featureList: [
      "Até 3 guias",
      "Edição manual completa",
      "Acesso público ou por PIN",
      "Bilíngue (PT / EN)",
    ],
  },
  pro: {
    id: "pro_plan",
    priceId: "pro_monthly",
    name: "Pro",
    priceLabel: "R$ 199",
    priceNumeric: 199,
    maxGuides: 20,
    tier: 2,
    description: "Para anfitriões que querem ganhar tempo com automação.",
    features: { autoImport: true, ai: false, customBrand: false },
    featureList: [
      "Até 20 guias",
      "Importação automática (Airbnb)",
      "Recomendações automáticas via Google Maps",
      "Tudo do Starter",
    ],
  },
  business: {
    id: "business_plan",
    priceId: "business_monthly",
    name: "Business",
    priceLabel: "R$ 399",
    priceNumeric: 399,
    maxGuides: 50,
    tier: 3,
    description: "Para gestores profissionais que querem IA atendendo os hóspedes.",
    features: { autoImport: true, ai: true, customBrand: false },
    featureList: [
      "Até 50 guias",
      "Concierge IA (chat 24h nos guias)",
      "Base de conhecimento e comportamento da IA",
      "Tudo do Pro",
      "Suporte prioritário",
    ],
  },
  enterprise: {
    id: "enterprise_plan",
    priceId: "enterprise_custom",
    name: "Enterprise",
    priceLabel: "Sob consulta",
    priceNumeric: 0,
    maxGuides: 9999,
    tier: 4,
    description: "Volume alto, marca própria, integrações sob medida e SLA.",
    features: { autoImport: true, ai: true, customBrand: true },
    featureList: [
      "Guias ilimitados",
      "Marca personalizada (logo e nome)",
      "Tudo do Business",
      "Onboarding dedicado",
      "Integrações personalizadas",
      "SLA e suporte 24/7",
    ],
  },
} as const;

export type PlanKey = keyof typeof PLANS;

export function planFromProductId(productId: string | null | undefined): PlanKey | null {
  if (!productId) return null;
  if (productId === "starter_plan") return "starter";
  if (productId === "pro_plan") return "pro";
  if (productId === "business_plan") return "business";
  if (productId === "enterprise_plan") return "enterprise";
  return null;
}

const PaddleEnvSchema = z.enum(["sandbox", "live"]);

export const resolvePaddlePrice = createServerFn({ method: "GET" })
  .inputValidator((data: { priceId: string; environment: PaddleEnv }) =>
    z.object({ priceId: z.string().min(1).max(80), environment: PaddleEnvSchema }).parse(data),
  )
  .handler(async ({ data }) => {
    const response = await gatewayFetch(
      data.environment,
      `/prices?external_id=${encodeURIComponent(data.priceId)}`,
    );
    const result = await response.json();
    if (!result.data?.length) throw new Error("Price not found");
    return result.data[0].id as string;
  });

export const getMySubscription = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { environment: PaddleEnv }) =>
    z.object({ environment: PaddleEnvSchema }).parse(data),
  )
  .handler(async ({ data, context }) => {
    // Fetch the user's most recent subscription. We prefer rows matching the
    // caller's runtime environment, but fall back to manual rows from the
    // other environment so admin-granted plans work in both preview and
    // published builds.
    const { data: rows, error } = await context.supabase
      .from("subscriptions")
      .select(
        "id, paddle_subscription_id, paddle_customer_id, product_id, price_id, status, current_period_start, current_period_end, cancel_at_period_end, environment, is_manual, custom_price_cents, custom_currency, trial_ends_at, max_guides_override, admin_notes, created_at",
      )
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw (await import("@/lib/db-errors.server")).safeDbError("subscriptions", error);
    const list = rows ?? [];
    const match =
      list.find((r) => r.environment === data.environment) ??
      list.find((r) => r.is_manual) ??
      null;
    if (!match) return { subscription: null, plan: null as PlanKey | null };
    const plan = planFromProductId(match.product_id);
    return { subscription: match, plan };
  });

export const createPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { environment: PaddleEnv }) =>
    z.object({ environment: PaddleEnvSchema }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: sub, error } = await context.supabase
      .from("subscriptions")
      .select("paddle_subscription_id, paddle_customer_id, environment")
      .eq("user_id", context.userId)
      .eq("environment", data.environment)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw (await import("@/lib/db-errors.server")).safeDbError("subscriptions", error);
    if (!sub) throw new Error("Nenhuma assinatura encontrada");
    if (!sub.paddle_customer_id?.startsWith("ctm_") && !sub.paddle_customer_id?.startsWith("cus_")) {
      throw new Error("Esta assinatura foi configurada manualmente e não possui portal de pagamentos.");
    }

    const paddle = getPaddleClient(sub.environment as PaddleEnv);
    const session = await paddle.customerPortalSessions.create(
      sub.paddle_customer_id as string,
      [sub.paddle_subscription_id as string],
    );
    return {
      overviewUrl: session.urls.general.overview,
      subscriptions: session.urls.subscriptions,
    };
  });

export type PaymentRow = {
  id: string;
  status: string;
  createdAt: string;
  amount: string;
  currency: string;
  invoiceUrl: string | null;
};

export const listMyPayments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { environment: PaddleEnv }) =>
    z.object({ environment: PaddleEnvSchema }).parse(data),
  )
  .handler(async ({ data, context }): Promise<{ payments: PaymentRow[] }> => {
    const { data: sub } = await context.supabase
      .from("subscriptions")
      .select("paddle_customer_id, environment")
      .eq("user_id", context.userId)
      .eq("environment", data.environment)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const customerId = sub?.paddle_customer_id;
    if (!customerId || (!customerId.startsWith("ctm_") && !customerId.startsWith("cus_"))) {
      return { payments: [] };
    }

    try {
      const response = await gatewayFetch(
        data.environment,
        `/transactions?customer_id=${encodeURIComponent(customerId)}&per_page=25&order_by=created_at[DESC]`,
      );
      const json = await response.json();
      const payments: PaymentRow[] = (json.data ?? []).map((t: {
        id: string;
        status: string;
        created_at: string;
        details?: { totals?: { total?: string } };
        currency_code: string;
        invoice_id?: string | null;
      }) => ({
        id: t.id,
        status: t.status,
        createdAt: t.created_at,
        amount: t.details?.totals?.total ?? "0",
        currency: t.currency_code,
        invoiceUrl: t.invoice_id ? `https://my.paddle.com/invoice/${t.invoice_id}` : null,
      }));
      return { payments };
    } catch {
      return { payments: [] };
    }
  });

export const changePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { environment: PaddleEnv; targetPriceExternalId: string }) =>
    z
      .object({
        environment: PaddleEnvSchema,
        targetPriceExternalId: z.string().min(1).max(80),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: sub, error } = await context.supabase
      .from("subscriptions")
      .select("paddle_subscription_id, environment")
      .eq("user_id", context.userId)
      .eq("environment", data.environment)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw (await import("@/lib/db-errors.server")).safeDbError("subscriptions", error);
    if (!sub) throw new Error("Nenhuma assinatura encontrada");
    if (!sub.paddle_subscription_id?.startsWith("sub_")) {
      throw new Error("Esta assinatura foi configurada manualmente. Entre em contato com o suporte para mudar de plano.");
    }

    // Resolve target Paddle price id
    const priceRes = await gatewayFetch(
      data.environment,
      `/prices?external_id=${encodeURIComponent(data.targetPriceExternalId)}`,
    );
    const priceJson = await priceRes.json();
    if (!priceJson.data?.length) throw new Error("Plano de destino não encontrado");
    const paddlePriceId = priceJson.data[0].id as string;

    const paddle = getPaddleClient(sub.environment as PaddleEnv);
    await paddle.subscriptions.update(sub.paddle_subscription_id, {
      items: [{ priceId: paddlePriceId, quantity: 1 }],
      prorationBillingMode: "prorated_immediately",
    });
    return { ok: true };
  });
