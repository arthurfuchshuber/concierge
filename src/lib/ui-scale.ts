import { useEffect } from "react";

/**
 * ESCALA PROPORCIONAL DA TELA DO SISTEMA (pedido explícito, 09/11/2026).
 *
 * "A tela inteira precisa estar ajustada ao zoom 100% da tela do usuário: os
 * quadrantes dentro da tela, e todos os elementos crescendo ou encolhendo
 * juntos conforme o tamanho da janela, e não só ficando pequenos."
 *
 * Como funciona: todo valor em px do CSS é convertido para rem na compilação
 * (ver `postcss-px-to-rem.mjs`), então basta mudar a fonte-base do <html>:
 * a interface inteira escala junto (textos, espaços, cards, ícones, gráficos).
 * A referência é a largura de 1440px — nela a escala é 1 (tudo como sempre foi).
 * Em janela mais larga tudo cresce, em mais estreita tudo encolhe, de modo que
 * o layout sempre "enxerga" ~1440px e cabe na tela, sem sobra nem corte.
 *
 * Só no desktop (≥ 1024px). Tablet e celular seguem o layout responsivo de
 * sempre, com escala 1. Os breakpoints continuam olhando a janela real.
 *
 * Desligar em emergência: `localStorage.setItem("ui-scale", "off")`.
 */
export const UI_SCALE_REF_WIDTH = 1440;
export const UI_SCALE_DESKTOP_MIN = 1024;
export const UI_SCALE_MIN = 0.7;
export const UI_SCALE_MAX = 2;

export function computeUiScale(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth < UI_SCALE_DESKTOP_MIN) return 1;
  const raw = viewportWidth / UI_SCALE_REF_WIDTH;
  const clamped = Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, raw));
  // 3 casas: evita reflow a cada pixel de redimensionamento.
  return Math.round(clamped * 1000) / 1000;
}

function apply(): void {
  const root = document.documentElement;
  let off = false;
  try {
    off = window.localStorage.getItem("ui-scale") === "off";
  } catch {
    /* sem storage: segue ligado */
  }
  const scale = off ? 1 : computeUiScale(window.innerWidth);
  if (scale === 1) {
    root.style.removeProperty("font-size");
    root.style.removeProperty("--ui-scale");
    root.removeAttribute("data-ui-scaled");
    return;
  }
  root.style.setProperty("font-size", `${16 * scale}px`);
  root.style.setProperty("--ui-scale", String(scale));
  root.setAttribute("data-ui-scaled", "");
}

function reset(): void {
  const root = document.documentElement;
  root.style.removeProperty("font-size");
  root.style.removeProperty("--ui-scale");
  root.removeAttribute("data-ui-scaled");
}

/** Liga a escala enquanto o sistema (área logada) estiver na tela. */
export function useUiScale(): void {
  useEffect(() => {
    let frame = 0;
    const onResize = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
    };
    apply();
    window.addEventListener("resize", onResize);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
      reset();
    };
  }, []);
}
