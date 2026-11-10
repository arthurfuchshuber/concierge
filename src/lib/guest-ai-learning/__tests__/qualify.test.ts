import { describe, expect, it } from "vitest";
import { planQualification, type PropertyRef } from "../qualify";

const P = (id: string, ownerId: string | null, city: string | null, archived = false): PropertyRef => ({ id, ownerId, city, archived });
const origin = P("p1", "dono", "Foz do Iguaçu");
const props = [
  origin,
  P("p2", "dono", "foz do iguacu"),
  P("p3", "dono", "Curitiba"),
  P("p4", "outro-dono", "Foz do Iguaçu"),
  P("p5", "dono", "Foz do Iguaçu", true),
];

describe("escopo do aprendizado (réplicas)", () => {
  it("só este imóvel ⇒ sem réplica", () => {
    expect(planQualification({ scope: "property", origin }, props)).toEqual({ replicateTo: [] });
  });
  it("definitiva · mesma cidade ⇒ só imóveis do MESMO dono na mesma cidade (sem acento/caixa), nunca arquivados", () => {
    expect(planQualification({ scope: "city", origin }, props).replicateTo).toEqual(["p2"]);
  });
  it("definitiva · todos os imóveis da conta ⇒ todos do mesmo dono, nunca de outra conta", () => {
    expect(planQualification({ scope: "account", origin }, props).replicateTo.sort()).toEqual(["p2", "p3"]);
  });
  it("imóvel de origem sem cidade: escopo cidade não replica; sem dono, não replica", () => {
    expect(planQualification({ scope: "city", origin: P("p1", "dono", null) }, props).replicateTo).toEqual([]);
    expect(planQualification({ scope: "account", origin: P("p1", null, "Foz") }, props).replicateTo).toEqual([]);
  });
});

import { inferScope, SCOPE_LABEL } from "../qualify";
describe("escopo atual deduzido das réplicas", () => {
  it("sem réplica ⇒ imóvel; só mesma cidade ⇒ cidade; outras cidades ⇒ conta", () => {
    expect(inferScope(origin, [], props)).toBe("property");
    expect(inferScope(origin, ["p2"], props)).toBe("city");
    expect(inferScope(origin, ["p2", "p3"], props)).toBe("account");
    expect(SCOPE_LABEL.city).toBe("Cidade");
  });
  it("dono com imóveis numa cidade só: réplica para todos conta como conta", () => {
    expect(inferScope(origin, ["p2"], [origin, P("p2", "dono", "Foz do Iguaçu")])).toBe("account");
  });
});
