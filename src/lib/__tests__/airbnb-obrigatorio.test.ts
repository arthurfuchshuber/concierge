import { describe, it, expect } from "vitest";
import { missingPublishFields } from "@/lib/publish-requirements";
import { PLANS } from "@/lib/payments.shared";

/**
 * Anúncio do Airbnb obrigatório (01/10/2026): exigido para PUBLICAR.
 */
describe("anúncio do Airbnb obrigatório para publicar", () => {
  it("sem anúncio, a publicação aponta o que falta", () => {
    expect(missingPublishFields({})).toContain("Anúncio do Airbnb (importar na aba Airbnb)");
  });

  it("com anúncio, o item some da lista", () => {
    expect(
      missingPublishFields({ airbnb_listing_url: "https://www.airbnb.com.br/rooms/1" }),
    ).not.toContain("Anúncio do Airbnb (importar na aba Airbnb)");
  });
});

describe("plano Starter excluído", () => {
  it("não existe mais, e todo plano à venda tem a importação do Airbnb", () => {
    expect(Object.keys(PLANS)).toEqual(["pro", "business", "enterprise"]);
    for (const plan of Object.values(PLANS)) expect(plan.features.autoImport).toBe(true);
  });
});
