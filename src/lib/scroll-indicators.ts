/**
 * Indicador de rolagem SEMPRE VISÍVEL em toda janela/caixa que rola na vertical
 * (pedido explícito do usuário).
 *
 * Por quê: em celular (iOS/Android) e no emulador mobile do Chrome a barra
 * nativa é "overlay" — o `::-webkit-scrollbar` do styles.css é ignorado e a
 * barra some, então a pessoa não percebe que há mais conteúdo abaixo. Nesses
 * ambientes desenhamos uma barra fina, no mesmo estilo da global (lilás da
 * marca, translúcida), sobreposta ao elemento que rola.
 *
 * Em desktop com barra clássica (largura > 0) este módulo não faz nada: vale a
 * barra global do styles.css.
 *
 * A barra é desenhada em um overlay fixo no <body> (pointer-events: none), sem
 * mexer no DOM do React nem no layout dos elementos.
 */

const CANDIDATES =
  '[class*="overflow-y-"], [class*="overflow-auto"], [class*="sg-elegant-scroll"], [role="dialog"], [data-radix-scroll-area-viewport]';
const TRACK_MARGIN = 14; // mesma folga da barra global (cantos arredondados)
const THUMB_W = 4;
const MIN_THUMB = 28;

function hasOverlayScrollbars(): boolean {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:absolute;top:-9999px;width:60px;height:60px;overflow:scroll;visibility:hidden";
  document.body.appendChild(probe);
  const overlay = probe.offsetWidth - probe.clientWidth === 0;
  probe.remove();
  return overlay;
}

export function installScrollIndicators(): () => void {
  if (typeof document === "undefined") return () => {};
  // A barra global só tem 3px, então a sonda mede a barra nativa padrão.
  const forced = document.documentElement.dataset.scrollIndicators === "on";
  if (!forced && !hasOverlayScrollbars()) return () => {};

  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:2147483000;overflow:hidden";
  document.body.appendChild(layer);

  const thumbs = new Map<Element, HTMLDivElement>();
  let tracked = new Set<Element>();
  let raf = 0;
  let scanTimer = 0;

  const canScrollY = (el: Element): boolean => {
    const h = el as HTMLElement;
    if (h.scrollHeight - h.clientHeight <= 2) return false;
    const oy = getComputedStyle(h).overflowY;
    return oy === "auto" || oy === "scroll";
  };

  const scan = () => {
    const next = new Set<Element>();
    document.querySelectorAll(CANDIDATES).forEach((el) => {
      if (canScrollY(el)) next.add(el);
    });
    tracked = next;
    for (const [el, t] of thumbs) {
      if (!next.has(el)) {
        t.remove();
        thumbs.delete(el);
      }
    }
    schedule();
  };

  const scheduleScan = () => {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(scan, 120);
  };

  const paint = () => {
    raf = 0;
    for (const el of tracked) {
      const h = el as HTMLElement;
      const rect = h.getBoundingClientRect();
      let thumb = thumbs.get(el);
      const maxScroll = h.scrollHeight - h.clientHeight;
      const visible = rect.width > 0 && rect.height > 0 && maxScroll > 2;
      if (!visible) {
        thumb?.style.setProperty("display", "none");
        continue;
      }
      if (!thumb) {
        thumb = document.createElement("div");
        thumb.style.cssText = `position:absolute;width:${THUMB_W}px;border-radius:9999px;background:color-mix(in oklab, oklch(0.58 0.2 300) 45%, transparent)`;
        layer.appendChild(thumb);
        thumbs.set(el, thumb);
      }
      const trackH = Math.max(rect.height - TRACK_MARGIN * 2, 20);
      const thumbH = Math.max(MIN_THUMB, (h.clientHeight / h.scrollHeight) * trackH);
      const top =
        rect.top + TRACK_MARGIN + (h.scrollTop / maxScroll) * Math.max(trackH - thumbH, 0);
      thumb.style.display = "block";
      thumb.style.height = `${thumbH}px`;
      thumb.style.transform = `translate(${rect.right - THUMB_W - 2}px, ${top}px)`;
      thumb.style.left = "0";
      thumb.style.top = "0";
    }
  };

  function schedule() {
    if (!raf) raf = requestAnimationFrame(paint);
  }

  const onScroll = () => schedule();
  document.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", scheduleScan);
  const mo = new MutationObserver(scheduleScan);
  mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "data-state"] });
  const ro = new ResizeObserver(scheduleScan);
  ro.observe(document.body);
  scan();

  return () => {
    document.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", scheduleScan);
    mo.disconnect();
    ro.disconnect();
    window.clearTimeout(scanTimer);
    if (raf) cancelAnimationFrame(raf);
    layer.remove();
  };
}
