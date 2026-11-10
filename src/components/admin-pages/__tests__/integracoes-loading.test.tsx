// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { resolvers, deferred } = vi.hoisted(() => {
  const resolvers: Record<string, (v: unknown) => void> = {};
  const deferred = (k: string) => () => new Promise((res) => { resolvers[k] = res as (v: unknown) => void; });
  return { resolvers, deferred };
});

vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/whatsapp.functions", () => ({ getMyWhatsappConfig: deferred("wa") }));
vi.mock("@/lib/clicksign.functions", () => ({ getMyClicksignConfig: deferred("cs") }));
vi.mock("@/lib/google-calendar.functions", () => ({ getMyGoogleCalendarStatus: deferred("gcal") }));
vi.mock("@/lib/channex.functions", () => ({ getChannexStatus: deferred("channex") }));
vi.mock("@/lib/malvo.functions", () => ({
  listBankConnections: () => Promise.resolve({ items: [], accounts: [], transactions: 0 }),
  getBankConnectToken: vi.fn(),
  syncBankConnection: vi.fn(),
  disconnectBank: vi.fn(),
}));
vi.mock("@/hooks/useImpersonation", () => ({ useImpersonation: () => ({ impersonation: null }) }));
vi.mock("@/components/admin-pages/WhatsappBusinessPage", () => ({ WhatsappBusinessPage: () => null }));
vi.mock("@/components/admin-pages/ClicksignPanel", () => ({ ClicksignPanel: () => null }));
vi.mock("@/components/admin-pages/GoogleCalendarPanel", () => ({ GoogleCalendarPanel: () => null }));
vi.mock("@/components/admin-pages/ChannexPanel", () => ({ ChannexPanel: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { IntegracoesPage, useIntegrationStatusQueries } from "../IntegracoesPage";

function renderPage() {
  const qc = new QueryClient();
  return { qc, ...render(<QueryClientProvider client={qc}><IntegracoesPage /></QueryClientProvider>) };
}

describe("IntegracoesPage — sem flash de cards desconectados", () => {
  beforeEach(() => { cleanup(); for (const k of Object.keys(resolvers)) delete resolvers[k]; });

  it("na primeira carga mostra só skeletons: sem 'Conectar', sem 'Não conectada', sem faixa verde", () => {
    const { container } = renderPage();
    expect(screen.getAllByTestId("integration-skeleton").length).toBeGreaterThan(0);
    expect(screen.queryByText("Conectar")).toBeNull();
    expect(screen.queryByText("Não conectada")).toBeNull();
    expect(container.querySelector(".bg-emerald-500")).toBeNull();
  });

  it("skeleton mobile usa a mesma casca e altura h-[108px]", () => {
    renderPage();
    const sk = screen.getAllByTestId("integration-skeleton").find((e) => e.className.includes("h-[108px]"))!;
    for (const c of ["h-[108px]", "rounded-[12px]", "border-border/70", "bg-card", "py-3.5", "pl-[17px]", "pr-3.5"]) {
      expect(sk.className).toContain(c);
    }
  });

  it("ao responder, vira card ativo com 'Gerenciar' e faixa verde; inativos mostram 'Conectar'", async () => {
    const { container } = renderPage();
    resolvers.cs({ hasToken: true });
    resolvers.gcal({ connected: false });
    resolvers.wa({ senderNumber: null });
    resolvers.channex({ configured: false });
    await waitFor(() => expect(screen.queryAllByTestId("integration-skeleton")).toHaveLength(0));
    expect(screen.getAllByText("Gerenciar").length).toBeGreaterThan(0);
    expect(container.querySelector(".bg-emerald-500.w-\\[3px\\]")).not.toBeNull();
    expect(screen.getAllByText("Conectar").length).toBeGreaterThan(0);
  });

  it("pré-carregada pelo Administrativo: ao abrir a aba já mostra os cards, sem skeleton", async () => {
    const qc = new QueryClient();
    function Prefetch() {
      useIntegrationStatusQueries();
      return null;
    }
    render(<QueryClientProvider client={qc}><Prefetch /></QueryClientProvider>);
    await waitFor(() => expect(resolvers.channex).toBeDefined());
    resolvers.cs({ hasToken: true });
    resolvers.gcal({ connected: false });
    resolvers.wa({ senderNumber: null });
    resolvers.channex({ configured: false });
    await waitFor(() => expect(qc.getQueryData(["channex-status"])).toBeDefined());
    cleanup();
    render(<QueryClientProvider client={qc}><IntegracoesPage /></QueryClientProvider>);
    expect(screen.queryAllByTestId("integration-skeleton")).toHaveLength(0);
    expect(screen.getAllByText("Gerenciar").length).toBeGreaterThan(0);
  });
});
