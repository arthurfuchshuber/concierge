import { describe, it, expect } from "vitest";
import { bootstrapPermissionRegistry } from "@/lib/permissions/permission.bootstrap";
import { permissionRegistry } from "@/lib/permissions/permission.registry";
import { evaluate } from "@/lib/permissions/permission.engine";

describe("real", () => {
  it("deny imoveis", () => {
    bootstrapPermissionRegistry();
    console.log("has tenant.imoveis", permissionRegistry.has("tenant.imoveis"), JSON.stringify(permissionRegistry.get("tenant.imoveis")));
    console.log("ancestors", permissionRegistry.ancestors("tenant.imoveis").map(n=>n.slug));
    const nodeIdBySlug = { "tenant.imoveis": "43f8557e-270f-42a7-8745-4e1899736752", tenant: "TENANTID" };
    const d = evaluate({
      subject: { userId: "ad2c848e-7395-4cba-ab9e-db697ccd94d3", tenantId: "25239e5b-1a66-46f1-b9a2-829c499cc366", systemRoles: [], plan: "business" },
      nodeSlug: "tenant.imoveis", required: "READ", scope: { type: "TENANT", id: null },
      assignments: [{ id: "1", tenant_id: "25239e5b-1a66-46f1-b9a2-829c499cc366", user_id: "ad2c848e-7395-4cba-ab9e-db697ccd94d3", permission_node_id: "43f8557e-270f-42a7-8745-4e1899736752", access_level: "NONE", scope_type: "TENANT", scope_id: null } as never],
      nodeIdBySlug,
    });
    console.log("decision", d);
    expect(d.allowed).toBe(false);
  });
});
