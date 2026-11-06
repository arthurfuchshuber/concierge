import { beforeEach, describe, expect, it, vi } from "vitest";

// ───── Stripe simulada ─────
const calls: Array<{ method: string; path: string; params: any; key?: string }> = [];
let subscription: any;

vi.mock("@/lib/billing/stripe.server", async (orig) => {
  const real: any = await orig();
  return {
    ...real,
    stripeEnv: () => "live",
    stripeEnvOrNull: () => "live",
    retrieveSubscription: vi.fn(async () => structuredClone(subscription)),
    stripeRequest: vi.fn(async (method: string, path: string, params: any, opts?: { idempotencyKey?: string }) => {
      calls.push({ method, path, params, key: opts?.idempotencyKey });
      if (params?.items?.[0]?.quantity !== undefined) subscription.items.data[0].quantity = params.items[0].quantity;
      if (params?.pause_collection !== undefined) {
        subscription.pause_collection = params.pause_collection === "" ? null : params.pause_collection;
      }
      if (params?.metadata) {
        for (const [k, v] of Object.entries(params.metadata)) {
          if (v === "") delete subscription.metadata[k];
          else subscription.metadata[k] = v;
        }
      }
      return structuredClone(subscription);
    }),
  };
});

// ───── Banco simulado ─────
let activeListings = 0;
const upserts: any[] = [];
vi.mock("@/lib/billing/connected-listings.server", () => ({
  loadConnectedListings: vi.fn(async () =>
    Array.from({ length: activeListings }, (_, i) => ({ listingId: `L${i}`, name: "x", kind: "primary", propertyName: "x" })),
  ),
}));
vi.mock("@/lib/audit/platform.server", () => ({ auditBilling: vi.fn(async () => undefined) }));
vi.mock("@/lib/plan-guard.server", () => ({ invalidateOwnerPlanCache: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    not: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: { id: "row1", stripe_subscription_id: "sub_1", status: "active" }, error: null }),
    upsert: async (row: any) => {
      upserts.push(row);
      return { error: null };
    },
  };
  return { supabaseAdmin: { from: () => chain } };
});

const { syncListingBilling } = await import("../billing-sync.server");

const PERIOD_START = Math.floor(Date.now() / 1000) - 10 * 86_400;

function freshSubscription(quantity: number) {
  return {
    id: "sub_1",
    status: "active",
    customer: "cus_1",
    metadata: { user_id: "owner-1" } as Record<string, string>,
    cancel_at_period_end: false,
    pause_collection: null as any,
    items: {
      data: [
        {
          id: "si_1",
          quantity,
          current_period_start: PERIOD_START,
          current_period_end: PERIOD_START + 30 * 86_400,
          price: { id: "price_1", product: "prod_1" },
        },
      ],
    },
  };
}

beforeEach(() => {
  calls.length = 0;
  upserts.length = 0;
});

describe("syncListingBilling (Stripe e banco simulados)", () => {
  it("zero anúncios: pausa, não envia quantidade e grava a pausa no espelho", async () => {
    subscription = freshSubscription(4);
    activeListings = 0;
    const r = await syncListingBilling("owner-1", "test");
    expect(r.decision).toBe("pause_zero");
    expect(calls).toHaveLength(1);
    expect(calls[0].params.pause_collection).toEqual({ behavior: "void" });
    expect(calls[0].params.items).toBeUndefined();
    expect(upserts.at(-1)).toMatchObject({ billing_paused: true, listing_quantity: 4, user_id: "owner-1" });
  });

  it("repetir a sincronização no mesmo estado não faz nova chamada", async () => {
    activeListings = 0;
    const r = await syncListingBilling("owner-1", "test");
    expect(r.decision).toBe("noop");
    expect(calls).toHaveLength(0);
  });

  it("reativa no mesmo ciclo: retoma sem cobrar", async () => {
    activeListings = 2;
    const r = await syncListingBilling("owner-1", "test");
    expect(r.decision).toBe("resume_same_cycle");
    expect(calls.some((c) => c.params.proration_behavior === "always_invoice")).toBe(false);
    expect(calls.some((c) => c.params.billing_cycle_anchor === "now")).toBe(false);
    expect(subscription.pause_collection).toBeNull();
    expect(subscription.items.data[0].quantity).toBe(2);
  });

  it("depois volta para 6: cobra só o que passa dos 4 já pagos", async () => {
    activeListings = 6;
    await syncListingBilling("owner-1", "test");
    const charged = calls.filter((c) => c.params.proration_behavior === "always_invoice");
    expect(calls[0].params).toMatchObject({ items: [{ id: "si_1", quantity: 4 }], proration_behavior: "none" });
    expect(charged).toHaveLength(1);
    expect(charged[0].params.items[0].quantity).toBe(6);
    expect(subscription.metadata.cycle_max_qty).toBe("6");
  });

  it("zero e reativação depois de um ciclo não pago: cobra hoje e reinicia o ciclo", async () => {
    subscription = freshSubscription(3);
    subscription.pause_collection = { behavior: "void" };
    subscription.metadata.zero_since = String(PERIOD_START - 86_400);
    activeListings = 1;
    const r = await syncListingBilling("owner-1", "test");
    expect(r.decision).toBe("resume_new_cycle_charge_today");
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toMatchObject({
      pause_collection: "",
      billing_cycle_anchor: "now",
      proration_behavior: "none",
      items: [{ id: "si_1", quantity: 1 }],
    });
  });

  it("toda chamada de escrita leva chave de idempotência", async () => {
    subscription = freshSubscription(2);
    activeListings = 9;
    await syncListingBilling("owner-1", "test");
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c.key).toMatch(/^listing-sync:sub_1:/);
  });
});
