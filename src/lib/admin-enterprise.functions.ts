import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { gatewayFetch, type PaddleEnv } from "@/lib/paddle.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertAdmin(supabase: any, userId: string) {
  const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (!data) throw new Error("Acesso negado: apenas administradores");
}

const PaddleEnvSchema = z.enum(["sandbox", "live"]);

const ENTERPRISE_PRODUCT_EXTERNAL_ID = "enterprise_plan";

// Encontra ou cria customer no Paddle
async function findOrCreatePaddleCustomer(
  env: PaddleEnv,
  email: string,
  name: string | null,
): Promise<{ id: string; hasPaymentMethod: boolean }> {
  const search = await gatewayFetch(env, `/customers?email=${encodeURIComponent(email)}`);
  const searchJson = await search.json();
  let customerId: string | null = searchJson.data?.[0]?.id ?? null;

  if (!customerId) {
    const create = await gatewayFetch(env, `/customers`, {
      method: "POST",
      body: JSON.stringify({ email, name: name ?? email.split("@")[0] }),
    });
    const createJson = await create.json();
    if (!create.ok) {
      throw new Error(`Erro ao criar customer: ${createJson.error?.detail ?? "desconhecido"}`);
    }
    customerId = createJson.data.id as string;
  }

  // Verifica payment methods
  let hasPaymentMethod = false;
  try {
    const pmRes = await gatewayFetch(env, `/customers/${customerId}/payment-methods`);
    const pmJson = await pmRes.json();
    hasPaymentMethod = Array.isArray(pmJson.data) && pmJson.data.length > 0;
  } catch {
    hasPaymentMethod = false;
  }

  return { id: customerId!, hasPaymentMethod };
}

// Encontra produto Enterprise pelo external_id
async function getEnterpriseProductId(env: PaddleEnv): Promise<string> {
  const res = await gatewayFetch(
    env,
    `/products?external_id=${encodeURIComponent(ENTERPRISE_PRODUCT_EXTERNAL_ID)}`,
  );
  const json = await res.json();
  if (!json.data?.length) throw new Error("Produto Enterprise não encontrado no Paddle");
  return json.data[0].id as string;
}

// Cria um price ad-hoc com valor customizado e trial
async function createCustomPrice(
  env: PaddleEnv,
  productPaddleId: string,
  monthlyAmountBRLCents: number,
  trialDays: number,
  label: string,
  customerId: string,
): Promise<{ paddleId: string; externalId: string }> {
  const externalId = `enterprise_custom_${customerId}_${Date.now()}`;
  const body: Record<string, unknown> = {
    product_id: productPaddleId,
    description: label,
    name: label,
    billing_cycle: { interval: "month", frequency: 1 },
    unit_price: { amount: String(monthlyAmountBRLCents), currency_code: "BRL" },
    tax_mode: "account_setting",
    quantity: { minimum: 1, maximum: 1 },
    import_meta: { external_id: externalId, imported_from: "lovable" },
  };
  if (trialDays > 0) {
    body.trial_period = { interval: "day", frequency: trialDays };
  }

  const res = await gatewayFetch(env, `/prices`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Erro ao criar price: ${json.error?.detail ?? JSON.stringify(json.error)}`);
  }
  return { paddleId: json.data.id as string, externalId };
}

// Calcula o próximo "dia 1" após uma data
function nextMonthFirstDayISO(after: Date): string {
  const d = new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth() + 1, 1, 12, 0, 0));
  return d.toISOString();
}

export const adminCreateEnterpriseSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    email: string;
    monthlyAmountBRLCents: number;
    trialDays: number;
    environment: PaddleEnv;
  }) =>
    z
      .object({
        email: z.string().email(),
        monthlyAmountBRLCents: z.number().int().min(70).max(10_000_000_00),
        trialDays: z.number().int().min(0).max(90),
        environment: PaddleEnvSchema,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Localizar usuário pelo email
    const targetEmail = data.email.trim().toLowerCase();
    let user: { id: string; email?: string | null } | null = null;
    for (let page = 1; page <= 10; page++) {
      const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
      const match = list.users.find((u) => (u.email ?? "").toLowerCase() === targetEmail);
      if (match) { user = match; break; }
      if (list.users.length < 1000) break;
    }
    if (!user) {
      throw new Error("Usuário não encontrado. O cliente precisa criar a conta primeiro.");
    }

    // Pegar nome do profile
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle();

    // 1. Customer Paddle
    const customer = await findOrCreatePaddleCustomer(
      data.environment,
      targetEmail,
      profile?.full_name ?? null,
    );
    if (!customer.hasPaymentMethod) {
      throw new Error(
        "Customer no Paddle não possui método de pagamento salvo. Envie ao cliente o link do portal de pagamento para cadastrar cartão primeiro.",
      );
    }

    // 2. Endereço do customer (necessário para subscription)
    const addrRes = await gatewayFetch(
      data.environment,
      `/customers/${customer.id}/addresses?status=active`,
    );
    const addrJson = await addrRes.json();
    const addressId = addrJson.data?.[0]?.id;
    if (!addressId) {
      throw new Error("Customer não possui endereço cadastrado no Paddle.");
    }

    // 3. Produto Enterprise
    const productPaddleId = await getEnterpriseProductId(data.environment);

    // 4. Price ad-hoc com custom amount + trial
    const valorLabel = (data.monthlyAmountBRLCents / 100).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
    const price = await createCustomPrice(
      data.environment,
      productPaddleId,
      data.monthlyAmountBRLCents,
      data.trialDays,
      `Enterprise — ${targetEmail} — ${valorLabel}/mês`,
      customer.id,
    );

    // 5. Criar transaction (Paddle cobra cartão salvo automaticamente
    //    e dispara subscription.created via webhook)
    const txBody = {
      items: [{ price_id: price.paddleId, quantity: 1 }],
      customer_id: customer.id,
      address_id: addressId,
      currency_code: "BRL",
      collection_mode: "automatic",
      custom_data: {
        userId: user.id,
        admin_created: true,
        monthly_amount_brl_cents: data.monthlyAmountBRLCents,
        anchor_to_day_1: true,
        trial_days: data.trialDays,
      },
    };
    const txRes = await gatewayFetch(data.environment, `/transactions`, {
      method: "POST",
      body: JSON.stringify(txBody),
    });
    const txJson = await txRes.json();
    if (!txRes.ok) {
      throw new Error(`Erro ao criar transação: ${txJson.error?.detail ?? JSON.stringify(txJson.error)}`);
    }

    return {
      ok: true,
      transactionId: txJson.data.id as string,
      subscriptionId: txJson.data.subscription_id as string | null,
      customerId: customer.id,
      priceExternalId: price.externalId,
    };
  });

// Ancora a assinatura para próximo dia 1, com proração
export const adminAnchorSubscriptionToDay1 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { paddleSubscriptionId: string; environment: PaddleEnv }) =>
    z
      .object({
        paddleSubscriptionId: z.string().min(3).max(80),
        environment: PaddleEnvSchema,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);

    // Buscar subscription atual pra saber next_billed_at e trial_end
    const subRes = await gatewayFetch(
      data.environment,
      `/subscriptions/${data.paddleSubscriptionId}`,
    );
    const subJson = await subRes.json();
    if (!subRes.ok) {
      throw new Error(`Erro ao buscar subscription: ${subJson.error?.detail ?? "desconhecido"}`);
    }
    const currentNextBilled = subJson.data?.next_billed_at;
    if (!currentNextBilled) {
      throw new Error("Subscription não tem next_billed_at definido.");
    }

    // Próximo dia 1 após o next_billed_at atual
    const newAnchor = nextMonthFirstDayISO(new Date(currentNextBilled));

    const patchRes = await gatewayFetch(
      data.environment,
      `/subscriptions/${data.paddleSubscriptionId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          next_billed_at: newAnchor,
          proration_billing_mode: "prorated_next_billing_period",
        }),
      },
    );
    const patchJson = await patchRes.json();
    if (!patchRes.ok) {
      throw new Error(`Erro ao ancorar: ${patchJson.error?.detail ?? JSON.stringify(patchJson.error)}`);
    }

    // Atualizar coluna no banco
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("subscriptions")
      .update({ billing_anchor_day: 1, enterprise_request: true })
      .eq("paddle_subscription_id", data.paddleSubscriptionId);

    return { ok: true, anchoredTo: newAnchor };
  });

