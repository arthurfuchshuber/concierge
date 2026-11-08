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

describe("SearchActionRow — variante bleed (faixa de ponta a ponta)", () => {
  const faixa = (variant: "raised" | "inset" | "bleed") => {
    const { container } = render(
      <SearchActionRow
        variant={variant}
        value=""
        onChange={() => {}}
        placeholder="Buscar"
        actions={<button aria-label="Filtros">F</button>}
      />,
    );
    return container.firstElementChild as HTMLElement;
  };

  it("bleed: fundo transparente, cantos retos e sem sombra/contorno próprios", () => {
    const el = faixa("bleed");
    expect(el.className).toContain("rounded-none");
    expect(el.className).toContain("bg-transparent");
    expect(el.className).not.toContain("rounded-[9px]");
    expect(el.className).not.toContain("ds-3d");
    expect(el.className).not.toContain("color-mix(in_oklab,var(--card),var(--background)");
  });

  it("bleed: respiro de 16px à esquerda da lupa e do texto", () => {
    faixa("bleed");
    expect(document.querySelector("svg.lucide-search")?.getAttribute("class")).toContain("left-4");
    expect(screen.getByPlaceholderText("Buscar").className).toContain("pl-10");
  });

  it("bleed: mantém as divisórias curtas das ações (as do inset)", () => {
    const acoes = faixa("bleed").querySelector(".ds-icon-actions") as HTMLElement;
    expect(acoes.className).toContain("before:h-[18px]");
    expect(acoes.className).not.toContain("divide-x");
  });

  it("inset e raised seguem como antes", () => {
    const inset = faixa("inset");
    expect(inset.className).toContain("rounded-[9px]");
    expect(inset.className).not.toContain("rounded-none");
    document.body.innerHTML = "";
    const raised = faixa("raised");
    expect(raised.className).toContain("ds-3d");
    expect(raised.className).toContain("rounded-[9px]");
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
