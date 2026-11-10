/**
 * Cartão obrigatório e verificação mensal (dia 20).
 *
 * Toda conta, mesmo isenta, precisa de um cartão válido. A verificação confirma o cartão salvo
 * com um SetupIntent (sem cobrar o cliente) e grava o resultado em `account_card_checks`.
 * Falha na verificação só gera aviso na tela; quem bloqueia o painel é pagamento recusado.
 */
import { StripeApiError, stripeEnv, stripeRequest } from "@/lib/billing/stripe.server";

export type CardCheckStatus = "ok" | "failed" | "missing";

type Db = any;

async function db(): Promise<Db> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as Db;
}

/** Cartão padrão do cliente (o da assinatura vence o do cliente; sem padrão, o mais recente). */
async function currentCard(customerId: string): Promise<{ id: string; expMonth: number | null; expYear: number | null } | null> {
  const cus = await stripeRequest<any>("GET", `/customers/${encodeURIComponent(customerId)}`, {
    expand: ["invoice_settings.default_payment_method"],
  });
  let pm: any = cus.invoice_settings?.default_payment_method;
  if (!pm || typeof pm === "string") {
    const list = await stripeRequest<{ data: any[] }>("GET", "/payment_methods", {
      customer: customerId,
      type: "card",
      limit: 1,
    });
    pm = list.data[0] ?? null;
    if (pm && !cus.invoice_settings?.default_payment_method) {
      await stripeRequest("POST", `/customers/${encodeURIComponent(customerId)}`, {
        invoice_settings: { default_payment_method: pm.id },
      }).catch(() => undefined);
    }
  }
  if (!pm || typeof pm === "string") return null;
  return { id: pm.id, expMonth: pm.card?.exp_month ?? null, expYear: pm.card?.exp_year ?? null };
}

function expired(c: { expMonth: number | null; expYear: number | null }): boolean {
  if (!c.expMonth || !c.expYear) return false;
  const now = new Date();
  // O cartão vale até o último dia do mês de validade.
  return c.expYear < now.getUTCFullYear() || (c.expYear === now.getUTCFullYear() && c.expMonth < now.getUTCMonth() + 1);
}

/** Confirma o cartão sem cobrar. Devolve o resultado, sem gravar. */
export async function verifyCustomerCard(customerId: string): Promise<{ status: CardCheckStatus; message: string | null }> {
  const card = await currentCard(customerId);
  if (!card) return { status: "missing", message: null };
  if (expired(card)) return { status: "failed", message: "Cartão vencido." };
  try {
    const si = await stripeRequest<{ status: string; last_setup_error?: { message?: string } | null }>("POST", "/setup_intents", {
      customer: customerId,
      payment_method: card.id,
      payment_method_types: ["card"],
      usage: "off_session",
      confirm: true,
      "payment_method_options[card][request_three_d_secure]": "automatic",
    });
    // `requires_action` (3DS) não é cartão ruim: o banco só pede autenticação na hora de cobrar.
    if (si.status === "succeeded" || si.status === "requires_action") return { status: "ok", message: null };
    return { status: "failed", message: si.last_setup_error?.message ?? "Cartão não aprovado." };
  } catch (err) {
    if (err instanceof StripeApiError && (err.type === "card_error" || err.code === "card_declined")) {
      return { status: "failed", message: err.message };
    }
    throw err;
  }
}

export async function saveCardCheck(
  ownerId: string,
  customerId: string,
  result: { status: CardCheckStatus; message: string | null },
): Promise<void> {
  const now = new Date().toISOString();
  await (await db()).from("account_card_checks").upsert(
    {
      user_id: ownerId,
      environment: stripeEnv(),
      stripe_customer_id: customerId,
      status: result.status,
      checked_at: now,
      failure_message: result.message,
      updated_at: now,
    },
    { onConflict: "user_id" },
  );
}

/** Verifica e grava o cartão de uma conta (cadastro novo, troca de cartão ou rotina do dia 20). */
export async function checkAccountCard(ownerId: string, customerId: string): Promise<CardCheckStatus> {
  const result = await verifyCustomerCard(customerId);
  await saveCardCheck(ownerId, customerId, result);
  return result.status;
}

/** Rotina do dia 20: confere o cartão de toda conta com cliente na Stripe. */
export async function runMonthlyCardChecks(budgetMs: number): Promise<{ checked: number; failed: number; skipped: number }> {
  const started = Date.now();
  const d = await db();
  const env = stripeEnv();

  // Contas com assinatura na Stripe entram na lista de verificação.
  const { data: subs } = await d
    .from("subscriptions")
    .select("user_id, stripe_customer_id")
    .eq("environment", env)
    .not("stripe_customer_id", "is", null);
  const seen = new Map<string, string>();
  for (const s of (subs ?? []) as Array<{ user_id: string; stripe_customer_id: string }>) seen.set(s.user_id, s.stripe_customer_id);
  const { data: rows } = await d
    .from("account_card_checks")
    .select("user_id, stripe_customer_id, checked_at")
    .eq("environment", env);
  const recent = new Set<string>();
  const cutoff = Date.now() - 12 * 3600_000;
  for (const r of (rows ?? []) as Array<{ user_id: string; stripe_customer_id: string | null; checked_at: string | null }>) {
    if (r.stripe_customer_id && !seen.has(r.user_id)) seen.set(r.user_id, r.stripe_customer_id);
    if (r.checked_at && Date.parse(r.checked_at) > cutoff) recent.add(r.user_id);
  }

  let checked = 0;
  let failed = 0;
  let skipped = 0;
  for (const [ownerId, customerId] of seen) {
    if (recent.has(ownerId)) {
      skipped++;
      continue;
    }
    if (Date.now() - started > budgetMs) break;
    try {
      const st = await checkAccountCard(ownerId, customerId);
      checked++;
      if (st !== "ok") failed++;
    } catch (err) {
      console.error("[card-check]", ownerId, err);
    }
  }
  return { checked, failed, skipped };
}
