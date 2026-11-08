// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { installScrollIndicators } from "../scroll-indicators";

class RO {
  observe() {}
  disconnect() {}
  unobserve() {}
}
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;

describe("scroll-indicators — barra nítida e fixa", () => {
  let off: () => void = () => {};
  afterEach(() => {
    off();
    document.body.innerHTML = "";
    delete document.documentElement.dataset.scrollIndicators;
  });

  it("desenha um traço de 5px, lilás nítido (85%), sempre que a lista rola", async () => {
    document.documentElement.dataset.scrollIndicators = "on";
    const box = document.createElement("div");
    box.className = "overflow-y-auto";
    box.style.overflowY = "auto";
    Object.defineProperty(box, "scrollHeight", { value: 900, configurable: true });
    Object.defineProperty(box, "clientHeight", { value: 300, configurable: true });
    box.getBoundingClientRect = () => ({ top: 0, left: 0, right: 200, bottom: 300, width: 200, height: 300, x: 0, y: 0, toJSON() {} });
    document.body.appendChild(box);
    off = installScrollIndicators();
    await new Promise((r) => setTimeout(r, 200));
    const layer = document.body.lastElementChild as HTMLElement;
    const thumb = layer.firstElementChild as HTMLElement;
    expect(thumb).toBeTruthy();
    expect(thumb.style.width).toBe("5px");
    expect(thumb.style.cssText).toContain("oklch(0.68 0.22 300) 85%");
    expect(thumb.style.display).toBe("block");
  });
});
