import { describe, expect, it } from "vitest";
import { bootstrapPermissionRegistry } from "@/lib/permissions/permission.bootstrap";
import { evaluate } from "@/lib/permissions/permission.engine";
import type { PermissionAssignment } from "@/lib/permissions/permission.types";

const TENANT = "11111111-1111-1111-1111-111111111111";
const MEMBER = "22222222-2222-2222-2222-222222222222";
const NODE = "33333333-3333-3333-3333-333333333333";

const denyImoveis: PermissionAssignment = {
  id: "a1",
  tenant_id: TENANT,
  user_id: MEMBER,
  permission_node_id: NODE,
  access_level: "NONE",
  scope_type: "TENANT",
  scope_id: null,
} as unknown as PermissionAssignment;

describe("administrador do SaaS que também é membro da conta", () => {
  bootstrapPermissionRegistry();
  const nodeIdBySlug = { "tenant.imoveis": NODE };

  it("respeita a negação da conta em recursos tenant.*", () => {
    const decision = evaluate({
      subject: {
        userId: MEMBER,
        tenantId: TENANT,
        systemRoles: ["ADMIN_SAAS"],
        plan: "business",
        isTenantMember: true,
      },
      nodeSlug: "tenant.imoveis",
      required: "READ",
      scope: { type: "TENANT", id: null },
      assignments: [denyImoveis],
      nodeIdBySlug,
    });
    expect(decision.allowed).toBe(false);
  });

  it("mantém o bypass quando não é membro daquela conta", () => {
    const decision = evaluate({
      subject: {
        userId: MEMBER,
        tenantId: MEMBER,
        systemRoles: ["ADMIN_SAAS"],
        plan: "business",
        isTenantMember: false,
      },
      nodeSlug: "tenant.imoveis",
      required: "WRITE",
      scope: { type: "TENANT", id: null },
      assignments: [],
      nodeIdBySlug,
    });
    expect(decision.allowed).toBe(true);
  });
});
