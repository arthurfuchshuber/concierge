import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { PermissionGate } from "@/lib/permissions/PermissionGate";
import {
  isPermissionDenied,
  requiredLevelFor,
  toAccessState,
} from "@/lib/permissions/permission.client";

const fetchMock = vi.fn();

vi.mock("@tanstack/react-start", () => ({
  useServerFn: () => (args: unknown) => fetchMock(args),
}));

function decision(allowed: boolean) {
  return {
    tenantId: "t1",
    decisions: {
      "tenant.imoveis": {
        permission: "tenant.imoveis",
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

describe("PermissionGate", () => {
  it("mostra o conteúdo para usuário com permissão", async () => {
    fetchMock.mockResolvedValueOnce(decision(true));
    render(
      <PermissionGate permission="tenant.imoveis">
        <span>conteudo</span>
      </PermissionGate>,
      { wrapper },
    );
    await waitFor(() => expect(screen.getByText("conteudo")).toBeTruthy());
  });

  it("esconde o conteúdo para usuário sem permissão e usa o fallback", async () => {
    fetchMock.mockResolvedValueOnce(decision(false));
    render(
      <PermissionGate permission="tenant.imoveis" fallback={<span>negado</span>}>
        <span>conteudo</span>
      </PermissionGate>,
      { wrapper },
    );
    await waitFor(() => expect(screen.getByText("negado")).toBeTruthy());
    expect(screen.queryByText("conteudo")).toBeNull();
  });

  it("mantém estado seguro durante o carregamento", () => {
    fetchMock.mockReturnValueOnce(new Promise(() => {}));
    render(
      <PermissionGate permission="tenant.imoveis" loadingFallback={<span>carregando</span>}>
        <span>conteudo</span>
      </PermissionGate>,
      { wrapper },
    );
    expect(screen.getByText("carregando")).toBeTruthy();
    expect(screen.queryByText("conteudo")).toBeNull();
  });

  it("erro do backend nunca libera acesso", async () => {
    fetchMock.mockRejectedValueOnce(new Error("falha de rede"));
    render(
      <PermissionGate permission="tenant.imoveis" fallback={<span>negado</span>}>
        <span>conteudo</span>
      </PermissionGate>,
      { wrapper },
    );
    await waitFor(() => expect(screen.getByText("negado")).toBeTruthy());
    expect(screen.queryByText("conteudo")).toBeNull();
  });
});

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
