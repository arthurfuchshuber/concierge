import { describe, expect, it } from "vitest";
import { missingPublishFields } from "@/lib/publish-requirements";

// Pedido de 01/10/2026: com "Condomínio?" ligado, os 4 campos são exigidos para PUBLICAR.
// (A trava de edição baseada em `missingRequiredHouseFields` saiu com as abas antigas, 29/10/2026.)
describe("Condomínio obrigatório para publicar", () => {
  it("desligado: nada é exigido", () => {
    expect(
      missingPublishFields({ in_condominium: false }).some((m) => m.startsWith("Condomínio")),
    ).toBe(false);
  });
  it("ligado e vazio: exige os 4", () => {
    expect(
      missingPublishFields({ in_condominium: true }).filter((x) => x.startsWith("Condomínio")),
    ).toHaveLength(4);
  });
});
