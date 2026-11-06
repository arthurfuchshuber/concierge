/**
 * Sincroniza a assinatura da Stripe com os anúncios conectados ativos da conta.
 *
 * Entradas:
 *  - fila `billing_sync_queue`, alimentada por gatilhos do banco sempre que um anúncio entra, sai,
 *    é pausado/arquivado ou um gêmeo muda (qualquer caminho do código, sem depender de lembrar de
 *    chamar aqui). O gatilho já dispara o processamento na hora; o cron só refaz o que falhou.
 *  - webhooks da Stripe na renovação (`invoice.upcoming` / `invoice.created`) como última barreira.
 *
 * A decisão é de `decideBillingAction` (regra pura, testada). Aqui só há I/O.
 */
import {
  cycleMaxFromMetadata,
  decideBillingAction,
  type BillingDecision,
  type StripeUpdateStep,
} from "@/lib/billing/listing-billing";
import {
  customerId,
  retrieveSubscription,
  stripeEnv,
  stripeRequest,
  subscriptionItem,
  subscriptionPeriod,
  type StripeSubscription,
} from "@/lib/billing/stripe.server";

const LIVE_STATUSES = ["active", "past_due", "trialing", "unpaid", "incomplete"];

async function admin(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Linha da assinatura Stripe vigente da conta (ignora liberações manuais). */
async function findStripeSubscriptionRow(db: any, ownerId: string) {
  const { data, error } = await db
    .from("subscriptions")
    .select("id, stripe_subscription_id, status")
    .eq("user_id", ownerId)
    .eq("environment", stripeEnv())
    .not("stripe_subscription_id", "is", null)
    .in("status", LIVE_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Falha ao ler a assinatura: ${error.message}`);
  return data as { id: string; stripe_subscription_id: string; status: string } | null;
}

function stepParams(itemId: string, step: StripeUpdateStep): Record<string, any> {
  const p: Record<string, any> = {};
  if (step.quantity !== undefined) {
    if (step.quantity < 1) throw new Error("Blindagem: quantidade < 1 nunca é enviada à Stripe.");
    p.items = [{ id: itemId, quantity: step.quantity }];
  }
  if (step.prorationBehavior) p.proration_behavior = step.prorationBehavior;
  if (step.pause === true) p.pause_collection = { behavior: "void" };
  if (step.pause === false) p.pause_collection = "";
  if (step.billingCycleAnchorNow) p.billing_cycle_anchor = "now";
  if (step.metadata) p.metadata = step.metadata;
  return p;
}

export type SyncResult = {
  ownerId: string;
  subscriptionId: string | null;
  activeListings: number | null;
  decision: BillingDecision["kind"] | "no_subscription";
  reason: string;
};

/** Aplica a regra para UMA conta. Seguro para repetir: o estado vem sempre fresco da Stripe. */
export async function syncListingBilling(ownerId: string, trigger: string): Promise<SyncResult> {
  const db = await admin();
  const row = await findStripeSubscriptionRow(db, ownerId);
  if (!row) {
    return { ownerId, subscriptionId: null, activeListings: null, decision: "no_subscription", reason: "conta sem assinatura Stripe ativa" };
  }

  const { loadConnectedListings } = await import("@/lib/billing/connected-listings.server");
  const [sub, listings] = await Promise.all([
    retrieveSubscription(row.stripe_subscription_id),
    loadConnectedListings(db, ownerId),
  ]);
  const item = subscriptionItem(sub);
  const period = subscriptionPeriod(sub);
  const zeroSince = Number(sub.metadata?.zero_since ?? "");
  const now = Math.floor(Date.now() / 1000);

  const decision = decideBillingAction(
    listings.length,
    {
      status: sub.status,
      quantity: item.quantity,
      paused: !!sub.pause_collection,
      zeroSince: Number.isFinite(zeroSince) && zeroSince > 0 ? zeroSince : null,
      periodStart: period.start,
      cycleMaxPaid: cycleMaxFromMetadata(sub.metadata, period.start, item.quantity),
    },
    now,
  );

  let latest: StripeSubscription = sub;
  for (const [i, step] of decision.steps.entries()) {
    // Mesma decisão sobre o mesmo estado = mesma chave: duas execuções simultâneas não cobram duas vezes.
    const key = [sub.id, period.start, item.quantity, sub.pause_collection ? "p" : "a", decision.kind, i, step.quantity ?? "-"].join(":");
    latest = await stripeRequest<StripeSubscription>(
      "POST",
      `/subscriptions/${encodeURIComponent(sub.id)}`,
      stepParams(item.id, step),
      { idempotencyKey: `listing-sync:${key}` },
    );
  }

  if (decision.steps.length) {
    await upsertSubscriptionFromStripe(latest);
    const { auditBilling } = await import("@/lib/audit/platform.server");
    await auditBilling("listing_quantity_synced", {
      userId: ownerId,
      entityId: sub.id,
      description: `Cobrança por anúncio: ${decision.reason} (${listings.length} anúncio(s) ativo(s)).`,
      metadata: { trigger, decision: decision.kind, activeListings: listings.length, previousQuantity: item.quantity },
      severity: decision.kind === "noop" ? "info" : "notice",
    });
  }

  return { ownerId, subscriptionId: sub.id, activeListings: listings.length, decision: decision.kind, reason: decision.reason };
}

// ───────────────────────── Espelho no banco ─────────────────────────

/** Grava/atualiza a linha `subscriptions` a partir do estado real na Stripe. */
export async function upsertSubscriptionFromStripe(sub: StripeSubscription): Promise<void> {
  const db = await admin();
  const env = stripeEnv();
  let userId: string | null = sub.metadata?.user_id ?? null;
  if (!userId) {
    const { data } = await db.from("subscriptions").select("user_id").eq("stripe_subscription_id", sub.id).maybeSingle();
    userId = (data as { user_id?: string } | null)?.user_id ?? null;
  }
  if (!userId) {
    console.error("[billing] assinatura sem user_id nos metadados", { id: sub.id });
    return;
  }
  const item = sub.items?.data?.[0];
  const period = subscriptionPeriod(sub);
  const product = item ? (typeof item.price.product === "string" ? item.price.product : item.price.product.id) : null;
  const row: Record<string, unknown> = {
    user_id: userId,
    stripe_subscription_id: sub.id,
    stripe_customer_id: customerId(sub),
    product_id: product,
    price_id: item?.price.id ?? null,
    listing_quantity: item?.quantity ?? null,
    status: sub.status,
    current_period_start: period.start ? new Date(period.start * 1000).toISOString() : null,
    current_period_end: period.end ? new Date(period.end * 1000).toISOString() : null,
    cancel_at_period_end: !!sub.cancel_at_period_end,
    billing_paused: !!sub.pause_collection,
    environment: env,
    is_manual: false,
  };
  const { error } = await db.from("subscriptions").upsert(row, { onConflict: "stripe_subscription_id" });
  if (error) throw new Error(`Falha ao gravar a assinatura: ${error.message}`);
  const { invalidateOwnerPlanCache } = await import("@/lib/plan-guard.server");
  invalidateOwnerPlanCache(userId);
}

// ───────────────────────── Fila ─────────────────────────

/** Processa a fila até o orçamento de tempo. Cada conta é tratada por um único processador por vez. */
export async function processBillingQueue(budgetMs = 20_000): Promise<{ processed: number; failed: number }> {
  const db = await admin();
  const started = Date.now();
  let processed = 0;
  let failed = 0;
  while (Date.now() - started < budgetMs) {
    const { data, error } = await db.rpc("claim_billing_sync", { _limit: 10 });
    if (error) throw new Error(`Falha ao ler a fila de cobrança: ${error.message}`);
    const claimed = (data ?? []) as Array<{ owner_id: string; requested_at: string }>;
    if (!claimed.length) break;
    for (const c of claimed) {
      try {
        await syncListingBilling(c.owner_id, "queue");
        await db.rpc("finish_billing_sync", { _owner_id: c.owner_id, _requested_at: c.requested_at, _error: null });
        processed++;
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[billing] sync falhou", c.owner_id, msg);
        await db.rpc("finish_billing_sync", { _owner_id: c.owner_id, _requested_at: c.requested_at, _error: msg.slice(0, 500) });
      }
    }
  }
  return { processed, failed };
}

/** Coloca a conta na fila (para chamadas fora dos gatilhos do banco). */
export async function enqueueBillingSync(ownerId: string): Promise<void> {
  const db = await admin();
  await db.rpc("enqueue_billing_sync", { _owner_id: ownerId });
}

