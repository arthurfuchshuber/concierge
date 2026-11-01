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
      property: { name: "Casa Charmosa", gate_code: "9999", maps_url: "https://maps.app.goo.gl/x", short_description: "Espaço inteiro: casa", city: "Foz do Iguaçu", cleaning_price_normal_cents: 15000, cleaning_duration_normal_minutes: 180, cleaning_price_full_cents: 25000, cleaning_duration_full_minutes: 300, checkin_time: "15:00", in_condominium: true, apartment_number: "302" },
      faqs: [],
      checkout: [],
      emergency: [],
      manuals: [],
      providers: [],
      entries: [],
    },
  }),
  savePlaybookRow: vi.fn(async () => ({ ok: true })),
  savePlaybookParts: vi.fn(async () => ({ ok: true })),
  deletePlaybookRow: vi.fn(),
  savePlaybookNote: vi.fn(),
  savePlaybookAudience: vi.fn(async () => ({ ok: true })),
  addPlaybookRow: vi.fn(),
  listBulkTargets: vi.fn(async () => []),
  bulkUpdatePlaybookEntries: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
vi.mock("@/components/dashboard/OwnerLine", () => ({
  OwnerLine: ({ name }: { name: string }) => <div>{name}</div>,
}));

import { PlaybookPage } from "@/components/playbook/PlaybookPage";
import * as playbookFns from "@/lib/playbook.functions";

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PlaybookPage propertyId="p1" />
    </QueryClientProvider>,
  );
}

