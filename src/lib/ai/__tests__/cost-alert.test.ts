import { describe, expect, it } from "vitest";
import { dayKeyBR, detectCostSpike } from "@/lib/ai/cost-alert";

describe("aviso de gasto atípico da IA", () => {
  it("avisa quando hoje passa de 2x a média e do piso", () => {
    const r = detectCostSpike(6, [2, 2.5, 3, 2.5]);
    expect(r.spike).toBe(true);
    expect(r.baselineUsd).toBeCloseTo(2.5, 4);
    expect(r.ratio).toBeCloseTo(2.4, 1);
  });
  it("não avisa abaixo do piso em dólares, mesmo com razão alta", () => {
    expect(detectCostSpike(0.5, [0.05, 0.05, 0.05]).spike).toBe(false);
  });
  it("não avisa sem histórico suficiente nem dentro do normal", () => {
    expect(detectCostSpike(10, [1, 1]).spike).toBe(false);
    expect(detectCostSpike(3, [2, 2.5, 3, 2.5]).spike).toBe(false);
  });
  it("dia de Brasília: 01:00 UTC ainda é o dia anterior", () => {
    expect(dayKeyBR("2026-10-31T01:00:00Z")).toBe("2026-10-30");
    expect(dayKeyBR("2026-10-31T15:00:00Z")).toBe("2026-10-31");
  });
});
