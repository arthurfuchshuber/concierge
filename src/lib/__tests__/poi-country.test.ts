import { describe, expect, it } from "vitest";
import { countryIsoFromAddress, countryIsoFromText, crossBorderCategory } from "@/lib/poi-country";

// Auditoria das recomendações (24/09/2026): a categoria de fronteira sai
// sozinha pelo país do endereço — e NUNCA aparece numa cidade sem fronteira.
describe("crossBorderCategory", () => {
  it("separa o lugar do Paraguai num guia de Foz do Iguaçu", () => {
    expect(crossBorderCategory("Av. San Blas, Ciudad del Este, Paraguai", "BR")).toBe(
      "No Paraguai",
    );
  });

  it("separa o lugar da Argentina", () => {
    expect(crossBorderCategory("Ruta 12, Puerto Iguazú, Misiones, Argentina", "Brasil")).toBe(
      "Na Argentina",
    );
  });

  it("não mexe em lugar do mesmo país (Ourinhos)", () => {
    expect(
      crossBorderCategory("R. Paraná, 100 - Centro, Ourinhos - SP, 19900-000, Brasil", "BR"),
    ).toBeNull();
  });

  it("endereço sem país não vira categoria de fronteira", () => {
    expect(
      crossBorderCategory("Av. das Cataratas, 1118 - Foz do Iguaçu - PR, 85853-000", "BR"),
    ).toBeNull();
    expect(crossBorderCategory(null, "BR")).toBeNull();
  });

  it("não quebra quando o país da cidade é desconhecido", () => {
    expect(crossBorderCategory("Ciudad del Este, Paraguai", "Narnia")).toBeNull();
  });
});

describe("countryIso*", () => {
  it("reconhece nomes com e sem acento e códigos", () => {
    expect(countryIsoFromText("Bolívia")).toBe("BO");
    expect(countryIsoFromText(" br ")).toBe("BR");
    expect(countryIsoFromAddress("x, y, Uruguay")).toBe("UY");
  });
});
