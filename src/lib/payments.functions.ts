import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { gatewayFetch, getPaddleClient, type PaddleEnv } from "@/lib/paddle.server";
import {
  PLANS,
  planFromProductId,
  planFromPriceId,
  type PlanKey,
} from "@/lib/payments.shared";

// Re-export shared helpers so existing `@/lib/payments.functions` importers keep working.
export { PLANS, planFromProductId, planFromPriceId };
export type { PlanKey };


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

// Retorna a assinatura da CONTA (owner) para qualquer usuário que faça parte
// dela via account_members. Permite que membros da equipe (não-owners)
// enxerguem o plano real do dono da conta e desbloqueiem as features
// contratadas (IA, biblioteca, etc.), em vez de caírem no plano Free.
export const getAccountSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ownerId: string; environment: PaddleEnv }) =>
    z.object({ ownerId: z.string().uuid(), environment: PaddleEnvSchema }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.ownerId !== userId) {
      // Verifica se o usuário é membro ativo desta conta.
      const { data: m } = await supabase
        .from("account_members")
        .select("id")
        .eq("owner_id", data.ownerId)
        .eq("member_user_id", userId)
        .eq("status", "active")
        .maybeSingle();
      if (!m) throw new Error("Você não tem acesso a esta conta.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("subscriptions")
      .select(
        "id, paddle_subscription_id, paddle_customer_id, product_id, price_id, status, current_period_start, current_period_end, cancel_at_period_end, environment, is_manual, custom_price_cents, custom_currency, trial_ends_at, max_guides_override, admin_notes, created_at",
      )
      .eq("user_id", data.ownerId)
      .order("created_at", { ascending: false });
    if (error) throw new Error("Não foi possível carregar a assinatura da conta.");
    const list = rows ?? [];
    const match =
      list.find((r) => r.environment === data.environment) ??
      list.find((r) => r.is_manual) ??
      null;
    if (!match) return { subscription: null, plan: null as PlanKey | null };
    return { subscription: match, plan: planFromProductId(match.product_id) };
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
    const customerId = sub.paddle_customer_id ?? "";
    const isRealPaddleCustomer = customerId.startsWith("ctm_") || customerId.startsWith("cus_");
    if (!isRealPaddleCustomer) {
      throw new Error("Esta é uma conta de cortesia configurada manualmente — não há cobrança recorrente nem cartão a gerenciar.");
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

    // Enforce guide-count limit for the target plan (downgrade safety).
    const targetPlan = planFromPriceId(data.targetPriceExternalId);
    if (targetPlan) {
      const targetMax = PLANS[targetPlan].maxGuides;
      const { count } = await context.supabase
        .from("properties")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", context.userId);
      const current = count ?? 0;
      if (current > targetMax) {
        throw new Error(
          `EXCESS_GUIDES:${current}:${targetMax}:O plano ${PLANS[targetPlan].name} permite até ${targetMax} guias. Você tem ${current}. Exclua ${current - targetMax} guia(s) antes de fazer o downgrade.`,
        );
      }
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
    const { auditBilling } = await import("@/lib/ai/audit/platform.server");
    await auditBilling("plan_changed", {
      userId: context.userId,
      entityId: sub.paddle_subscription_id,
      description: `Plano alterado para ${targetPlan ? PLANS[targetPlan].name : data.targetPriceExternalId}.`,
      metadata: { environment: data.environment, targetPriceExternalId: data.targetPriceExternalId },
      severity: "notice",
    });
    return { ok: true };
  });

export type GuideRow = {
  id: string;
  name: string;
  slug: string;
  published: boolean;
  created_at: string;
};

export const getDowngradeImpact = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { targetPriceExternalId: string }) =>
    z.object({ targetPriceExternalId: z.string().min(1).max(80) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const targetPlan = planFromPriceId(data.targetPriceExternalId);
    const targetMax = targetPlan ? PLANS[targetPlan].maxGuides : 0;
    const { data: rows, error } = await context.supabase
      .from("properties")
      .select("id, name, slug, published, created_at")
      .eq("owner_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw (await import("@/lib/db-errors.server")).safeDbError("properties", error);
    const guides = (rows ?? []) as GuideRow[];
    return {
      targetPlan,
      targetMax,
      currentCount: guides.length,
      mustRemove: Math.max(0, guides.length - targetMax),
      guides,
    };
  });

export const deleteGuides = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ids: string[] }) =>
    z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("properties")
      .delete()
      .in("id", data.ids)
      .eq("owner_id", context.userId);
    if (error) throw (await import("@/lib/db-errors.server")).safeDbError("properties", error);
    return { ok: true, deleted: data.ids.length };
  });
