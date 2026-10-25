// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  useServerFn: (fn: unknown) => fn,
  createServerFn: () => ({ middleware: () => ({ inputValidator: () => ({ handler: () => ({}) }) }) }),
}));
vi.mock("@/lib/playbook.functions", () => ({
  getPlaybook: async () => ({
    propertyId: "p1",
    propertyName: "Casa Charmosa",
    owner: { name: "Arthur Tenório", phone: null, country: null },
    source: {
      property: { name: "Casa Charmosa", gate_code: "9999", maps_url: "https://maps.app.goo.gl/x", short_description: "Espaço inteiro: casa", city: "Foz do Iguaçu" },
      faqs: [],
      checkout: [],
      emergency: [],
      manuals: [],
      providers: [],
      entries: [],
    },
  }),
  savePlaybookRow: vi.fn(),
  deletePlaybookRow: vi.fn(),
  savePlaybookNote: vi.fn(),
  addPlaybookRow: vi.fn(),
  listBulkTargets: vi.fn(async () => []),
  bulkUpdatePlaybookEntries: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
vi.mock("@/components/dashboard/OwnerLine", () => ({
  OwnerLine: ({ name }: { name: string }) => <div>{`Proprietário(a): ${name}`}</div>,
}));

import { PlaybookPage } from "@/components/playbook/PlaybookPage";

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PlaybookPage propertyId="p1" />
    </QueryClientProvider>,
  );
}

beforeAll(() => {
  window.matchMedia = ((q: string) => ({
    matches: true, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

describe("PlaybookPage (celular)", () => {
  it("lista plana: (quantidade) ao lado do título, sem legenda, abre uma seção com campos em linhas", async () => {
    mount();
    expect(await screen.findByText("Proprietário(a): Arthur Tenório")).toBeTruthy();
    expect(screen.queryByText("Hóspede Ativo")).toBeNull();
    const heads = screen.getAllByRole("button", { name: /, \d+ campos$/ });
    expect(heads).toHaveLength(5);
    expect(screen.queryByText(/Link do mapa/)).toBeNull();
    fireEvent.click(heads[0]);
    expect(screen.getByText(/Link do mapa/)).toBeTruthy();
    fireEvent.click(heads[1]);
    expect(screen.queryByText(/Link do mapa/)).toBeNull();
    expect(screen.getByText(/Código do portão/)).toBeTruthy();
    expect(screen.queryByLabelText("Mais ações")).toBeNull();
    expect(screen.queryByLabelText("Entrar no modo leitura")).toBeNull();
    expect(screen.queryByLabelText("Imprimir")).toBeNull();
  });

  it("tocar num campo abre a janela com abas Texto / Nota / IA", async () => {
    mount();
    const heads = await screen.findAllByRole("button", { name: /, \d+ campos$/ });
    fireEvent.click(heads[0]);
    fireEvent.click(screen.getByText(/Link do mapa/));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByRole("tab", { name: "Texto" })).toBeTruthy();
    expect(within(dlg).getByText("https://maps.app.goo.gl/x")).toBeTruthy();
    fireEvent.click(within(dlg).getByRole("tab", { name: "IA" }));
    expect(within(dlg).getByText(/Observação da IA/)).toBeTruthy();
    fireEvent.click(within(dlg).getByRole("tab", { name: "Nota" }));
    expect(within(dlg).getByText(/Nota do anfitrião/)).toBeTruthy();
  });
});
