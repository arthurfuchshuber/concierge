import { describe, expect, it } from "vitest";
import { missingLocationPatch } from "@/lib/channex-entity-sync.server";
import { propertyTimeZoneOrNull } from "@/lib/property-timezone";

describe("localização do imóvel vinda da Channex (casos Nailton e Kelvin, 19/11/2026)", () => {
  it("preenche só o que falta: país da Channex resolve o fuso", () => {
    const patch = missingLocationPatch({ city: "Foz do Iguaçu", state: null, country: null }, { country: "BR", state: null, city: null });
    expect(patch).toEqual({ country: "BR" });
    expect(propertyTimeZoneOrNull("Foz do Iguaçu", patch!.country)).toBe("America/Sao_Paulo");
  });
  it("nunca sobrescreve o cadastro e não muda nada sem dado", () => {
    expect(missingLocationPatch({ city: "Foz do Iguaçu", state: "PR", country: "Brazil" }, { country: "BR", state: "Paraná", city: "Outra" })).toBeNull();
    expect(missingLocationPatch({ city: null, state: null, country: null }, null)).toBeNull();
    expect(missingLocationPatch({ city: null, state: null, country: null }, { country: "  ", city: 3 })).toBeNull();
  });
});
