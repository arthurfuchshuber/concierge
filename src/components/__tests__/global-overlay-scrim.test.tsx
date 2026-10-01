import { describe, it, expect, afterEach } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { GlobalOverlayScrim } from "@/components/GlobalOverlayScrim";
import { pushGlobalOverlay } from "@/lib/global-overlay-store";

/**
 * A tela de trás NÃO rola com um tooltip aberto (pedido de 01/10/2026): o véu
 * recebe o gesto e o descarta; fechado, não mexe em nada.
 */
afterEach(() => cleanup());

function scrim() {
  return document.querySelector("[data-global-scrim]") as HTMLElement;
}

function wheel() {
  const ev = new Event("wheel", { bubbles: true, cancelable: true });
  scrim().dispatchEvent(ev);
  return ev;
}

describe("véu global e rolagem da página", () => {
  it("com um tooltip aberto, a roda e o toque sobre o véu não rolam a página", () => {
    render(<GlobalOverlayScrim />);
    let layer!: ReturnType<typeof pushGlobalOverlay>;
    act(() => {
      layer = pushGlobalOverlay("float");
    });
    expect(wheel().defaultPrevented).toBe(true);
    const touch = new Event("touchmove", { bubbles: true, cancelable: true });
    scrim().dispatchEvent(touch);
    expect(touch.defaultPrevented).toBe(true);
    expect(scrim().style.touchAction).toBe("none");
    act(() => layer.release());
  });

  it("sem tooltip aberto, nada é bloqueado", () => {
    render(<GlobalOverlayScrim />);
    expect(wheel().defaultPrevented).toBe(false);
    expect(scrim().style.touchAction).toBe("");
  });

  it("ao fechar o tooltip, a rolagem volta", () => {
    render(<GlobalOverlayScrim />);
    let layer!: ReturnType<typeof pushGlobalOverlay>;
    act(() => {
      layer = pushGlobalOverlay("float");
    });
    act(() => layer.release());
    expect(wheel().defaultPrevented).toBe(false);
  });
});
