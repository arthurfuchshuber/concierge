import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

/**
 * ANTI-CORTE VERTICAL (pedido explícito, 05/10/2026) — irmão de
 * `useAntiClipBar`/`useAntiClipColumns`, para quadrantes com ALTURA limitada
 * (75% da tela).
 *
 * O quadrante é uma coluna: cabeçalho, mídia e barra de ações ficam fixos; só
 * o miolo (`ref`) rola. Se o miolo cabe, nada muda. Se não cabe, a janela
 * visível do miolo encolhe até o fim da última LINHA INTEIRA (elementos
 * marcados com `data-clip-row`) — nunca deixa uma informação pela metade na
 * borda de baixo. As linhas ainda têm `scroll-snap`, então ao rolar a
 * primeira linha visível também para inteira.
 *
 * `deps` refaz a medida quando o conteúdo muda (editar, trocar de registro).
 */
export function useAntiClipRows<T extends HTMLElement>(deps: unknown[] = []) {
  const ref = useRef<T | null>(null);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Volta ao tamanho natural (flex) para medir o espaço realmente disponível.
    el.style.flex = "";
    el.style.height = "";
    const avail = el.clientHeight;
    if (el.scrollHeight <= avail + 1) return; // cabe inteiro
    const box = el.getBoundingClientRect();
    const top = box.top;
    // A janela abre com `zoom-in-95` (transform: scale): getBoundingClientRect
    // devolve medidas ENCOLHIDAS, e `clientHeight` não. Sem desfazer a escala,
    // a medida saía menor que a real e a borda de baixo cortava um cartão
    // ao meio (05/10/2026, Histórico da reserva).
    const scale = el.offsetHeight > 0 ? box.height / el.offsetHeight : 1;
    const rows = Array.from(el.querySelectorAll<HTMLElement>("[data-clip-row]"));
    let fit = 0;
    for (const r of rows) {
      const bottom = (r.getBoundingClientRect().bottom - top) / (scale || 1) + el.scrollTop;
      if (bottom <= avail + 0.5) fit = Math.max(fit, bottom);
    }
    if (fit > 0 && fit < avail) {
      el.style.flex = "none";
      el.style.height = `${Math.ceil(fit)}px`;
    }
  }, []);

  useLayoutEffect(() => {
    measure();
    const raf = requestAnimationFrame(measure);
    // Refaz depois da animação de abertura (200ms) e de imagens/fontes.
    const t1 = window.setTimeout(measure, 120);
    const t2 = window.setTimeout(measure, 320);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure, ...deps]);

  useEffect(() => {
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, [measure]);

  return ref;
}
