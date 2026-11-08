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
        <DialogHeader className="px-4 pt-3 pb-2.5 pr-12 text-left">
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
      "absolute", "right-0", "top-0", "z-[10]", "size-8", "rounded-bl-[12px]",
      "rounded-tr-[calc(var(--win-radius,12px)-1px)]",
      "bg-black/35", "text-white",
      "hover:bg-black/55", "hover:text-white",
      "focus:outline-none", "focus-visible:ring-2",
    ]) {
      expect(x.className).toContain(c);
    }
    expect(x.className).not.toContain("border");
    expect(x.querySelector("svg")?.getAttribute("class")).toContain("size-[13px]");
    expect(x.querySelector("svg")?.getAttribute("stroke-width")).toBe("1.8");
  });

  it("DialogHeader usa espaçamento compacto entre título e subtítulo", () => {
    render(
      <Dialog open>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader data-testid="h"><DialogTitle>T</DialogTitle></DialogHeader>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByTestId("h").className).toContain("space-y-0.5");
    expect(screen.getByTestId("h").className).not.toContain("space-y-1.5");
  });

  it("é único e visível em todas as telas, inclusive pageLike; hideClose o omite", () => {
    janela({ pageLike: true });
    expect(screen.getAllByRole("button", { name: "Fechar" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Fechar" }).className).not.toContain("max-lg:hidden");
    expect(screen.getByRole("button", { name: "Fechar" }).className).not.toContain("hidden");
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

describe("auditoria do X de canto", () => {
  it("nenhum botão de fechar solto em top-3.5/right-4 no código", async () => {
    const { execSync } = await import("node:child_process");
    const out = execSync(
      `grep -rnE "absolute right-4 top-3\\.5|absolute top-3\\.5 right-4" src --include=*.tsx | grep -v __tests__ || true`,
      { cwd: process.cwd(), encoding: "utf8" },
    );
    expect(out.trim()).toBe("");
  });
});

describe("X de canto — padrão único (opção C, 08/11/2026)", () => {
  it("nenhuma cópia local do X de canto antigo (tom sólido do --card) sobrou no código", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const path = await import("node:path");
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((f) => {
        const p = path.join(d, f);
        return statSync(p).isDirectory() ? (f === "__tests__" ? [] : walk(p)) : /\.tsx?$/.test(f) ? [p] : [];
      });
    const offenders = walk(path.join(process.cwd(), "src")).filter((f) =>
      readFileSync(f, "utf8").includes("var(--card)_100%,var(--foreground)_8%"),
    );
    expect(offenders).toEqual([]);
  });
});
