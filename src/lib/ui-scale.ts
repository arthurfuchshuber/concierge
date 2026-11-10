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
 * A altura também conta: o menu lateral inteiro precisa caber na janela, então
 * a escala é a menor entre a da largura e a da altura (notebook largo e baixo).
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

/** Folga (em px "virtuais") entre o fim do menu lateral e a borda de baixo da janela. */
const SIDEBAR_SLACK = 8;

/**
 * Escala pela largura e, quando o menu lateral é conhecido, também pela altura:
 * vale a MENOR das duas, para o menu inteiro (do logo ao rodapé) caber na tela
 * sem cortar item. `sidebarNeed` é a altura que o menu precisa em escala 1.
 */
export function computeUiScale(
  viewportWidth: number,
  viewportHeight?: number,
  sidebarNeed?: number | null,
): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth < UI_SCALE_DESKTOP_MIN) return 1;
  let raw = viewportWidth / UI_SCALE_REF_WIDTH;
  if (
    viewportHeight !== undefined && Number.isFinite(viewportHeight) && viewportHeight > 0 &&
    sidebarNeed !== undefined && sidebarNeed !== null && Number.isFinite(sidebarNeed) && sidebarNeed > 0
  ) {
    raw = Math.min(raw, viewportHeight / (sidebarNeed + SIDEBAR_SLACK));
  }
  const clamped = Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, raw));
  // 3 casas: evita reflow a cada pixel de redimensionamento.
  return Math.round(clamped * 1000) / 1000;
}

/**
 * Altura que o menu lateral (marcado com `data-ui-fit-sidebar`) ocupa em escala 1:
 * cabeçalho + itens do menu + rodapé, medidos e divididos pela escala atual.
 */
function measureSidebarNeed(): number | null {
  try {
    const aside = document.querySelector<HTMLElement>("[data-ui-fit-sidebar]");
    const nav = aside?.querySelector("nav");
    if (!aside || !nav || nav.children.length === 0) return null;
    const current = parseFloat(getComputedStyle(document.documentElement).fontSize) / 16;
    if (!Number.isFinite(current) || current <= 0) return null;
    const kids = Array.from(nav.children) as HTMLElement[];
    const first = kids[0].getBoundingClientRect();
    const last = kids[kids.length - 1].getBoundingClientRect();
    const cs = getComputedStyle(nav);
    let total = last.bottom - first.top + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    for (const c of Array.from(aside.children)) {
      if (c !== nav) total += (c as HTMLElement).getBoundingClientRect().height;
    }
    return total > 0 ? total / current : null;
  } catch {
    return null;
  }
}

function apply(): void {
  const root = document.documentElement;
  let off = false;
  try {
    off = window.localStorage.getItem("ui-scale") === "off";
  } catch {
    /* sem storage: segue ligado */
  }
  const scale = off ? 1 : computeUiScale(window.innerWidth, window.innerHeight, measureSidebarNeed());
  if (scale === 1) {
    root.style.removeProperty("font-size");
    root.style.removeProperty("--ui-scale");
    root.removeAttribute("data-ui-scaled");
    return;
  }
  const next = `${16 * scale}px`;
  if (root.style.fontSize === next) return;
  root.style.setProperty("font-size", next);
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
    // Abrir/fechar um grupo do menu (ou o menu terminar de carregar) muda a
    // altura que ele precisa: reajusta a escala.
    const nav = document.querySelector("[data-ui-fit-sidebar] nav");
    const observer = nav ? new MutationObserver(onResize) : null;
    if (nav && observer) observer.observe(nav, { childList: true, subtree: true });
    return () => {
      observer?.disconnect();
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
      reset();
    };
  }, []);
}