beforeAll(() => {
  // jsdom não tem scrollIntoView (o editor do campo rola até o foco).
  Element.prototype.scrollIntoView = vi.fn();
  window.matchMedia = ((q: string) => ({
    matches: true, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

describe("PlaybookPage (celular)", () => {
  it("lista plana: (quantidade) ao lado do título, sem legenda, abre uma seção com campos em linhas", async () => {
    mount();
    expect(await screen.findByText("Arthur Tenório")).toBeTruthy();
    expect(screen.queryByText("Hóspede Ativo")).toBeNull(); // nome antigo não volta (o público se chama "Reserva Ativa")
    const heads = screen.getAllByRole("button", { name: /, \d+ campos$/ });
    expect(heads).toHaveLength(6);
    expect(screen.queryByText(/Link do mapa/)).toBeNull();
    fireEvent.click(heads[0]);
    expect(screen.getByText(/Link do mapa/)).toBeTruthy();
    // TODOS os campos levam "Quem Pode Ver:" (inclusive Público).
    expect(screen.getAllByRole("button", { name: /Explicação: Público/ }).length).toBeGreaterThan(0);
    fireEvent.click(heads[1]);
    expect(screen.queryByText(/Link do mapa/)).toBeNull();
    expect(screen.getByText(/Código do portão/)).toBeTruthy();
    // Audiência: linha própria abaixo do valor, com o nome atual "Reserva Ativa" (o antigo "Hóspede Ativo" não aparece).
    expect(screen.getAllByText(/Quem Pode Ver:/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /Explicação: (Reserva Ativa|Equipe Interna)/ }).length).toBeGreaterThan(0);
    expect(screen.queryByText("Hóspede Ativo")).toBeNull(); // nome antigo não volta (o público se chama "Reserva Ativa")
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
    expect(within(dlg).getByDisplayValue("https://maps.app.goo.gl/x")).toBeTruthy();
    fireEvent.click(within(dlg).getByRole("tab", { name: "IA" }));
    expect(within(dlg).getByText(/Observação da IA/)).toBeTruthy();
    fireEvent.click(within(dlg).getByRole("tab", { name: "Nota" }));
    expect(within(dlg).getByText(/Nota do anfitrião/)).toBeTruthy();
  });

  it('"+ Campo" lista os campos vazios e o do Airbnb abre o alerta; "+ Nova Info" exige título e texto', async () => {
    mount();
    const heads = await screen.findAllByRole("button", { name: /, \d+ campos$/ });
    fireEvent.click(heads[0]);
    fireEvent.click(screen.getByRole("button", { name: "+ Campo" }));
    const list = await screen.findByRole("dialog");
    expect(within(list).getByText("Campos Vazios")).toBeTruthy();
    const airbnb = within(list).getAllByText("Só no Airbnb");
    expect(airbnb.length).toBeGreaterThan(0);
    fireEvent.click(airbnb[0].closest("button")!);
    const alert = await screen.findByRole("dialog");
    expect(within(alert).getByText("Edite no Airbnb")).toBeTruthy();
    fireEvent.click(within(alert).getByRole("button", { name: "Entendi" }));

    fireEvent.click(screen.getByRole("button", { name: "+ Nova Info" }));
    const nova = await screen.findByRole("dialog");
    expect(within(nova).getAllByText(/Obrigatório/)).toHaveLength(2);
    const add = within(nova).getByRole("button", { name: "Adicionar" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.change(within(nova).getByPlaceholderText(/coleta de lixo/), { target: { value: "Lixo" } });
    fireEvent.change(within(nova).getByPlaceholderText(/precisa saber/), { target: { value: "Terça" } });
    expect(add.disabled).toBe(false);
    expect(within(nova).getByText("Público")).toBeTruthy();
  });

  /**
   * 01/11/2026 — janela ÚNICA do campo (Dossiê, opção B): abas no topo, editor na aba Texto, "Quem pode ver" em 3
   * opções iguais e rodapé Cancelar / Salvar. Salvar grava o valor e o público de uma vez.
   */
  it("janela do campo: abas no topo, editor + Quem pode ver e Cancelar/Salvar", async () => {
    mount();
    const heads = await screen.findAllByRole("button", { name: /, \d+ campos$/ });
    fireEvent.click(heads[0]);
    fireEvent.click(screen.getByText(/Link do mapa/));
    const dlg = await screen.findByRole("dialog");
    const title = within(dlg).getByText("Link do mapa");
    expect(title.className).toContain("text-sm");
    expect(title.className).toContain("font-bold");
    expect(within(dlg).getByText(/^\d · /)).toBeTruthy();
    // Abas ficam ANTES do conteúdo (no topo) e o rodapé tem Cancelar / Salvar.
    const tablist = within(dlg).getByRole("tablist");
    const editor = within(dlg).getByDisplayValue("https://maps.app.goo.gl/x");
    expect(tablist.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(dlg).getByRole("button", { name: "Cancelar" })).toBeTruthy();
    const radios = within(dlg).getAllByRole("radio");
    expect(radios).toHaveLength(3);
    fireEvent.change(editor, { target: { value: "https://maps.app.goo.gl/novo" } });
    fireEvent.click(radios.find((r) => r.getAttribute("aria-checked") === "false")!);
    fireEvent.click(within(dlg).getByRole("button", { name: "Salvar" }));
    await vi.waitFor(() =>
      expect(playbookFns.savePlaybookRow).toHaveBeenCalledWith({
        data: expect.objectContaining({ propertyId: "p1", rowId: "f:link_do_mapa", value: "https://maps.app.goo.gl/novo", audience: expect.stringMatching(/^[GPI]$/) }),
      }),
    );
  });

  it("campos compostos viram cartões separados (limpeza normal / completa) e Salvar grava as partes", async () => {
    mount();
    const heads = await screen.findAllByRole("button", { name: /, \d+ campos$/ });
    // A limpeza fica na seção de operação; procura a linha pelo rótulo em qualquer seção.
    let opened = false;
    for (const h of heads) {
      fireEvent.click(h);
      const row = screen.queryByText(/Limpeza \(valores e duração\)/i);
      if (row) {
        fireEvent.click(row);
        opened = true;
        break;
      }
    }
    expect(opened).toBe(true);
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByRole("region", { name: "Limpeza normal" })).toBeTruthy();
    expect(within(dlg).getByRole("region", { name: "Limpeza completa" })).toBeTruthy();
    expect(within(dlg).getAllByText("Valor")).toHaveLength(2);
    expect(within(dlg).getAllByText("Duração")).toHaveLength(2);
    const money = within(dlg).getAllByPlaceholderText("0,00");
    fireEvent.change(money[0], { target: { value: "180,00" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Salvar" }));
    await vi.waitFor(() =>
      expect(playbookFns.savePlaybookParts).toHaveBeenCalledWith({
        data: expect.objectContaining({
          rowId: "f:limpeza_operacional",
          parts: expect.objectContaining({ price_normal: "18000", dur_normal: "180", price_full: "25000", dur_full: "300" }),
        }),
      }),
    );
  });
});
