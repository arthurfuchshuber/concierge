import { describe, expect, it } from "vitest";
import { missingPublishFields } from "@/lib/publish-requirements";
import { missingRequiredHouseFields } from "@/lib/property-house-fields";

// Pedido de 01/10/2026: com "Condomínio?" ligado, os 4 campos são obrigatórios.
const base = {
  property_type_id: "t",
  maps_url: "x",
  address: "a",
  city: "c",
  country: "b",
  airbnb_ical_url: "u",
};

describe("Condomínio obrigatório", () => {
  it("desligado: nada é exigido", () => {
    expect(missingRequiredHouseFields({ ...base, in_condominium: false })).toEqual([]);
    expect(
      missingPublishFields({ in_condominium: false }).some((m) => m.startsWith("Condomínio")),
    ).toBe(false);
  });
  it("ligado e vazio: exige os 4", () => {
    const m = missingRequiredHouseFields({
      ...base,
      in_condominium: true,
      apartment_number: "",
      apartment_floor: " ",
      parking_spots: [""],
      has_elevator: null,
    });
    expect(m).toHaveLength(4);
    expect(
      missingPublishFields({ in_condominium: true }).filter((x) => x.startsWith("Condomínio")),
    ).toHaveLength(4);
  });
  it("ligado e completo: passa (elevador 'Não tem' conta como resposta)", () => {
    expect(
      missingRequiredHouseFields({
        ...base,
        in_condominium: true,
        apartment_number: "302",
        apartment_floor: "3",
        parking_spots: ["14"],
        has_elevator: false,
      }),
    ).toEqual([]);
  });
});
