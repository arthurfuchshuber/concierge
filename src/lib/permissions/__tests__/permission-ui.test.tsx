import { describe, expect, it } from "vitest";
import {
  isPermissionDenied,
  requiredLevelFor,
  toAccessState,
} from "@/lib/permissions/permissionClient";

describe("camada client", () => {
  it("traduz ações para o nível exigido", () => {
    expect(requiredLevelFor("ver")).toBe("READ");
    expect(requiredLevelFor("excluir")).toBe("WRITE");
  });

  it("estado seguro sem decisão", () => {
    expect(toAccessState(undefined, false, true).allowed).toBe(false);
    expect(toAccessState(undefined, true).allowed).toBe(false);
  });

  it("reconhece PERMISSION_DENIED", () => {
    expect(isPermissionDenied({ code: "PERMISSION_DENIED", permission: "x", reason: "r" })).toBe(true);
    expect(isPermissionDenied(new Error("outro erro"))).toBe(false);
  });
});
