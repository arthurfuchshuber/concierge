import { describe, expect, it } from "vitest";
import {
  cycleMaxFromMetadata,
  decideBillingAction,
  displayUnitCents,
  monthlyTotalCents,
  nextBillingAnchor,
  proratedCents,
  stripeTiersFor,
  STANDARD_TERMS,
  type BillingSubscriptionState,
  type BillingTerms,
} from "../listing-billing";

const NOW = 1_800_000_000;
const PERIOD = NOW - 10 * 86_400; // ciclo começou há 10 dias

function state(p: Partial<BillingSubscriptionState> = {}): BillingSubscriptionState {
  return {
    status: "active",
    quantity: 5,
    paused: false,
    zeroSince: null,
    periodStart: PERIOD,
    periodEnd: PERIOD + 30 * 86_400,
    cycleMaxPaid: 5,
    ...p,
  };
}

describe("tabela por anúncio (confere com a simulação da Stripe em 06/11/2026)", () => {
  it.each([
    [0, 0],
    [1, 35_700],
    [3, 35_700],
    [4, 47_600],
    [29, 345_100],
    [30, 297_000],
    [39, 386_100],
    [40, 384_000],
    [50, 445_000],
  ])("%i anúncios → %i centavos", (n, cents) => {
    expect(monthlyTotalCents(n)).toBe(cents);
  });

  it("mostra R$ 119 por anúncio na faixa do piso", () => {
    expect(displayUnitCents(1)).toBe(11_900);
    expect(displayUnitCents(35)).toBe(9_900);
  });
});

describe("blindagem do zero", () => {
  it("nunca envia quantidade 0: pausa a cobrança", () => {
    const d = decideBillingAction(0, state(), NOW);
    expect(d.kind).toBe("pause_zero");
    for (const step of d.steps) expect(step.quantity ?? 1).toBeGreaterThan(0);
    expect(d.steps[0].pause).toBe(true);
    expect(d.steps[0].metadata?.zero_since).toBe(String(NOW));
  });

  it("zero de novo com a cobrança já pausada não faz nada", () => {
    expect(decideBillingAction(0, state({ paused: true, zeroSince: NOW - 5 }), NOW).kind).toBe("noop");
  });

  it("nenhuma combinação de entrada produz quantidade < 1", () => {
    for (const count of [0, 1, 2, 3, 4, 30, 51]) {
      for (const paused of [false, true]) {
        for (const zeroSince of [null, PERIOD - 1, PERIOD + 1]) {
          for (const qty of [1, 3, 7]) {
            const d = decideBillingAction(count, state({ paused, zeroSince, quantity: qty, cycleMaxPaid: qty }), NOW);
            for (const s of d.steps) if (s.quantity !== undefined) expect(s.quantity).toBeGreaterThanOrEqual(1);
          }
        }
      }
    }
  });
});

describe("reativação", () => {
  it("dentro do ciclo já pago: retoma sem cobrar", () => {
    const d = decideBillingAction(3, state({ paused: true, zeroSince: PERIOD + 86_400 }), NOW);
    expect(d.kind).toBe("resume_same_cycle");
    expect(d.steps[0].pause).toBe(false);
    expect(d.steps.some((s) => s.prorationBehavior === "always_invoice")).toBe(false);
    expect(d.charge).toBeUndefined();
  });

  it("depois que um ciclo não pago começou: cobra hoje só o proporcional até o próximo dia 25", () => {
    const d = decideBillingAction(2, state({ paused: true, zeroSince: PERIOD - 86_400 }), NOW);
    expect(d.kind).toBe("resume_charge_prorated_to_anchor");
    expect(d.steps).toEqual([
      expect.objectContaining({ pause: false, quantity: 2, prorationBehavior: "none" }),
    ]);
    // 20 de 30 dias restantes × R$ 357 (piso) = R$ 238,00
    expect(d.charge).toMatchObject({ amountCents: 23_800, periodStart: NOW, periodEnd: PERIOD + 30 * 86_400 });
  });

  it("reativação com cortesia total não gera cobrança avulsa", () => {
    const d = decideBillingAction(2, state({ paused: true, zeroSince: PERIOD - 86_400 }), NOW, { ...STANDARD_TERMS, courtesy: true });
    expect(d.kind).toBe("resume_charge_prorated_to_anchor");
    expect(d.charge).toBeUndefined();
  });

  it("durante a carência só acompanha a quantidade, sem cobrança proporcional", () => {
    const d = decideBillingAction(9, state({ status: "trialing" }), NOW);
    expect(d.steps).toEqual([{ quantity: 9, prorationBehavior: "none" }]);
  });

  it("dentro do ciclo, acima do já pago: cobra só a diferença", () => {
    const d = decideBillingAction(8, state({ paused: true, zeroSince: PERIOD + 86_400, quantity: 5, cycleMaxPaid: 5 }), NOW);
    const charged = d.steps.filter((s) => s.prorationBehavior === "always_invoice");
    expect(charged).toHaveLength(1);
    expect(charged[0].quantity).toBe(8);
  });
});

