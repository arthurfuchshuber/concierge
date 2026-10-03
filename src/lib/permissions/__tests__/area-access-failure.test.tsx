import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const fetchMock = vi.fn();
let sessionReady: boolean | null = true;

vi.mock("@tanstack/react-start", () => ({
  useServerFn: () => (args: unknown) => fetchMock(args),
}));
vi.mock("@/lib/permissions/permission.access.functions", () => ({ getMyAccessDecisions: vi.fn() }));
vi.mock("@/hooks/useHasSession", () => ({ useHasSession: () => sessionReady }));
vi.mock("@/hooks/useImpersonation", () => ({
  useImpersonation: () => ({ impersonation: { userId: "11111111-1111-4111-8111-111111111111", name: "Empresa B", email: null } }),
}));

import { AreaGate } from "@/components/permissions/AreaGate";

function ok(allowed: boolean) {
  return {
    tenantId: "t1",
    decisions: {
      "tenant.dashboard": {
        permission: "tenant.dashboard",
        allowed,
        reason: allowed ? "Acesso permitido." : "Sem acesso ao recurso.",
        scope: { type: "TENANT", id: null },
        effective: allowed ? "WRITE" : "NONE",
        required: "READ",
      },
    },
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/**
 * Bug de 03/10/2026: qualquer falha na consulta de permissão (token ainda não
 * anexado, rede, servidor reiniciando) era engolida e virava "Você não tem
 * acesso a esta área" para quem TEM acesso. Falha não é negação.
 */
describe("AreaGate — falha de verificação não é falta de acesso", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    sessionReady = true;
  });

  it("falha persistente mostra 'não foi possível verificar', nunca 'sem acesso'", async () => {
    fetchMock.mockRejectedValue(new Error("falha de rede"));
    render(
      <AreaGate permission="tenant.dashboard">
        <span>conteudo</span>
      </AreaGate>,
      { wrapper },
    );
    await waitFor(() => expect(screen.getByText(/Não foi possível verificar o seu acesso/)).toBeTruthy(), {
      timeout: 8000,
    });
    expect(screen.queryByText(/Você não tem acesso a esta área/)).toBeNull();
    expect(screen.queryByText("conteudo")).toBeNull();
  }, 12000);

  it("falha transitória é tentada de novo e libera o conteúdo", async () => {
    fetchMock.mockRejectedValueOnce(new Error("401")).mockResolvedValue(ok(true));
    render(
      <AreaGate permission="tenant.dashboard">
        <span>conteudo</span>
      </AreaGate>,
      { wrapper },
    );
    await waitFor(() => expect(screen.getByText("conteudo")).toBeTruthy(), { timeout: 4000 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 8000);

  it("'Tentar de novo' refaz a consulta", async () => {
    fetchMock.mockRejectedValue(new Error("falha"));
    render(
      <AreaGate permission="tenant.dashboard">
        <span>conteudo</span>
      </AreaGate>,
      { wrapper },
    );
    const btn = await screen.findByText("Tentar de novo", undefined, { timeout: 8000 });
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(ok(true));
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByText("conteudo")).toBeTruthy());
  }, 14000);

  it("negação REAL do backend continua mostrando 'sem acesso' com o motivo", async () => {
    fetchMock.mockResolvedValue(ok(false));
    render(
      <AreaGate permission="tenant.dashboard">
        <span>conteudo</span>
      </AreaGate>,
      { wrapper },
    );
    await waitFor(() => expect(screen.getByText(/Você não tem acesso a esta área/)).toBeTruthy());
    expect(screen.getByText("Sem acesso ao recurso.")).toBeTruthy();
  });

  it("sem sessão ainda: não consulta (e não nega) — espera o token", async () => {
    sessionReady = null;
    render(
      <AreaGate permission="tenant.dashboard">
        <span>conteudo</span>
      </AreaGate>,
      { wrapper },
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/Você não tem acesso a esta área/)).toBeNull();
  });

  it("envia a empresa ativa na consulta", async () => {
    fetchMock.mockResolvedValue(ok(true));
    render(
      <AreaGate permission="tenant.dashboard">
        <span>conteudo</span>
      </AreaGate>,
      { wrapper },
    );
    await waitFor(() => expect(screen.getByText("conteudo")).toBeTruthy());
    expect(fetchMock.mock.calls[0][0].data.accountOwnerId).toBe("11111111-1111-4111-8111-111111111111");
  });
});
