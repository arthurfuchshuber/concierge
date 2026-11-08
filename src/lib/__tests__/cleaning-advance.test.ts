import { describe, expect, it } from "vitest";
import { cleaningAdvanceDecision } from "../cleaning-advance";

describe("cleaningAdvanceDecision — conclusão direta da limpeza", () => {
  it("nenhum tipo cadastrado: conclui direto, sem tipo e sem janela", () => {
    expect(cleaningAdvanceDecision({ cleaningPriceNormalCents: null, cleaningPriceFullCents: 0 })).toEqual({
      ask: false,
      cleaningType: undefined,
    });
  });
  it("só Normal: conclui direto como normal", () => {
    expect(cleaningAdvanceDecision({ cleaningPriceNormalCents: 12000, cleaningPriceFullCents: null })).toEqual({
      ask: false,
      cleaningType: "normal",
    });
  });
  it("só Completa: conclui direto como completa", () => {
    expect(cleaningAdvanceDecision({ cleaningPriceNormalCents: 0, cleaningPriceFullCents: 18000 })).toEqual({
      ask: false,
      cleaningType: "completa",
    });
  });
  it("os dois tipos: abre a janela para escolher", () => {
    expect(cleaningAdvanceDecision({ cleaningPriceNormalCents: 12000, cleaningPriceFullCents: 18000 })).toEqual({
      ask: true,
    });
  });
});
