import { describe, expect, it } from "vitest";
import { isChargedExtra } from "@/lib/service-situations.functions";

describe("serviços extras: só com custo > 0", () => {
  it("exclui custo nulo, indefinido, zero e negativo", () => {
    expect(isChargedExtra(null)).toBe(false);
    expect(isChargedExtra(undefined)).toBe(false);
    expect(isChargedExtra(0)).toBe(false);
    expect(isChargedExtra(-100)).toBe(false);
  });
  it("inclui qualquer custo positivo", () => {
    expect(isChargedExtra(1)).toBe(true);
    expect(isChargedExtra(15000)).toBe(true);
  });
});
