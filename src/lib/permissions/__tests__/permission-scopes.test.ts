import { describe, expect, it } from "vitest";
import { bootstrapPermissionRegistry } from "@/lib/permissions/permission.bootstrap";
import { permissionRegistry } from "@/lib/permissions/permission.registry";
import { evaluate } from "@/lib/permissions/permission.engine";
import { resolveOutcome } from "@/lib/permissions/permission.enforce.server";
import type { PermissionAssignment } from "@/lib/permissions/permission.types";

bootstrapPermissionRegistry();

const SLUG = permissionRegistry.list().find((n) => n.isPermissionable !== false)!.slug;
const NODE_ID = "node-1";
const subject = { userId: "member", tenantId: "tenant", systemRoles: [], plan: null };

function assignment(over: Partial<PermissionAssignment> = {}): PermissionAssignment {
  return {
    id: "a1",
    tenant_id: "tenant",
    user_id: "member",
    permission_node_id: NODE_ID,
    access_level: "WRITE",
    scope_type: "PROPERTY",
    scope_id: "prop-1",
    ...over,
  } as PermissionAssignment;
}

describe("Escopos e acesso efetivo (FASE 4.3)", () => {
  it("escopo PROPERTY restringe o acesso ao imóvel vinculado", () => {
    const input = {
      subject,
      nodeSlug: SLUG,
      required: "READ" as const,
      assignments: [assignment()],
      nodeIdBySlug: { [SLUG]: NODE_ID },
    };

    const allowed = evaluate({ ...input, scope: { type: "PROPERTY", id: "prop-1" } });
    const denied = evaluate({ ...input, scope: { type: "PROPERTY", id: "prop-2" } });

    expect(allowed.allowed).toBe(true);
    expect(denied.allowed).toBe(false);
    expect(denied.effective).toBe("NONE");
  });

  it("remoção da atribuição elimina o acesso efetivo", () => {
    const after = evaluate({
      subject,
      nodeSlug: SLUG,
      required: "READ",
      scope: { type: "PROPERTY", id: "prop-1" },
      assignments: [],
      nodeIdBySlug: { [SLUG]: NODE_ID },
    });

    expect(after.allowed).toBe(false);
    expect(after.effective).toBe("NONE");
  });

  it("usuário inativo não recebe acesso, mesmo em modo progressivo", () => {
    const decision = {
      allowed: false,
      effective: "NONE" as const,
      required: "READ" as const,
      permission: SLUG,
      reason: "Sem acesso.",
      scope: { type: "TENANT" as const },
      source: "default" as const,
    };

    const inactive = resolveOutcome(decision, { assignments: [], status: "revoked" }, "progressive");
    expect(inactive.allowed).toBe(false);
    expect(inactive.enforced).toBe(true);
  });
});
