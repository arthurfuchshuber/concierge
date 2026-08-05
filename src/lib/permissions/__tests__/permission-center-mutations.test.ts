import { beforeEach, describe, expect, it, vi } from "vitest";

/* ------------------------------------------------------------------ mocks */

const requireAccess = vi.fn();

class FakePermissionError extends Error {
  code = "PERMISSION_DENIED" as const;
}

vi.mock("@/lib/permissions/permission.enforce.server", () => ({
  requireAccess: (...args: unknown[]) => requireAccess(...args),
  PermissionEnforcementError: FakePermissionError,
}));

const snapshot = { subject: { userId: "actor", tenantId: "tenant", systemRoles: [], plan: null } };
vi.mock("@/lib/permissions/permission.resolve.server", () => ({
  resolveSubjectSnapshot: vi.fn(async () => snapshot),
  resolveTenantOf: vi.fn(async () => ({ tenantId: "tenant", status: "active", role: "owner" })),
}));

const upsertAssignment = vi.fn(async () => ({}));
const deleteAssignment = vi.fn(async () => undefined);
const recordAudit = vi.fn(async () => undefined);
const listAssignments = vi.fn(async () => [
  {
    id: "a1",
    tenant_id: "tenant",
    user_id: "member",
    permission_node_id: "node-1",
    access_level: "WRITE",
    scope_type: "TENANT",
    scope_id: null,
  },
]);

vi.mock("@/lib/permissions/permission.repository.server", () => ({
  permissionRepository: {
    nodeIdBySlug: vi.fn(async () => ({ "tenant.atendimento": "node-1" })),
    listAssignments: (...a: unknown[]) => listAssignments(...(a as [])),
    upsertAssignment: (...a: unknown[]) => upsertAssignment(...(a as [])),
    deleteAssignment: (...a: unknown[]) => deleteAssignment(...(a as [])),
    recordAudit: (...a: unknown[]) => recordAudit(...(a as [])),
  },
}));

/** Stub encadeável do cliente admin. */
function table(result: unknown) {
  const chain: Record<string, unknown> = {};
  const proxy: unknown = new Proxy(chain, {
    get(_t, prop) {
      if (prop === "maybeSingle" || prop === "single") return async () => ({ data: result });
      if (prop === "then") return undefined;
      return () => proxy;
    },
  });
  return proxy;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (name: string) => {
      if (name === "profiles") return table({ full_name: "Admin", trade_name: null });
      if (name === "account_members") return table({ role: "agent", status: "active" });
      return table(null);
    },
  },
}));

import {
  grantCenterPermission,
  revokeCenterPermission,
} from "@/lib/permissions/permission.center.mutations.server";

beforeEach(() => {
  requireAccess.mockReset();
  upsertAssignment.mockClear();
  deleteAssignment.mockClear();
  recordAudit.mockClear();
});

/* ------------------------------------------------------------------ testes */

describe("Permission Center — gestão de atribuições (FASE 4.3)", () => {
  it("admin autorizado consegue atribuir uma permissão direta", async () => {
    requireAccess.mockResolvedValue({ allowed: true });

    const res = await grantCenterPermission("actor", {
      targetUserId: "member",
      namespace: "tenant.atendimento",
      level: "WRITE",
    });

    expect(res.ok).toBe(true);
    expect(upsertAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "member", permissionNodeId: "node-1", accessLevel: "WRITE" }),
    );
    // auditoria: usuário alterado, alteração, executor
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: "actor", targetUserId: "member", action: "permission.grant" }),
    );
  });

  it("usuário sem permissão administrativa é bloqueado e nada é gravado", async () => {
    requireAccess.mockRejectedValue(new FakePermissionError("Acesso negado."));

    await expect(
      grantCenterPermission("intruso", {
        targetUserId: "member",
        namespace: "tenant.atendimento",
        level: "WRITE",
      }),
    ).rejects.toBeInstanceOf(FakePermissionError);

    expect(upsertAssignment).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("remoção de permissão direta elimina o grant e é auditada", async () => {
    requireAccess.mockResolvedValue({ allowed: true });

    const res = await revokeCenterPermission("actor", {
      targetUserId: "member",
      assignmentId: "a1",
    });

    expect(res.ok).toBe(true);
    expect(deleteAssignment).toHaveBeenCalledWith("tenant", "a1");
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "permission.revoke", newAccessLevel: "NONE" }),
    );
  });
});
