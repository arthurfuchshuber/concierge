import { describe, expect, it } from "vitest";
import { ONE_OFF_NOTE, planQualification, type PropertyRef } from "../qualify";

const P = (id: string, ownerId: string | null, city: string | null, archived = false): PropertyRef => ({ id, ownerId, city, archived });
const origin = P("p1", "dono", "Foz do Iguaçu");
const props = [
  origin,
  P("p2", "dono", "foz do iguacu"),
  P("p3", "dono", "Curitiba"),
  P("p4", "outro-dono", "Foz do Iguaçu"),
  P("p5", "dono", "Foz do Iguaçu", true),
];

describe("qualificação do aprendizado (temporalidade e abrangência)", () => {
  it("pontual/provisória ⇒ recusa com 'Situação pontual', sem réplica", () => {
    expect(planQualification({ temporality: "one_off", scope: "account", origin }, props)).toEqual({ action: "reject", note: ONE_OFF_NOTE, replicateTo: [] });
  });
  it("definitiva · só este imóvel ⇒ aprova sem réplica", () => {
    expect(planQualification({ temporality: "permanent", scope: "property", origin }, props)).toEqual({ action: "approve", note: null, replicateTo: [] });
  });
  it("definitiva · mesma cidade ⇒ só imóveis do MESMO dono na mesma cidade (sem acento/caixa), nunca arquivados", () => {
    expect(planQualification({ temporality: "permanent", scope: "city", origin }, props).replicateTo).toEqual(["p2"]);
  });
  it("definitiva · todos os imóveis da conta ⇒ todos do mesmo dono, nunca de outra conta", () => {
    expect(planQualification({ temporality: "permanent", scope: "account", origin }, props).replicateTo.sort()).toEqual(["p2", "p3"]);
  });
  it("imóvel de origem sem cidade: escopo cidade não replica; sem dono, não replica", () => {
    expect(planQualification({ temporality: "permanent", scope: "city", origin: P("p1", "dono", null) }, props).replicateTo).toEqual([]);
    expect(planQualification({ temporality: "permanent", scope: "account", origin: P("p1", null, "Foz") }, props).replicateTo).toEqual([]);
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
