// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { bankData, state } = vi.hoisted(() => ({
  state: { empty: false, impersonating: false },
  bankData: {
    items: [
      { malvo_item_id: "btg", connector_name: "BTG Pactual Empresas", status: "UPDATED", environment: "PRODUCTION" },
      { malvo_item_id: "nu", connector_name: "Nubank Empresas", status: "UPDATED", environment: "PRODUCTION" },
      { malvo_item_id: "asaas", connector_name: "Asaas PJ", status: "UPDATED", environment: "asaas_api" },
    ],
    accounts: [
      { malvo_account_id: "1", malvo_item_id: "btg", type: "BANK", subtype: "CHECKING_ACCOUNT", number: "0050/00877408-7", bank_data: null },
      { malvo_account_id: "2", malvo_item_id: "nu", type: "BANK", subtype: "CHECKING_ACCOUNT", number: "0001/409849764-4", bank_data: null },
      { malvo_account_id: "3", malvo_item_id: "asaas", type: "BANK", subtype: "CHECKING_ACCOUNT", number: null, bank_data: null },
    ],
    transactions: 0,
  },
}));

vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/whatsapp.functions", () => ({ getMyWhatsappConfig: () => Promise.resolve({ senderNumber: null }) }));
vi.mock("@/lib/clicksign.functions", () => ({ getMyClicksignConfig: () => Promise.resolve({ hasToken: true }) }));
vi.mock("@/lib/google-calendar.functions", () => ({ getMyGoogleCalendarStatus: () => Promise.resolve({ connected: true }) }));
vi.mock("@/lib/channex.functions", () => ({ getChannexStatus: () => Promise.resolve({ configured: false }) }));
vi.mock("@/lib/malvo.functions", () => ({
  listBankConnections: () => Promise.resolve(state.empty ? { items: [], accounts: [], transactions: 0 } : bankData),
  getBankConnectToken: vi.fn(),
  syncBankConnection: vi.fn(),
  disconnectBank: vi.fn(),
}));
vi.mock("@/hooks/useImpersonation", () => ({
  useImpersonation: () => ({ impersonation: state.impersonating ? { userId: "other", name: "Outra", email: null } : null }),
}));
vi.mock("@/hooks/useMyPermissions", () => ({ useMyPermissions: () => ({ isOwner: true, can: () => true, loading: false }) }));
vi.mock("@/hooks/useIsAdmin", () => ({ useIsAdmin: () => ({ isAdmin: false }) }));
vi.mock("@/components/admin-pages/WhatsappBusinessPage", () => ({ WhatsappBusinessPage: () => null }));
vi.mock("@/components/admin-pages/ClicksignPanel", () => ({ ClicksignPanel: () => null }));
vi.mock("@/components/admin-pages/GoogleCalendarPanel", () => ({ GoogleCalendarPanel: () => null }));
vi.mock("@/components/admin-pages/ChannexPanel", () => ({ ChannexPanel: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { IntegracoesPage } from "../IntegracoesPage";

function renderPage() {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}><IntegracoesPage /></QueryClientProvider>);
}

describe("IntegracoesPage (celular) — Bancos e Asaas PJ", () => {
  beforeEach(() => {
    cleanup();
    state.empty = false;
    state.impersonating = false;
  });

  it("mostra subtítulos em todos os cards e as contas dos bancos, sem a etiqueta 'Ativa'", async () => {
    renderPage();
    await waitFor(() => expect(screen.queryAllByTestId("integration-skeleton")).toHaveLength(0));
    expect(screen.getByText("Bancos")).toBeTruthy();
    expect(screen.getByText("Integração bancária")).toBeTruthy();
    expect(screen.getByText("Contratos digitais")).toBeTruthy();
    expect(screen.getByText("Agendas do Gmail")).toBeTruthy();
    expect(screen.getByText("Extrato e transações")).toBeTruthy();
    // abre recolhido: as contas só aparecem depois de expandir
    expect(screen.queryByText("BTG Pactual Empresas")).toBeNull();
    fireEvent.click(await screen.findByLabelText("Expandir bancos"));
    expect(screen.getByText("BTG Pactual Empresas")).toBeTruthy();
    expect(screen.getByText("Ag. 0050 · 00877408-7")).toBeTruthy();
    expect(screen.getByText("Nubank Empresas")).toBeTruthy();
    expect(screen.getByText("Ag. 0001 · 409849764-4")).toBeTruthy();
    expect(screen.queryByText("Ativa")).toBeNull();
  });

  it("cards inativos ganham a faixa cinza lateral", async () => {
    renderPage();
    await waitFor(() => expect(screen.queryAllByTestId("integration-skeleton")).toHaveLength(0));
    expect(screen.queryAllByTestId("inactive-strip").length).toBeGreaterThan(0);
  });

  it("a seta expande e recolhe a lista de bancos (abre recolhida)", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Expandir bancos")).toBeTruthy());
    expect(screen.queryByText("BTG Pactual Empresas")).toBeNull();
    fireEvent.click(screen.getByLabelText("Expandir bancos"));
    expect(screen.getByText("BTG Pactual Empresas")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Recolher bancos"));
    expect(screen.queryByText("BTG Pactual Empresas")).toBeNull();
  });

  it("sem nenhum dado, Bancos e Asaas PJ aparecem mesmo assim (inativos, com 'Conectar')", async () => {
    state.empty = true;
    renderPage();
    await waitFor(() => expect(screen.queryAllByTestId("integration-skeleton")).toHaveLength(0));
    expect(screen.getByText("Bancos")).toBeTruthy();
    expect(screen.getByText("Asaas PJ")).toBeTruthy();
    expect(screen.queryByLabelText("Recolher bancos")).toBeNull();
    expect(screen.getAllByText("Conectar").length).toBeGreaterThanOrEqual(2);
  });

  it("vendo outra conta, os cards continuam visíveis mas sem os dados bancários da sessão logada", async () => {
    state.impersonating = true;
    renderPage();
    await waitFor(() => expect(screen.queryAllByTestId("integration-skeleton")).toHaveLength(0));
    expect(screen.getByText("Bancos")).toBeTruthy();
    expect(screen.getByText("Asaas PJ")).toBeTruthy();
    expect(screen.queryByText("BTG Pactual Empresas")).toBeNull();
  });
});
