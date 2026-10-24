// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

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
  OwnerLine: ({ label }: { label: string }) => <div>{label}</div>,
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

describe("PlaybookPage", () => {
  it("abre tudo recolhido, mostra o proprietário e abre uma seção por vez", async () => {
    mount();
    expect(await screen.findByText("Proprietário(a): Arthur")).toBeTruthy();
    expect(screen.queryByText("Link do mapa")).toBeNull();
    const pills = screen.getAllByRole("button", { name: /\d+ campos$/ });
    expect(pills).toHaveLength(5);
    fireEvent.click(pills[0]);
    expect(screen.getByText("Link do mapa")).toBeTruthy();
    fireEvent.click(pills[1]);
    expect(screen.queryByText("Link do mapa")).toBeNull();
    expect(screen.getByText("Código do portão")).toBeTruthy();
  });

  it("mascara o código e a busca abre a seção com resultado", async () => {
    mount();
    await screen.findByText("Proprietário(a): Arthur");
    fireEvent.change(screen.getByPlaceholderText("Buscar campo, valor ou observação"), { target: { value: "portão" } });
    expect(screen.getByText("Código do portão")).toBeTruthy();
    expect(screen.queryByText("9999")).toBeNull();
    expect(screen.getAllByText("••••••").length).toBeGreaterThan(0);
  });

  it("quantas linhas quiser abertas e a Nota do anfitrião só aparece na aberta", async () => {
    mount();
    await screen.findByText("Proprietário(a): Arthur");
    fireEvent.click(screen.getAllByRole("button", { name: /\d+ campos$/ })[0]);
    expect(screen.queryAllByText("Nota do anfitrião")).toHaveLength(0);
    for (const label of ["Título público", "Tipo de espaço", "Cidade"]) fireEvent.click(screen.getByText(label));
    expect(screen.getAllByText("Nota do anfitrião")).toHaveLength(3);
    expect(screen.queryByText("Quartos")).toBeNull();
    expect(screen.queryByText("não cadastrado")).toBeNull();
    void within;
  });

  it("tem Voltar para a lista de proprietários e Modo leitura com entrada e saída explícitas", async () => {
    mount();
    await screen.findByText("Proprietário(a): Arthur");
    expect(screen.getByText("Voltar").closest("a")?.getAttribute("href")).toBe("/admin/proprietarios");
    expect(screen.queryByText("Sair do modo leitura")).toBeNull();
    fireEvent.click(screen.getByLabelText("Entrar no modo leitura"));
    expect(screen.getAllByText("Sair do modo leitura").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("Sair do modo leitura"));
    expect(screen.queryByText("Modo leitura: tudo aberto")).toBeNull();
  });
});
