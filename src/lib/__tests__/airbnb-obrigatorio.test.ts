import { describe, it, expect } from "vitest";
import { missingPublishFields } from "@/lib/publish-requirements";
import { ALL_FEATURES } from "@/lib/billing/plan";

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

describe("plano único por anúncio (06/11/2026)", () => {
  it("toda assinatura ativa tem a importação do Airbnb", () => {
    expect(ALL_FEATURES.autoImport).toBe(true);
  });
});
