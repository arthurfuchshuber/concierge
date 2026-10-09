import { describe, expect, it } from "vitest";
import { listingTitle, stableStringify } from "./channex-entity-sync.server";

describe("channex entity sync", () => {
  it("usa só o nome público do anúncio, sem o prefixo da conta", () => {
    expect(listingTitle("45999185227 101.Clayton Chagas · Studio n° 101 Completo Próx. ao Paraguai")).toBe(
      "Studio n° 101 Completo Próx. ao Paraguai",
    );
    expect(listingTitle("Conforto no centro de Foz - 3 Quartos")).toBe("Conforto no centro de Foz - 3 Quartos");
  });
  it("detecta mudança independente da ordem das chaves", () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });
});