describe("mudanças no meio do ciclo", () => {
  it("aumento: cobra proporcional na hora", () => {
    const d = decideBillingAction(8, state(), NOW);
    expect(d.kind).toBe("update_same_cycle");
    expect(d.steps).toEqual([
      { quantity: 8, prorationBehavior: "always_invoice", metadata: { cycle_start: String(PERIOD), cycle_max_qty: "8" } },
    ]);
  });

  it("redução: ajusta sem devolver nada e guarda o máximo já pago", () => {
    const d = decideBillingAction(3, state(), NOW);
    expect(d.steps).toEqual([
      { quantity: 3, prorationBehavior: "none", metadata: { cycle_start: String(PERIOD), cycle_max_qty: "5" } },
    ]);
  });

  it("reduz e volta a subir no mesmo ciclo: não cobra de novo o que já foi pago", () => {
    const d = decideBillingAction(5, state({ quantity: 3, cycleMaxPaid: 5 }), NOW);
    expect(d.steps.some((s) => s.prorationBehavior === "always_invoice")).toBe(false);
    expect(d.steps.at(-1)?.quantity).toBe(5);
  });

  it("reduz e sobe além do já pago: primeiro volta ao pago sem cobrar, depois cobra só o excedente", () => {
    const d = decideBillingAction(7, state({ quantity: 3, cycleMaxPaid: 5 }), NOW);
    expect(d.steps).toEqual([
      { quantity: 5, prorationBehavior: "none" },
      { quantity: 7, prorationBehavior: "always_invoice", metadata: { cycle_start: String(PERIOD), cycle_max_qty: "7" } },
    ]);
  });

  it("mesma quantidade: nada a fazer", () => {
    expect(decideBillingAction(5, state(), NOW).kind).toBe("noop");
  });

  it("assinatura cancelada: nunca mexe", () => {
    expect(decideBillingAction(9, state({ status: "canceled" }), NOW).kind).toBe("noop");
  });
});

describe("máximo pago no ciclo", () => {
  it("vale só para o ciclo gravado", () => {
    expect(cycleMaxFromMetadata({ cycle_start: String(PERIOD), cycle_max_qty: "9" }, PERIOD, 4)).toBe(9);
    expect(cycleMaxFromMetadata({ cycle_start: String(PERIOD - 1), cycle_max_qty: "9" }, PERIOD, 4)).toBe(4);
    expect(cycleMaxFromMetadata(null, PERIOD, 4)).toBe(4);
  });
});

describe("vencimento único no dia 25 (00:00 de Brasília = 03:00 UTC)", () => {
  const at = (iso: string) => Date.parse(iso) / 1000;
  it.each([
    ["2026-11-20T15:00:00Z", "2026-11-25T03:00:00Z"],
    ["2026-11-25T02:59:59Z", "2026-11-25T03:00:00Z"],
    ["2026-11-25T03:00:00Z", "2026-12-25T03:00:00Z"],
    ["2026-11-26T10:00:00Z", "2026-12-25T03:00:00Z"],
    ["2026-12-31T12:00:00Z", "2027-01-25T03:00:00Z"],
  ])("de %s → %s", (from, to) => {
    expect(nextBillingAnchor(at(from))).toBe(at(to));
  });

  it("contratou dia 20: paga hoje o proporcional de 5 dias até o dia 25", () => {
    const start = at("2026-10-25T03:00:00Z");
    const end = at("2026-11-25T03:00:00Z");
    const from = at("2026-11-20T03:00:00Z");
    expect(proratedCents(35_700, from, start, end)).toBe(Math.round((35_700 * 5) / 31));
  });
});

describe("condição comercial negociada", () => {
  const T = (t: Partial<BillingTerms>): BillingTerms => ({ ...STANDARD_TERMS, ...t });

  it("valor fixo por anúncio: anúncios × valor, respeitando o piso", () => {
    expect(monthlyTotalCents(10, T({ unitCents: 7_500 }))).toBe(75_000);
    expect(monthlyTotalCents(2, T({ unitCents: 7_500 }))).toBe(22_500); // piso padrão 3
    expect(monthlyTotalCents(2, T({ unitCents: 7_500, minUnits: 1 }))).toBe(15_000);
    expect(monthlyTotalCents(2, T({ unitCents: 7_500, minUnits: 5 }))).toBe(37_500);
    expect(displayUnitCents(2, T({ unitCents: 7_500 }))).toBe(7_500);
  });

  it("tabela oficial com piso diferente", () => {
    expect(monthlyTotalCents(1, T({ minUnits: 1 }))).toBe(11_900);
    expect(monthlyTotalCents(3, T({ minUnits: 5 }))).toBe(59_500);
    expect(monthlyTotalCents(35, T({ minUnits: 5 }))).toBe(346_500);
  });

  it("cortesia total: nada a pagar", () => {
    expect(monthlyTotalCents(12, T({ courtesy: true }))).toBe(0);
  });

  // A tabela que vai para a Stripe precisa cobrar exatamente o que a tela mostra.
  function stripeVolumeTotal(tiers: ReturnType<typeof stripeTiersFor>, qty: number): number {
    const t = tiers.find((x) => x.up_to === "inf" || qty <= x.up_to)!;
    return (t.flat_amount ?? 0) + t.unit_amount * qty;
  }
  it.each([
    [STANDARD_TERMS],
    [T({ unitCents: 7_500 })],
    [T({ unitCents: 7_500, minUnits: 1 })],
    [T({ unitCents: 9_000, minUnits: 8 })],
    [T({ minUnits: 1 })],
    [T({ minUnits: 5 })],
    [T({ minUnits: 33 })],
  ])("faixas da Stripe = valor da tela para %o", (terms) => {
    const tiers = stripeTiersFor(terms);
    for (const q of [1, 2, 3, 4, 5, 8, 29, 30, 33, 39, 40, 49, 50, 80]) {
      expect(stripeVolumeTotal(tiers, q)).toBe(monthlyTotalCents(q, terms));
    }
  });

  it("a tabela oficial gera exatamente as faixas do preço vigente na Stripe", () => {
    expect(stripeTiersFor(STANDARD_TERMS)).toEqual([
      { up_to: 3, unit_amount: 0, flat_amount: 35_700 },
      { up_to: 29, unit_amount: 11_900 },
      { up_to: 39, unit_amount: 9_900 },
      { up_to: 49, unit_amount: 9_600 },
      { up_to: "inf", unit_amount: 8_900 },
    ]);
  });
});