export type EnterpriseSubRow = {
  paddleSubscriptionId: string;
  paddleCustomerId: string;
  status: string;
  customPriceCents: number | null;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  nextBilledAt: string | null;
  customerEmail: string | null;
  userId: string | null;
  environment: string;
  billingAnchorDay: number | null;
};

export const adminListEnterpriseSubscriptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { environment: PaddleEnv }) =>
    z.object({ environment: PaddleEnvSchema }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ items: EnterpriseSubRow[] }> => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rows } = await supabaseAdmin
      .from("subscriptions")
      .select(
        "user_id, paddle_subscription_id, paddle_customer_id, status, custom_price_cents, current_period_end, trial_ends_at, environment, billing_anchor_day",
      )
      .eq("environment", data.environment)
      .eq("product_id", "enterprise_plan")
      .order("created_at", { ascending: false });

    if (!rows?.length) return { items: [] };

    const userIds = Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean)));
    const { data: usersData } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const userMap = new Map((usersData?.users ?? []).map((u) => [u.id, u.email]));
    void userIds;

    // Enriquecer com next_billed_at do Paddle
    const items: EnterpriseSubRow[] = [];
    for (const r of rows) {
      let nextBilledAt: string | null = null;
      if (r.paddle_subscription_id?.startsWith("sub_")) {
        try {
          const res = await gatewayFetch(data.environment, `/subscriptions/${r.paddle_subscription_id}`);
          const j = await res.json();
          nextBilledAt = j.data?.next_billed_at ?? null;
        } catch {
          /* noop */
        }
      }
      items.push({
        paddleSubscriptionId: r.paddle_subscription_id,
        paddleCustomerId: r.paddle_customer_id,
        status: r.status,
        customPriceCents: r.custom_price_cents,
        currentPeriodEnd: r.current_period_end,
        trialEndsAt: r.trial_ends_at,
        nextBilledAt,
        customerEmail: userMap.get(r.user_id) ?? null,
        userId: r.user_id,
        environment: r.environment,
        billingAnchorDay: r.billing_anchor_day,
      });
    }

    return { items };
  });

export const adminCancelEnterpriseSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    paddleSubscriptionId: string;
    environment: PaddleEnv;
    immediate: boolean;
  }) =>
    z
      .object({
        paddleSubscriptionId: z.string().min(3).max(80),
        environment: PaddleEnvSchema,
        immediate: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const res = await gatewayFetch(
      data.environment,
      `/subscriptions/${data.paddleSubscriptionId}/cancel`,
      {
        method: "POST",
        body: JSON.stringify({
          effective_from: data.immediate ? "immediately" : "next_billing_period",
        }),
      },
    );
    const json = await res.json();
    if (!res.ok) {
      throw new Error(`Erro ao cancelar: ${json.error?.detail ?? "desconhecido"}`);
    }
    return { ok: true };
  });
