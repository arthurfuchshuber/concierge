import { describe, expect, it } from "vitest";
import { suggestPairs } from "../airbnb-pair-suggest";

describe("suggestPairs", () => {
  const props = [
    { id: "p1", name: "Apê Aconchegante a 2 km do Centro" },
    { id: "p2", name: "Casa Completa em Bairro Residencial" },
    { id: "p3", name: "Studio 101 · Ponte da Amizade" },
  ];
  it("casa nomes iguais ou parecidos, ignorando acento e pontuação", () => {
    const r = suggestPairs(props, [
      { listingId: "L1", title: "Ape aconchegante a 2 km do centro!" },
      { listingId: "L2", title: "Casa Completa Próx. à Avenida Turística" },
    ]);
    expect(r).toEqual({ p1: "L1" });
  });
  it("nunca usa o mesmo anúncio duas vezes", () => {
    const r = suggestPairs(
      [
        { id: "a", name: "Studio Moderno Centro" },
        { id: "b", name: "Studio Moderno Centro" },
      ],
      [{ listingId: "L", title: "Studio Moderno Centro" }],
    );
    expect(Object.values(r)).toEqual(["L"]);
  });
  it("sem nome parecido não sugere nada", () => {
    expect(suggestPairs(props, [{ listingId: "L", title: "Cobertura Vista Panorâmica" }])).toEqual(
      {},
    );
  });
});
