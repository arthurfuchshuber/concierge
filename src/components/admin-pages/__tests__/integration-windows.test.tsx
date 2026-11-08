// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const fns = vi.hoisted(() => ({
  getMyClicksignConfig: vi.fn(),
  saveMyClicksignConfig: vi.fn(),
  disconnectMyClicksign: vi.fn(),
  syncMyClicksignDocuments: vi.fn(),
  listMyClicksignDocuments: vi.fn(),
  rotateMyClicksignWebhookSecret: vi.fn(),
  refreshClicksignStakeholderData: vi.fn(),
  getClicksignDocumentFile: vi.fn(),
  previewClicksignStakeholders: vi.fn(),
  importClicksignStakeholders: vi.fn(),
  getMyGoogleCalendarStatus: vi.fn(),
  startGoogleCalendarConnect: vi.fn(),
  disconnectMyGoogleCalendar: vi.fn(),
  listMyGoogleCalendarEvents: vi.fn(),
  listStakeholderOptions: vi.fn(),
  saveStakeholderAlias: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: fns.toastSuccess,
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));
vi.mock("@/lib/clicksign.functions", () => fns);
vi.mock("@/lib/clicksign-import.functions", () => fns);
vi.mock("@/lib/google-calendar.functions", () => fns);
vi.mock("@/lib/stakeholder-links.functions", () => fns);
vi.mock("@/lib/owner-finance.functions", () => ({ getOwnerLooseDocFile: vi.fn() }));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "" }));
vi.mock("@/components/admin-pages/ClicksignDisconnectDialog", () => ({
  ClicksignDisconnectDialog: () => null,
}));

import { ClicksignPanel } from "../ClicksignPanel";
import { sortClicksignDocs } from "@/lib/clicksign-doc-order";
import { GoogleCalendarPanel } from "../GoogleCalendarPanel";

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const doc = (id: string, status: string, finished_at: string | null, name = id) => ({
  id,
  document_key: id,
  name,
  status,
  url_signed: "https://x/" + id,
  url_original: null,
  finished_at,
  synced_at: "2026-01-01T00:00:00Z",
  stakeholder_type: null,
  signers: [],
});

describe("ClickSign — janela refeita", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    fns.getMyClicksignConfig.mockResolvedValue({
      hasToken: true,
      ownerId: "o1",
      hasWebhookSecret: true,
      webhookSecretMasked: "113a••••ec8c",
      documentsCount: 3,
    });
    fns.listMyClicksignDocuments.mockResolvedValue({
      documents: [
        doc("c1", "canceled", null),
        doc("a-old", "closed", "2026-01-01T00:00:00Z"),
        doc("r1", "draft", null),
        doc("a-new", "closed", "2026-05-01T00:00:00Z"),
      ],
    });
  });

  it("ordena por status (Assinado → Cancelado) e do mais recente ao mais antigo", () => {
    const out = sortClicksignDocs([
      doc("c1", "canceled", null),
      doc("a-old", "closed", "2026-01-01T00:00:00Z"),
      doc("r1", "draft", null),
      doc("a-new", "closed", "2026-05-01T00:00:00Z"),
    ]);
    expect(out.map((d) => d.id)).toEqual(["a-new", "a-old", "r1", "c1"]);
  });

  it("abre em Webhook com passo a passo e o ⋯ só com Desconectar; sem data do último evento", async () => {
    wrap(<ClicksignPanel />);
    expect(await screen.findByText("Vá ao ClickSign e siga o passo a passo:")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Webhook" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Contratos (3)" })).toBeTruthy();
    expect(screen.queryByText(/Último Evento/i)).toBeNull();
    expect(screen.queryByText(/Importar contratos/i)).toBeNull();
    expect(screen.queryByText(/Importar cadastros/i)).toBeNull();
    expect(screen.getByRole("button", { name: /Atualizar Dados/ })).toBeTruthy();
  });

  it("Atualizar Dados faz tudo de uma vez e, sem contratante novo, mostra o aviso claro", async () => {
    fns.syncMyClicksignDocuments.mockResolvedValue({
      total: 29,
      linked: 5,
      dataFilled: 0,
      contractStartFilled: 0,
      contractStartOverwritten: 0,
      contractStartConflicts: [],
    });
    fns.refreshClicksignStakeholderData.mockResolvedValue({
      updated: 0,
      failed: 0,
      contractStartConflicts: [],
    });
    fns.previewClicksignStakeholders.mockResolvedValue({
      candidates: Array.from({ length: 5 }, (_, i) => ({
        key: "k" + i,
        status: "linked",
        matches: [],
      })),
    });
    wrap(<ClicksignPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /Atualizar Dados/ }));
    await waitFor(() => expect(fns.toastSuccess).toHaveBeenCalled());
    expect(fns.syncMyClicksignDocuments).toHaveBeenCalledWith({
      data: { overwriteContractStart: false },
    });
    expect(fns.refreshClicksignStakeholderData).toHaveBeenCalled();
    const [title, opts] = fns.toastSuccess.mock.calls[0];
    expect(title).toBe("ClickSign Atualizado");
    expect(opts.className).toBe("!rounded-[16px]");
    expect(opts.description).toBe(
      "29 contratos conferidos. Os 5 cadastros vinculados já estão com os dados em dia. Nenhum cadastro novo para criar.",
    );
  });

  it("com contratante sem cadastro, abre Novos Cadastros (Possível Duplicata)", async () => {
    fns.syncMyClicksignDocuments.mockResolvedValue({
      total: 2,
      linked: 0,
      dataFilled: 0,
      contractStartFilled: 0,
      contractStartOverwritten: 0,
      contractStartConflicts: [],
    });
    fns.refreshClicksignStakeholderData.mockResolvedValue({
      updated: 0,
      failed: 0,
      contractStartConflicts: [],
    });
    fns.previewClicksignStakeholders.mockResolvedValue({
      candidates: [
        {
          key: "a",
          name: "Ana Caroline",
          status: "duplicate",
          suggestedType: "owner",
          sampleDocument: "Ana.pdf",
          sampleDocumentId: "d1",
          matches: [{ type: "owner", id: "o9", label: "Ana Carolina", reason: "name" }],
        },
      ],
    });
    wrap(<ClicksignPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /Atualizar Dados/ }));
    expect(await screen.findByText("Novos Cadastros")).toBeTruthy();
    expect(screen.getByText("Possível Duplicata")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ver Contrato" })).toBeTruthy();
    expect(fns.toastSuccess).not.toHaveBeenCalled();
  });

  it("Contratos: sem 'Última Importação', etiqueta ao lado do nome e sem botão de abrir", async () => {
    wrap(<ClicksignPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Contratos (3)" }));
    expect(await screen.findByText("a-new")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Contratos (3)" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.queryByText(/Última Importação/)).toBeNull();
    expect(screen.queryByLabelText("Abrir contrato")).toBeNull();
    const names = screen
      .getAllByRole("button")
      .map((b) => b.textContent ?? "")
      .filter((t) => /^(a-|r1|c1)/.test(t));
    expect(names[0]).toMatch(/^a-new/);
    expect(names[names.length - 1]).toMatch(/^c1/);
  });
});

