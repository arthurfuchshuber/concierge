import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { SearchActionRow } from "@/components/dashboard/SearchActionRow";
import { OwnerLine } from "@/components/dashboard/OwnerLine";

describe("SearchActionRow", () => {
  it("digitar chama onChange e o botão de limpar só aparece com texto", () => {
    const onChange = vi.fn();
    const { rerender } = render(<SearchActionRow value="" onChange={onChange} placeholder="Buscar imóvel" />);
    expect(screen.queryByLabelText("Limpar busca")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Buscar imóvel"), { target: { value: "sol" } });
    expect(onChange).toHaveBeenCalledWith("sol");
    rerender(<SearchActionRow value="sol" onChange={onChange} placeholder="Buscar imóvel" />);
    fireEvent.click(screen.getByLabelText("Limpar busca"));
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("mostra as ações à direita e avisa quando o campo recebe foco", () => {
    const onFocus = vi.fn();
    render(
      <SearchActionRow
        value=""
        onChange={() => {}}
        placeholder="Buscar"
        onInputFocus={onFocus}
        actions={<button aria-label="Filtros">F</button>}
      />,
    );
    expect(screen.getByLabelText("Filtros")).toBeTruthy();
    fireEvent.focus(screen.getByPlaceholderText("Buscar"));
    expect(onFocus).toHaveBeenCalled();
  });
});

describe("OwnerLine", () => {
  it("mostra SÓ o nome inteiro, sem rótulo; sem nome não renderiza nada", () => {
    const { container, rerender } = render(<OwnerLine name="Marina Souza Albuquerque" />);
    expect(screen.queryByText(/^Pr\b/)).toBeNull();
    expect(screen.queryByText(/Propriet/)).toBeNull();
    expect(screen.getByText("Marina Souza Albuquerque")).toBeTruthy();
    rerender(<OwnerLine name="  " />);
    expect(container.innerHTML).toBe("");
  });

  it("rótulo alternativo vira prefixo terminado em dois-pontos", () => {
    render(<OwnerLine name="Carlos" label="Proprietária do Imóvel: lixo" />);
    expect(screen.getByText("Proprietária do Imóvel:")).toBeTruthy();
  });
});
