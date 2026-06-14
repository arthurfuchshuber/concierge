import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { PLANS, planFromProductId, type PlanKey } from "@/lib/payments.functions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) throw new Error("Erro ao verificar permissão");
  if (!data) throw new Error("Acesso negado: apenas administradores");
}

export const checkIsAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    return { isAdmin: !!data };
  });

export type AdminCustomerRow = {
  userId: string;
  email: string | null;
  fullName: string | null;
  createdAt: string | null;
  subscription: {
    id: string;
    plan: PlanKey | null;
    productId: string | null;
    priceId: string | null;
    status: string;
    environment: string;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    trialEndsAt: string | null;
    cancelAtPeriodEnd: boolean;
    customPriceCents: number | null;
    customCurrency: string | null;
    adminNotes: string | null;
    isManual: boolean;
    paddleSubscriptionId: string;
  } | null;
};

export const adminListCustomers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ customers: AdminCustomerRow[] }> => {
    await assertAdmin(context.supabase, context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Auth users (paginated). For now, take first 1000.
    const { data: usersData, error: usersErr } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (usersErr) throw new Error("Erro ao listar usuários");

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name");

    const { data: subs } = await supabaseAdmin
      .from("subscriptions")
      .select(
        "id, user_id, paddle_subscription_id, product_id, price_id, status, environment, current_period_start, current_period_end, cancel_at_period_end, trial_ends_at, custom_price_cents, custom_currency, admin_notes, is_manual, created_at",
      )
      .order("created_at", { ascending: false });

    const profileMap = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
    // Latest sub per user
    const subMap = new Map<string, NonNullable<typeof subs>[number]>();
    for (const s of subs ?? []) {
      if (!subMap.has(s.user_id)) subMap.set(s.user_id, s);
    }

    const customers: AdminCustomerRow[] = usersData.users.map((u) => {
      const s = subMap.get(u.id);
      return {
        userId: u.id,
        email: u.email ?? null,
        fullName: profileMap.get(u.id) ?? null,
        createdAt: u.created_at ?? null,
        subscription: s
          ? {
              id: s.id,
              plan: planFromProductId(s.product_id),
              productId: s.product_id,
              priceId: s.price_id,
              status: s.status,
              environment: s.environment,
              currentPeriodStart: s.current_period_start,
              currentPeriodEnd: s.current_period_end,
              trialEndsAt: s.trial_ends_at,
              cancelAtPeriodEnd: !!s.cancel_at_period_end,
              customPriceCents: s.custom_price_cents,
              customCurrency: s.custom_currency,
              adminNotes: s.admin_notes,
              isManual: !!s.is_manual,
              paddleSubscriptionId: s.paddle_subscription_id,
            }
          : null,
      };
    });

    // Sort: with active sub first, then by created
    customers.sort((a, b) => {
      const sa = a.subscription?.status === "active" ? 0 : 1;
      const sb = b.subscription?.status === "active" ? 0 : 1;
      if (sa !== sb) return sa - sb;
      return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
    });

    return { customers };
  });

const PlanKeySchema = z.enum(["starter", "pro", "business", "enterprise"]);

export const adminUpdateSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    userId: string;
    plan: PlanKey;
    status: string;
    environment: "sandbox" | "live";
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    customPriceCents: number | null;
    customCurrency: string | null;
    cancelAtPeriodEnd: boolean;
    adminNotes: string | null;
  }) =>
    z
      .object({
        userId: z.string().uuid(),
        plan: PlanKeySchema,
        status: z.enum(["trialing", "active", "past_due", "paused", "canceled"]),
        environment: z.enum(["sandbox", "live"]),
        trialEndsAt: z.string().nullable(),
        currentPeriodEnd: z.string().nullable(),
        customPriceCents: z.number().int().min(0).max(100_000_00).nullable(),
        customCurrency: z.string().length(3).nullable(),
        cancelAtPeriodEnd: z.boolean(),
        adminNotes: z.string().max(2000).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);

    const planConfig = PLANS[data.plan];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Find latest existing sub in this environment for the user
    const { data: existing } = await supabaseAdmin
      .from("subscriptions")
      .select("id, paddle_subscription_id, paddle_customer_id")
      .eq("user_id", data.userId)
      .eq("environment", data.environment)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const patch = {
      product_id: planConfig.id,
      price_id: planConfig.priceId,
      status: data.status,
      environment: data.environment,
      trial_ends_at: data.trialEndsAt,
      current_period_end: data.currentPeriodEnd,
      custom_price_cents: data.customPriceCents,
      custom_currency: data.customCurrency,
      cancel_at_period_end: data.cancelAtPeriodEnd,
      admin_notes: data.adminNotes,
    } as const;

    if (existing) {
      const { error } = await supabaseAdmin
        .from("subscriptions")
        .update(patch)
        .eq("id", existing.id);
      if (error) throw new Error("Erro ao atualizar assinatura");
    } else {
      const suffix = data.userId.slice(0, 8);
      const { error } = await supabaseAdmin.from("subscriptions").insert({
        user_id: data.userId,
        paddle_subscription_id: `manual_${data.environment}_${suffix}_${Date.now()}`,
        paddle_customer_id: `manual_cus_${suffix}`,
        is_manual: true,
        current_period_start: new Date().toISOString(),
        ...patch,
      });
      if (error) throw new Error("Erro ao criar assinatura manual");
    }

    return { ok: true };
  });
