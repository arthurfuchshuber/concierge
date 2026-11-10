/**
 * Eventos da Stripe. Todo handler relê o estado atual na Stripe antes de gravar, então eventos
 * repetidos ou fora de ordem não corrompem a linha `subscriptions`.
 */
import {
  retrieveSubscription,
  stripeRequest,
  type StripeSubscription,
} from "@/lib/billing/stripe.server";
import { syncListingBilling, upsertSubscriptionFromStripe } from "@/lib/billing/billing-sync.server";

export type StripeEvent = { id: string; type: string; data: { object: any } };

const SUBSCRIPTION_EVENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
]);

function invoiceSubscriptionId(inv: any): string | null {
  const v = inv?.parent?.subscription_details?.subscription ?? inv?.subscription ?? null;
  return typeof v === "string" ? v : v?.id ?? null;
}

async function ownerOf(sub: StripeSubscription): Promise<string | null> {
  if (sub.metadata?.user_id) return sub.metadata.user_id;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await (supabaseAdmin as any)
    .from("subscriptions")
    .select("user_id")
    .eq("stripe_subscription_id", sub.id)
    .maybeSingle();
  return (data as { user_id?: string } | null)?.user_id ?? null;
}

/**
 * Última barreira da blindagem: se a fatura de RENOVAÇÃO nasce com a conta em zero anúncios,
 * ela é travada (sem finalização automática), finalizada sem cobrança e anulada.
 */
async function guardRenewalInvoice(inv: any): Promise<void> {
  if (inv?.status !== "draft" || inv?.billing_reason !== "subscription_cycle") return;
  const subId = invoiceSubscriptionId(inv);
  if (!subId) return;
  const sub = await retrieveSubscription(subId);
  const ownerId = await ownerOf(sub);
  if (!ownerId) return;
  const result = await syncListingBilling(ownerId, "invoice.created");
  if (result.activeListings !== 0) return;
  // Com a pausa já ativa a própria Stripe anula a fatura; só age se ela ainda estiver em rascunho.
  const fresh = await stripeRequest<{ status: string }>("GET", `/invoices/${encodeURIComponent(inv.id)}`);
  if (fresh.status !== "draft") return;
  await stripeRequest("POST", `/invoices/${encodeURIComponent(inv.id)}`, { auto_advance: false });
  await stripeRequest("POST", `/invoices/${encodeURIComponent(inv.id)}/finalize`, { auto_advance: false });
  await stripeRequest("POST", `/invoices/${encodeURIComponent(inv.id)}/void`);
  const { auditBilling } = await import("@/lib/audit/platform.server");
  await auditBilling("renewal_voided_zero_listings", {
    userId: ownerId,
    entityId: inv.id,
    description: "Renovação anulada: a conta estava com zero anúncios ativos.",
    metadata: { subscription: subId },
    severity: "notice",
  });
}

export async function handleStripeEvent(evt: StripeEvent): Promise<void> {
  const obj = evt.data?.object ?? {};

  if (SUBSCRIPTION_EVENTS.has(evt.type)) {
    await upsertSubscriptionFromStripe(await retrieveSubscription(obj.id));
    return;
  }

  switch (evt.type) {
    case "checkout.session.completed": {
      if (obj.mode === "setup" && obj.metadata?.purpose === "card_check" && obj.metadata?.user_id && obj.customer) {
        // Cartão cadastrado pela página de cartão obrigatório: confere e grava o resultado.
        const { checkAccountCard } = await import("@/lib/billing/card-check.server");
        const customerId = typeof obj.customer === "string" ? obj.customer : obj.customer.id;
        await checkAccountCard(obj.metadata.user_id as string, customerId);
        return;
      }
      if (obj.mode !== "subscription" || !obj.subscription) return;
      const subId = typeof obj.subscription === "string" ? obj.subscription : obj.subscription.id;
      const sub = await retrieveSubscription(subId);
      await upsertSubscriptionFromStripe(sub);
      const ownerId = await ownerOf(sub);
      // A quantidade do checkout é a do momento da compra; acerta já com a contagem real.
      if (ownerId) await syncListingBilling(ownerId, "checkout.completed");
      return;
    }
    case "invoice.upcoming": {
      const subId = invoiceSubscriptionId(obj);
      if (!subId) return;
      const ownerId = await ownerOf(await retrieveSubscription(subId));
      if (ownerId) await syncListingBilling(ownerId, "invoice.upcoming");
      return;
    }
    case "invoice.created":
      await guardRenewalInvoice(obj);
      return;
    case "invoice.paid":
    case "invoice.payment_failed":
    case "invoice.payment_action_required": {
      const subId = invoiceSubscriptionId(obj);
      if (subId) await upsertSubscriptionFromStripe(await retrieveSubscription(subId));
      return;
    }
    case "payment_method.attached": {
      // Cartão novo (troca depois de um pagamento recusado): tenta quitar a fatura em aberto na hora,
      // para a janela de "pagamento recusado" sair sem esperar a próxima tentativa automática.
      const customerId = typeof obj.customer === "string" ? obj.customer : obj.customer?.id;
      if (!customerId) return;
      const open = await stripeRequest<{ data: Array<{ id: string; attempt_count?: number }> }>("GET", "/invoices", {
        customer: customerId,
        status: "open",
        limit: 5,
      });
      for (const inv of open.data) {
        if (!inv.attempt_count) continue;
        try {
          await stripeRequest("POST", `/invoices/${encodeURIComponent(inv.id)}/pay`, { payment_method: obj.id });
        } catch {
          // Cartão novo também recusado: a janela continua até um cartão válido.
        }
      }
      return;
    }
    default:
      return;
  }
}
