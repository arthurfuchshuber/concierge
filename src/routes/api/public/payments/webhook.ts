import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { verifyWebhook, EventName, type PaddleEnv } from "@/lib/paddle.server";

let _supabase: any = null;
function getSupabase(): any {
  if (!_supabase) {
    _supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _supabase;
}

function nextMonthFirstDayISO(after: Date): string {
  const d = new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth() + 1, 1, 12, 0, 0));
  return d.toISOString();
}

async function anchorSubscriptionDay1(env: PaddleEnv, subscriptionId: string, currentNextBilled: string | undefined | null) {
  if (!currentNextBilled) return;
  try {
    const { gatewayFetch } = await import("@/lib/paddle.server");
    const newAnchor = nextMonthFirstDayISO(new Date(currentNextBilled));
    await gatewayFetch(env, `/subscriptions/${subscriptionId}`, {
      method: "PATCH",
      body: JSON.stringify({
        next_billed_at: newAnchor,
        proration_billing_mode: "prorated_next_billing_period",
      }),
    });
  } catch (e) {
    console.error("payments.webhook: anchor day1 failed", e);
  }
}

async function handleSubscriptionCreated(data: any, env: PaddleEnv) {
  const { id, customerId, items, status, currentBillingPeriod, customData, nextBilledAt } = data;

  const userId = customData?.userId;
  if (!userId) {
    console.error("payments.webhook: missing customData.userId", { id });
    return;
  }

  const item = items?.[0];
  const productId = item?.product?.importMeta?.externalId;
  // Enterprise custom: o price é ad-hoc por cliente. Usamos o external_id real
  // se existir, senão caímos para "enterprise_custom" como flag genérica.
  const priceExternalId = item?.price?.importMeta?.externalId ?? "enterprise_custom";
  if (!productId) {
    console.warn("payments.webhook: missing product.importMeta.externalId", {
      id,
      rawProductId: item?.product?.id,
    });
    return;
  }

  const customAmountCents = customData?.monthly_amount_brl_cents ?? null;
  const adminCreated = customData?.admin_created === true;
  const anchorToDay1 = customData?.anchor_to_day_1 === true;
  const trialEndsAt = data?.firstBilledAt ?? data?.nextBilledAt ?? null;

  const row: Record<string, unknown> = {
    user_id: userId,
    paddle_subscription_id: id,
    paddle_customer_id: customerId,
    product_id: productId,
    price_id: priceExternalId,
    status,
    current_period_start: currentBillingPeriod?.startsAt,
    current_period_end: currentBillingPeriod?.endsAt,
    environment: env,
    updated_at: new Date().toISOString(),
  };
  if (customAmountCents !== null) {
    row.custom_price_cents = customAmountCents;
    row.custom_currency = "BRL";
  }
  if (adminCreated) {
    row.is_manual = true;
    row.enterprise_request = true;
  }
  if (status === "trialing") {
    row.trial_ends_at = trialEndsAt;
  }
  if (anchorToDay1) {
    row.billing_anchor_day = 1;
  }

  await getSupabase().from("subscriptions").upsert(row, { onConflict: "paddle_subscription_id" });

  // Após criar, se for Enterprise admin-created, ancorar para próximo dia 1
  if (anchorToDay1) {
    await anchorSubscriptionDay1(env, id, nextBilledAt);
  }

  // Push para admins do SaaS quando um cliente entra em trial (uma vez, no create).
  if (status === "trialing") {
    const { notifySaasAdminsTrialStarted } = await import("@/lib/saas-admin-push.server");
    await notifySaasAdminsTrialStarted({
      userId,
      productId,
      environment: env,
      trialEndsAt,
    });
  }
}

async function handleSubscriptionUpdated(data: any, env: PaddleEnv) {
  const { id, status, currentBillingPeriod, scheduledChange, items } = data;

  const item = items?.[0];
  const priceId = item?.price?.importMeta?.externalId;
  const productId = item?.product?.importMeta?.externalId;

  const update: Record<string, unknown> = {
    status,
    current_period_start: currentBillingPeriod?.startsAt,
    current_period_end: currentBillingPeriod?.endsAt,
    cancel_at_period_end: scheduledChange?.action === "cancel",
    updated_at: new Date().toISOString(),
  };
  if (priceId) update.price_id = priceId;
  if (productId) update.product_id = productId;

  await getSupabase()
    .from("subscriptions")
    .update(update)
    .eq("paddle_subscription_id", id)
    .eq("environment", env);
}

async function handleSubscriptionCanceled(data: any, env: PaddleEnv) {
  await getSupabase()
    .from("subscriptions")
    .update({ status: "canceled", updated_at: new Date().toISOString() })
    .eq("paddle_subscription_id", data.id)
    .eq("environment", env);
}

async function handleWebhook(req: Request, env: PaddleEnv) {
  const event = await verifyWebhook(req, env);
  switch (event.eventType) {
    case EventName.SubscriptionCreated:
      await handleSubscriptionCreated(event.data, env);
      break;
    case EventName.SubscriptionUpdated:
      await handleSubscriptionUpdated(event.data, env);
      break;
    case EventName.SubscriptionCanceled:
      await handleSubscriptionCanceled(event.data, env);
      break;
    default:
      console.log("payments.webhook: unhandled event", event.eventType);
  }
}

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const env = (url.searchParams.get("env") || "sandbox") as PaddleEnv;
        try {
          await handleWebhook(request, env);
          return Response.json({ received: true });
        } catch (e) {
          console.error("payments.webhook error:", e);
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});