const ev = (id: string, link: { label: string } | null, extra: Record<string, unknown> = {}) => ({
  id,
  calendarId: "c",
  calendarName: "c",
  summary: "Evento " + id,
  description: null,
  location: null,
  start: "2026-10-30T16:00:00Z",
  end: null,
  hangoutLink: null,
  htmlLink: "https://calendar.google.com/x",
  attendees: [],
  attachments: [],
  link: link ? { type: "owner", id: "o", label: link.label, via: "email" } : null,
  suggestedAlias: null,
  ...extra,
});

describe("Google Agenda — janela refeita", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    fns.getMyGoogleCalendarStatus.mockResolvedValue({ connected: true, email: "op@x.com" });
    fns.listMyGoogleCalendarEvents.mockResolvedValue([
      ev("1", null, { suggestedAlias: { kind: "email", value: "beto@x.com" } }),
      ev("2", null),
      ev("3", { label: "Marcos Prado" }),
    ]);
    fns.listStakeholderOptions.mockResolvedValue([
      { type: "owner", id: "o1", label: "Marcos Prado", email: null },
    ]);
    fns.saveStakeholderAlias.mockResolvedValue({});
  });

  it("abre em Sem Vínculo, sem filtros de agenda; Vinculados mostra só o nome (sem 'Proprietário(a):')", async () => {
    wrap(<GoogleCalendarPanel />);
    expect(await screen.findByRole("button", { name: "Sem Vínculo (2)" })).toBeTruthy();
    expect(screen.queryByText("Todas as agendas")).toBeNull();
    expect(screen.getByText("beto@x.com")).toBeTruthy();
    expect(screen.getByText("Sem e-mail")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Vinculados (1)" }));
    expect(await screen.findByText("Marcos Prado")).toBeTruthy();
    expect(screen.queryByText(/Proprietário\(a\)/)).toBeNull();
  });

  it("segurar um evento entra na seleção múltipla e vincular leva para Vinculados", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    wrap(<GoogleCalendarPanel />);
    const row = (await screen.findByText("Evento 1")).closest("[data-clip-row]")!;
    fireEvent.pointerDown(row);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.pointerUp(row);
    expect(await screen.findByText("1 Selecionado")).toBeTruthy();
    fireEvent.click(screen.getByText("Evento 2").closest("[data-clip-row]")!);
    expect(screen.getByText("2 Selecionados")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Vincular 2 Eventos/ }));
    expect(await screen.findByText("Vincular 2 Eventos a um Cadastro")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Voltar" })).toBeTruthy();
    fireEvent.click(await screen.findByText("Marcos Prado"));
    await waitFor(() => expect(fns.saveStakeholderAlias).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Vinculados/ }).getAttribute("aria-pressed")).toBe(
        "true",
      ),
    );
    vi.useRealTimers();
  });
});
