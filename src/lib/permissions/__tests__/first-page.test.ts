import { describe, expect, it } from "vitest";
import { firstAllowedPage } from "../firstPage";

const only = (...ps: string[]) => (p: string) => ps.includes(p);

describe("primeira página do menu", () => {
  it("quem tem Dashboard cai no Dashboard (Operacional)", () => {
    expect(firstAllowedPage(only("tenant.dashboard", "tenant.guias", "tenant.atendimento"))).toBe("/admin/dashboard");
  });
  it("sem Dashboard, segue a ordem do menu: Stakeholders antes de Guias", () => {
    expect(firstAllowedPage(only("tenant.guias", "tenant.stakeholders"))).toBe("/admin/proprietarios");
  });
  it("só Atendimento ou só Administrativo", () => {
    expect(firstAllowedPage(only("tenant.atendimento"))).toBe("/admin/atendimento");
    expect(firstAllowedPage(only("tenant.administrativo"))).toBe("/admin/administrativo");
  });
  it("sem nenhuma permissão não há página", () => {
    expect(firstAllowedPage(() => false)).toBeNull();
  });
});
