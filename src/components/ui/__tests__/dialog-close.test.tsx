// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { windowTitle } from "@/components/dashboard/wide-window";

afterEach(() => cleanup());

function janela(props: { hideClose?: boolean; pageLike?: boolean } = {}) {
  render(
    <Dialog open>
      <DialogContent aria-describedby={undefined} {...props}>
        <DialogHeader className="px-4 pt-3.5 pb-0 pr-14 text-left">
          <DialogTitle>Check-ins pendentes</DialogTitle>
        </DialogHeader>
      </DialogContent>
    </Dialog>,
  );
}

describe("DialogContent — X oficial", () => {
  it("canto superior direito alinhado ao título, com foco e hover acessíveis", () => {
    janela();
    const x = screen.getByRole("button", { name: "Fechar" });
    for (const c of [
      "absolute", "right-4", "top-3.5", "z-10", "size-7", "rounded-lg", "border", "border-border/40",
      "bg-foreground/5", "text-foreground/80", "hover:text-foreground", "hover:bg-foreground/10",
      "focus-visible:ring-2", "after:-inset-1.5",
    ]) {
      expect(x.className).toContain(c);
    }
    expect(x.querySelector("svg")?.getAttribute("class")).toContain("size-4");
    expect(x.querySelector("svg")?.getAttribute("stroke-width")).toBe("2");
  });

  it("é único e continua sumindo no celular em janela pageLike; hideClose o omite", () => {
    janela({ pageLike: true });
    expect(screen.getAllByRole("button", { name: "Fechar" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Fechar" }).className).toContain("max-lg:hidden");
    cleanup();
    janela({ hideClose: true });
    expect(screen.queryByRole("button", { name: "Fechar" })).toBeNull();
  });
});

describe("windowTitle — sentence case", () => {
  it("só a primeira letra maiúscula", () => {
    expect(windowTitle("Check-ins Pendentes")).toBe("Check-ins pendentes");
    expect(windowTitle("Checkouts PENDENTES")).toBe("Checkouts pendentes");
    expect(windowTitle("Fila de Limpeza")).toBe("Fila de limpeza");
    expect(windowTitle("  Imóveis livres hoje ")).toBe("Imóveis livres hoje");
  });
});
