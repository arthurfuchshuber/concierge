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
    maxGuides: 3,
    features: {
      autoImport: false,
      ai: false,
      customBrand: false,
    },
  },
  pro: {
    id: "pro_plan",
    priceId: "pro_monthly",
    name: "Pro",
    priceLabel: "R$ 199",
    maxGuides: 20,
    features: {
      autoImport: true,
      ai: true,
      customBrand: false,
    },
  },
  business: {
    id: "business_plan",
    priceId: "business_monthly",
    name: "Business",
    priceLabel: "R$ 399",
    maxGuides: 50,
    features: {
      autoImport: true,
      ai: true,
      customBrand: true,
    },
  },
} as const;

export type PlanKey = keyof typeof PLANS;

export function planFromProductId(productId: string | null | undefined): PlanKey | null {
  if (!productId) return null;
  if (productId === "starter_plan") return "starter";
  if (productId === "pro_plan") return "pro";
  if (productId === "business_plan") return "business";
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
    const { data: rows, error } = await context.supabase
      .from("subscriptions")
      .select(
        "id, paddle_subscription_id, paddle_customer_id, product_id, price_id, status, current_period_start, current_period_end, cancel_at_period_end, environment, created_at",
      )
      .eq("user_id", context.userId)
      .eq("environment", data.environment)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw (await import("@/lib/db-errors.server")).safeDbError("subscriptions", error);
    if (!rows) return { subscription: null, plan: null as PlanKey | null };
    const plan = planFromProductId(rows.product_id);
    return { subscription: rows, plan };
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
