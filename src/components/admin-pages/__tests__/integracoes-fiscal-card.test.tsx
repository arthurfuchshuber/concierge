// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  impersonation: null as null | { userId: string },
  isOwner: true,
  me: "me-1",
  fiscalStatus: vi.fn(async () => ({ companies: [] })),
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/fiscal/fiscal.functions", () => ({ fiscalStatus: h.fiscalStatus, fiscalCompanyPrefill: vi.fn(async () => ({ ok: false, code: "no_cnpj" })) }));
vi.mock("@/lib/channex.functions", () => ({ getChannexStatus: async () => ({ imported: 1 }) }));
vi.mock("@/lib/clicksign.functions", () => ({ getMyClicksignConfig: async () => ({ hasToken: true }) }));
vi.mock("@/lib/google-calendar.functions", () => ({ getMyGoogleCalendarStatus: async () => ({ connected: true }) }));
vi.mock("@/lib/malvo.functions", () => ({ listBankConnections: async () => ({ items: [], accounts: [], transactions: 0 }), getBankConnectToken: vi.fn(), syncBankConnection: vi.fn(), disconnectBank: vi.fn() }));
vi.mock("@/hooks/useImpersonation", () => ({ useImpersonation: () => ({ impersonation: h.impersonation }) }));
vi.mock("@/hooks/useMyPermissions", () => ({ useMyPermissions: () => ({ isOwner: h.isOwner, can: () => true, loading: false, myUserId: h.me }) }));
vi.mock("@/hooks/useIsAdmin", () => ({ useIsAdmin: () => ({ isAdmin: false }) }));
vi.mock("@/components/admin-pages/ClicksignPanel", () => ({ ClicksignPanel: () => null }));
vi.mock("@/components/admin-pages/GoogleCalendarPanel", () => ({ GoogleCalendarPanel: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { IntegracoesPage } from "../IntegracoesPage";

const page = () => render(<QueryClientProvider client={new QueryClient()}><IntegracoesPage /></QueryClientProvider>);
const INFO = "Apenas o titular da empresa pode ativar e gerenciar o módulo fiscal.";

describe("card Notas Fiscais (NFS-e) na aba Integrações", () => {
  beforeEach(() => { cleanup(); vi.clearAllMocks(); h.impersonation = null; h.isOwner = true; });

  it("titular sem conta selecionada: card visível e status consultado", async () => {
    page();
    expect(await screen.findByText("Notas Fiscais (NFS-e)")).toBeTruthy();
    await waitFor(() => expect(h.fiscalStatus).toHaveBeenCalled());
  });
  it("admin com a PRÓPRIA conta auto-selecionada (sg-impersonate = o próprio id): continua titular", async () => {
    h.impersonation = { userId: h.me };
    page();
    expect(await screen.findByText("Notas Fiscais (NFS-e)")).toBeTruthy();
    await waitFor(() => expect(h.fiscalStatus).toHaveBeenCalled());
  });
  it("conta de terceiro: o card aparece, mas só informativo e sem consultar o fiscal", async () => {
    h.impersonation = { userId: "outra-conta" };
    page();
    const card = (await screen.findByText("Notas Fiscais (NFS-e)")).closest("div.relative") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: /Conectar/ }));
    expect(await screen.findByText(INFO)).toBeTruthy();
    expect(h.fiscalStatus).not.toHaveBeenCalled();
  });
  it("não titular (membro): card visível e informativo", async () => {
    h.isOwner = false;
    page();
    const card = (await screen.findByText("Notas Fiscais (NFS-e)")).closest("div.relative") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: /Conectar/ }));
    expect(await screen.findByText(INFO)).toBeTruthy();
    expect(h.fiscalStatus).not.toHaveBeenCalled();
  });
});
