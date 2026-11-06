import { describe, expect, it } from "vitest";
import {
  cycleMaxFromMetadata,
  decideBillingAction,
  displayUnitCents,
  monthlyTotalCents,
  type BillingSubscriptionState,
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
    expect(d.steps.some((s) => s.billingCycleAnchorNow)).toBe(false);
  });

  it("depois que um ciclo não pago começou: cobra hoje e reinicia o ciclo", () => {
    const d = decideBillingAction(2, state({ paused: true, zeroSince: PERIOD - 86_400 }), NOW);
    expect(d.kind).toBe("resume_new_cycle_charge_today");
    expect(d.steps).toHaveLength(1);
    expect(d.steps[0]).toMatchObject({ pause: false, quantity: 2, billingCycleAnchorNow: true, prorationBehavior: "none" });
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
