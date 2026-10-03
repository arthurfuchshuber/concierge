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

function setup(onApply = vi.fn()) {
  render(
    <PendingSummary items={items} tones={tones} onApply={onApply}>
      <button>Ver só elas</button>
    </PendingSummary>,
  );
  fireEvent.click(screen.getByText("Ver só elas"));
  return onApply;
}

describe("Tooltip do 'Ver só elas'", () => {
  it("mostra o total, a mais antiga e a aba Urgência por padrão", async () => {
    setup();
    expect(await screen.findByText("Resumo das pendências")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getByText(/Mais antiga 23 d/)).toBeTruthy();
    expect(screen.getByText("+ 15 dias")).toBeTruthy();
  });

  it("'Filtrar lista' aplica o filtro de todas as pendências", async () => {
    const onApply = setup();
    fireEvent.click(await screen.findByText("Filtrar lista"));
    expect(onApply).toHaveBeenCalledWith(null);
  });

  it("na aba Imóveis, tocar num imóvel mostra as pendências e filtra só ele", async () => {
    const onApply = setup();
    fireEvent.click(await screen.findByText("Imóveis"));
    fireEvent.click(screen.getByText("Casa Charmosa"));
    expect(screen.getByText("Lâmpada queimada")).toBeTruthy();
    fireEvent.click(screen.getByText("Ver só Casa Charmosa"));
    expect(onApply).toHaveBeenCalledWith("p1");
  });
});
