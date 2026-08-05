import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const overviewMock = vi.fn();
const userMock = vi.fn();
const registryMock = vi.fn();
const scopesMock = vi.fn();
const auditMock = vi.fn();

vi.mock("@/lib/permission-center.functions", () => ({
  getPermissionCenterOverview: "overview",
  getPermissionCenterUser: "user",
  getPermissionCenterRegistry: "registry",
  getPermissionCenterScopes: "scopes",
  getPermissionCenterAudit: "audit",
  createPermissionCenterUser: "createUser",
  assignPermissionCenterRole: "assignRole",
  removePermissionCenterRole: "removeRole",
  setPermissionCenterUserStatus: "setStatus",
  removePermissionCenterUser: "removeUser",
  grantPermissionCenterPermission: "grant",
  revokePermissionCenterPermission: "revoke",
  setPermissionCenterPropertyScope: "setProperty",
}));

vi.mock("@tanstack/react-start", () => ({
  useServerFn: (fn: string) => {
    const map: Record<string, (args?: unknown) => unknown> = {
      overview: overviewMock,
      user: userMock,
      registry: registryMock,
      scopes: scopesMock,
      audit: auditMock,
    };
    if (!map[fn]) return async () => ({ ok: true, message: "ok" });
    return (args?: unknown) => map[fn](args);
  },
}));

import { PermissionCenterPage } from "@/components/admin-pages/PermissionCenterPage";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const ADMIN_OVERVIEW = {
  allowed: true as const,
  context: "saas" as const,
  tenantId: "t1",
  tenantName: "Conta Sigma",
  users: [
    {
      userId: "u1",
      name: "Admin SaaS",
      email: "admin@sigma.com",
      status: "active",
      tenantId: "t1",
      tenantName: "Conta Sigma",
      roles: ["Administrador do SaaS"],
      isOwner: true,
      effectiveCount: 42,
      writeCount: 40,
      propertyCount: 3,
    },
  ],
};

beforeEach(() => {
  overviewMock.mockReset();
  userMock.mockReset();
  registryMock.mockReset();
  scopesMock.mockReset();
  auditMock.mockReset();
  registryMock.mockResolvedValue({ allowed: true, permissions: [] });
  scopesMock.mockResolvedValue({ allowed: true, scopes: [], properties: [] });
  auditMock.mockResolvedValue({ allowed: true, rows: [] });
});

describe("Permission Center", () => {
  it("admin do SaaS acessa e vê os usuários do contexto", async () => {
    overviewMock.mockResolvedValue(ADMIN_OVERVIEW);
    render(<PermissionCenterPage />, { wrapper });
    await waitFor(() => expect(screen.getByText("Admin SaaS")).toBeTruthy());
    expect(screen.getByText("admin@sigma.com")).toBeTruthy();
  });

  it("usuário sem permissão não acessa e não vê dados restritos", async () => {
    overviewMock.mockResolvedValue({
      allowed: false,
      reason: "Sem acesso ao recurso.",
    });
    render(<PermissionCenterPage />, { wrapper });
    await waitFor(() =>
      expect(screen.getByText("Você não tem permissão para gerenciar acessos")).toBeTruthy(),
    );
    expect(screen.queryByText("Admin SaaS")).toBeNull();
    expect(screen.queryByText("admin@sigma.com")).toBeNull();
  });

  it("exibe estado vazio quando não há usuários", async () => {
    overviewMock.mockResolvedValue({ ...ADMIN_OVERVIEW, users: [] });
    render(<PermissionCenterPage />, { wrapper });
    await waitFor(() =>
      expect(screen.getByText("Nenhuma pessoa nesta conta ainda.")).toBeTruthy(),
    );
  });
});

describe("ScopeViewer", () => {
  it("exibe os escopos e imóveis autorizados corretamente", async () => {
    const { ScopeViewer } = await import("@/components/permissions/ScopeViewer");
    render(
      <ScopeViewer
        scopes={[
          { type: "TENANT", description: "Conta", count: 2 },
          { type: "PROPERTY", description: "Residências", count: 1 },
        ]}
        properties={[
          { id: "p1", name: "Casa Azul", assigned: true },
          { id: "p2", name: "Casa Verde", assigned: false },
        ]}
      />,
      { wrapper },
    );
    expect(screen.getByText("TENANT")).toBeTruthy();
    expect(screen.getByText("PROPERTY")).toBeTruthy();
    expect(screen.getByText("Casa Azul")).toBeTruthy();
    expect(screen.queryByText("Casa Verde")).toBeNull();
  });
});
