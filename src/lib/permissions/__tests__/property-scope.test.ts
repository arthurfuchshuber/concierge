import { describe, it, expect, vi, beforeEach } from "vitest";

const snap = vi.fn();
vi.mock("../permission.resolve.server", () => ({ resolveSubjectSnapshot: (...a: unknown[]) => snap(...a) }));

import { filterVisiblePropertyIds, visiblePropertyIds } from "../property-scope.server";

const base = (o: Record<string, unknown>) => ({
  subject: { userId: "u", tenantId: "t", systemRoles: [], isTenantMember: true },
  status: "active",
  allProperties: false,
  properties: [],
  ...o,
});

describe("recorte por imóvel (calendário, cards, listas)", () => {
  beforeEach(() => snap.mockReset());

  it("titular vê tudo da própria conta", async () => {
    expect(await visiblePropertyIds("t", "t")).toBeNull();
  });

  it("prestador vê só os imóveis vinculados", async () => {
    snap.mockResolvedValue(base({ properties: ["a"] }));
    expect(await filterVisiblePropertyIds("u", ["a", "b", "c"], "t")).toEqual(["a"]);
  });

  it("sem vínculo não vê nada", async () => {
    snap.mockResolvedValue(base({ properties: [] }));
    expect(await filterVisiblePropertyIds("u", ["a", "b"], "t")).toEqual([]);
  });

  it("vínculo revogado/de outra empresa não vê nada", async () => {
    snap.mockResolvedValue(base({ status: "revoked", allProperties: true }));
    expect(await filterVisiblePropertyIds("u", ["a"], "outra")).toEqual([]);
  });

  it("usa o recorte da conta ativa", async () => {
    snap.mockResolvedValue(base({ properties: ["x"] }));
    await visiblePropertyIds("u", "t2");
    expect(snap).toHaveBeenCalledWith("u", { tenantId: "t2" });
  });
});
