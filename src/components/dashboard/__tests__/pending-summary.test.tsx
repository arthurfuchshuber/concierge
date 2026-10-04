import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { PendingSummary } from "@/components/dashboard/PendingSummary";

const day = 86_400_000;
const iso = (d: number) => new Date(Date.now() - d * day).toISOString();
const item = (id: string, propertyId: string, name: string, category: string, age: number, title: string) => ({
  id,
  propertyId,
  propertyName: name,
  category: category as never,
  title,
  createdAt: iso(age),
});
const items = [
  item("1", "p1", "Casa Charmosa", "maintenance", 23, "Lâmpada queimada"),
  item("2", "p1", "Casa Charmosa", "damage", 9, "Cobre-leito manchado"),
  item("3", "p2", "Studio 105", "damage", 7, "Vidro trincado"),
  item("4", "p3", "Apê Aconchegante", "forgotten", 0, "Carregador esquecido"),
];
const tones = {
  maintenance: "#c98c8c",
  damage: "#c98c8c",
  incident: "#c98c8c",
  forgotten: "#c9a962",
  cleaning_audit: "#7fb79a",
  other: "#c9a962",
};

function setup(onOpenItem = vi.fn(() => true)) {
  render(
    <PendingSummary items={items} tones={tones} onOpenItem={onOpenItem}>
      <button>Ver só elas</button>
    </PendingSummary>,
  );
  fireEvent.click(screen.getByText("Ver só elas"));
}


describe("Tooltip do 'Ver só elas'", () => {
  it("mostra o total, a mais antiga e a aba Urgência por padrão", async () => {
    setup();
    expect(await screen.findByText("Resumo das pendências")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getByText(/Mais antiga 23 d/)).toBeTruthy();
    expect(screen.getByText("+ 15 dias")).toBeTruthy();
  });

  it("sem botões de filtrar nem 'Fechar' no rodapé; só o X do sistema", async () => {
    setup();
    await screen.findByText("Resumo das pendências");
    expect(screen.queryByText("Filtrar lista")).toBeNull();
    expect(screen.queryByText("Fechar")).toBeNull();
    expect(screen.queryByText(/^Ver só (Casa|Studio|Apê)/)).toBeNull();
    expect(screen.getAllByText("Close")).toHaveLength(1);
  });

  it("na aba Imóveis, tocar num imóvel mostra as pendências dele", async () => {
    setup();
    fireEvent.click(await screen.findByText("Imóveis"));
    fireEvent.click(screen.getByText("Casa Charmosa"));
    expect(screen.getByText("Lâmpada queimada")).toBeTruthy();
    expect(screen.queryByText(/^Ver só (Casa|Studio|Apê)/)).toBeNull();
  });

  it("tocar numa pendência abre ela; ao fechá-la, o tooltip volta como estava", async () => {
    const onOpenItem = vi.fn(() => true);
    const ui = (viewerOpen: boolean) => (
      <PendingSummary items={items} tones={tones} onOpenItem={onOpenItem} viewerOpen={viewerOpen}>
        <button>Ver só elas</button>
      </PendingSummary>
    );
    const { rerender } = render(ui(false));
    fireEvent.click(screen.getByText("Ver só elas"));
    fireEvent.click(await screen.findByText("Imóveis"));
    fireEvent.click(screen.getByText("Casa Charmosa"));
    fireEvent.click(screen.getByText("Lâmpada queimada"));
    expect(onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ title: "Lâmpada queimada" }));
    rerender(ui(true)); // pendência oficial aberta
    expect(screen.queryByText("Resumo das pendências")).toBeNull();
    rerender(ui(false)); // fechou
    expect(await screen.findByText("Resumo das pendências")).toBeTruthy();
    expect(screen.getByText("Lâmpada queimada")).toBeTruthy(); // imóvel continua aberto
  });
});
