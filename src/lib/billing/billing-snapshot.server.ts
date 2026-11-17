/**
 * Registro mensal do corte de cobrança (dia 25, Brasília). Para CADA conta com anúncios — inclusive as isentas —
 * grava quantos anúncios estavam ativos no corte e quanto valia o mês. O extrato usa esse registro; sem ele
 * (meses anteriores a este recurso), reconstrói pela data de cadastro dos imóveis.
 */
import * as L from "@/lib/billing/listing-billing";

type Db = any;

async function db(): Promise<Db> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as Db;
}

/** Data do corte em Brasília (AAAA-MM-DD) para um instante. */
export function brtDate(now: Date = new Date()): string {
  return new Date(now.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
}

export async function snapshotOwner(admin: Db, ownerId: string, periodDate: string, source = "cron"): Promise<"created" | "exists" | "skipped"> {
  const { data: existing } = await admin.from("billing_period_snapshots").select("owner_id").eq("owner_id", ownerId).eq("period_date", periodDate).maybeSingle();
  if (existing) return "exists";
  const { loadConnectedListings } = await import("@/lib/billing/connected-listings.server");
  const { loadBillingTerms } = await import("@/lib/billing/billing-terms.server");
  const [listings, terms] = await Promise.all([loadConnectedListings(admin, ownerId), loadBillingTerms(admin, ownerId)]);
  if (listings.length === 0) return "skipped";
  const { data: sub } = await admin.from("subscriptions").select("is_manual, stripe_subscription_id").eq("user_id", ownerId).limit(1).maybeSingle();
  const count = listings.length;
  const { error } = await admin.from("billing_period_snapshots").upsert(
    {
      owner_id: ownerId,
      period_date: periodDate,
      active_listings: count,
      billed_units: L.billedUnits(count, terms),
      unit_cents: L.displayUnitCents(Math.max(1, count), terms),
      monthly_cents: L.monthlyTotalCents(count, terms),
      exempt: !!sub && !sub.stripe_subscription_id,
      courtesy: terms.courtesy,
      terms: { unitCents: terms.unitCents, minUnits: terms.minUnits, courtesy: terms.courtesy, billingStartsAt: terms.billingStartsAt },
      listing_names: listings.map((l) => l.name),
      source,
    },
    { onConflict: "owner_id,period_date", ignoreDuplicates: true },
  );
  if (error) throw new Error(error.message);
  return "created";
}

/** Roda o corte para todas as contas que têm imóvel. Idempotente. */
export async function runBillingSnapshots(budgetMs = 40_000): Promise<{ periodDate: string; created: number; exists: number; skipped: number; failed: number }> {
  const admin = await db();
  const periodDate = brtDate();
  const started = Date.now();
  const { data: owners, error } = await admin.from("properties").select("owner_id").is("archived_at", null);
  if (error) throw new Error(error.message);
  const ids = Array.from(new Set(((owners ?? []) as { owner_id: string }[]).map((r) => r.owner_id)));
  const out = { periodDate, created: 0, exists: 0, skipped: 0, failed: 0 };
  for (const id of ids) {
    if (Date.now() - started > budgetMs) break;
    try {
      const r = await snapshotOwner(admin, id, periodDate);
      out[r] += 1;
    } catch (e) {
      out.failed += 1;
      console.error("[billing-snapshot]", id, e);
    }
  }
  return out;
}
