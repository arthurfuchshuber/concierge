// @vitest-environment jsdom
/**
 * ROLAGEM SÓ NO CONTEÚDO (08/11/2026, todo o SaaS): a barra de rolagem tem a altura exata da área que rola;
 * cabeçalho, rodapé e X ficam fora dela, e a casca da janela nunca rola nem reserva calha de barra.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { splitWindowChildren } from "@/components/ui/window-body";

afterEach(() => cleanup());
const body = () => document.querySelector("[data-window-body]") as HTMLElement | null;
const content = () => screen.getByRole("dialog");

describe("DialogContent", () => {
  it("cabeçalho e rodapé fora da área que rola; a casca não rola nem tem calha", () => {
    render(
      <Dialog open>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Check-ins pendentes</DialogTitle>
          </DialogHeader>
          <p>linha 1</p>
          <p>linha 2</p>
          <DialogFooter>
            <button>Salvar</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    );
    const b = body()!;
    expect(b).not.toBeNull();
    expect(b.className).toContain("overflow-y-auto");
    expect(b.className).toContain("sg-elegant-scroll");
    expect(b.textContent).toBe("linha 1linha 2");
    expect(b.contains(screen.getByText("Check-ins pendentes"))).toBe(false);
    expect(b.contains(screen.getByText("Salvar"))).toBe(false);
    const c = content();
    expect(c.className).not.toContain("sg-elegant-scroll");
    expect(c.className).not.toMatch(/(^|\s)overflow-y-auto(\s|$)/);
    expect(c.className).toContain("!overflow-hidden");
    expect(b.contains(screen.getByRole("button", { name: "Fechar" }))).toBe(false);
  });

  it("cabeçalho montado à mão (bloco com o título) também fica fixo; fragmentos são abertos", () => {
    render(
      <Dialog open>
        <DialogContent aria-describedby={undefined} className="p-0 gap-0">
          <>
            <div className="px-4 pt-3">
              <DialogTitle>Campos vazios</DialogTitle>
              <div>Seção 3</div>
            </div>
            <ul>
              <li>a</li>
            </ul>
          </>
        </DialogContent>
      </Dialog>,
    );
    expect(body()!.contains(screen.getByText("Campos vazios"))).toBe(false);
    expect(body()!.contains(screen.getByText("a"))).toBe(true);
  });

  it("um bloco único que embrulha tudo (form com o título) rola inteiro — nada fica cortado", () => {
    render(
      <Dialog open>
        <DialogContent aria-describedby={undefined}>
          <form>
            <DialogTitle>Novo lançamento</DialogTitle>
            <input aria-label="valor" />
          </form>
        </DialogContent>
      </Dialog>,
    );
    expect(body()!.contains(screen.getByLabelText("valor"))).toBe(true);
  });

  it("janela com área de rolagem própria (casca overflow-hidden) não é embrulhada e não ganha calha", () => {
    render(
      <Dialog open>
        <DialogContent aria-describedby={undefined} className="flex flex-col overflow-hidden p-0">
          <DialogTitle>Fila de limpeza</DialogTitle>
          <div className="overflow-y-auto">lista</div>
        </DialogContent>
      </Dialog>,
    );
    expect(body()).toBeNull();
    expect(content().className).not.toContain("sg-elegant-scroll");
  });
});

describe("AlertDialogContent e SheetContent", () => {
  it("alerta: cabeçalho e rodapé fixos", () => {
    render(
      <AlertDialog open>
        <AlertDialogContent aria-describedby={undefined}>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar?</AlertDialogTitle>
          </AlertDialogHeader>
          <p>texto</p>
          <AlertDialogFooter>
            <button>OK</button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );
    expect(body()!.textContent).toBe("texto");
  });

  it("painel lateral que rolava: cabeçalho fora da área que rola", () => {
    render(
      <Sheet open>
        <SheetContent aria-describedby={undefined} className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Filtros</SheetTitle>
          </SheetHeader>
          <p>opções</p>
        </SheetContent>
      </Sheet>,
    );
    expect(body()!.textContent).toBe("opções");
  });
});

describe("splitWindowChildren", () => {
  it("separa cabeçalho, corpo e rodapé", () => {
    const r = splitWindowChildren([
      <DialogHeader key="h"><DialogTitle>t</DialogTitle></DialogHeader>,
      <DialogDescription key="d">d</DialogDescription>,
      <p key="p">x</p>,
      <DialogFooter key="f">f</DialogFooter>,
    ]);
    expect([r.head.length, r.body.length, r.foot.length]).toEqual([2, 1, 1]);
  });
});
