// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

afterEach(() => cleanup());

describe("SheetContent — X oficial de canto (igual ao das janelas)", () => {
  it("mesma estrutura, tamanho, cores e curvatura; cabeçalho reserva pr-12", () => {
    render(
      <Sheet open>
        <SheetContent aria-describedby={undefined}>
          <SheetHeader data-testid="h">
            <SheetTitle>Título</SheetTitle>
          </SheetHeader>
        </SheetContent>
      </Sheet>,
    );
    const x = screen.getByRole("button", { name: "Fechar" });
    for (const c of [
      "absolute", "right-0", "top-0", "z-[10]", "size-8", "rounded-bl-[12px]",
      "rounded-tr-[calc(var(--win-radius,12px)-1px)]",
      "bg-[color-mix(in_oklab,var(--foreground)_9%,transparent)]", "text-foreground/70",
      "hover:bg-[color-mix(in_oklab,var(--foreground)_16%,transparent)]", "hover:text-foreground",
    ]) {
      expect(x.className).toContain(c);
    }
    expect(x.className).not.toContain("border");
    expect(x.querySelector("svg")?.getAttribute("class")).toContain("size-[13px]");
    expect(x.querySelector("svg")?.getAttribute("stroke-width")).toBe("1.8");
    expect(screen.getByTestId("h").className).toContain("pr-12");
  });
});
