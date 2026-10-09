import { describe, expect, it } from "vitest";
import { listingTitle, roomTypeName, stableStringify } from "./channex-entity-sync.server";

describe("channex entity sync", () => {
  it("extrai o nome público do anúncio", () => {
    expect(listingTitle("45999185227 101.Clayton Chagas · Studio n° 101 Completo Próx. ao Paraguai")).toBe(
      "Studio n° 101 Completo Próx. ao Paraguai",
    );
    expect(listingTitle("Conforto no centro de Foz - 3 Quartos")).toBe("Conforto no centro de Foz - 3 Quartos");
  });
  it("nomeia o quarto como [Nome interno] - [Título do anúncio]", () => {
    expect(roomTypeName("45998276006 Arthur Tenório · Casa Charmosa Próx. a Avenida das Cataratas")).toBe(
      "45998276006 Arthur Tenório - Casa Charmosa Próx. a Avenida das Cataratas",
    );
    expect(roomTypeName("Conforto no centro de Foz - 3 Quartos")).toBe("Conforto no centro de Foz - 3 Quartos");
  });
  it("detecta mudança independente da ordem das chaves", () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });
});
