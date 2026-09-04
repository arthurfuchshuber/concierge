import { useCallback, useEffect, useRef } from "react";

/**
 * ANTI-CORTE (regra global do projeto) — versão reutilizável.
 *
 * Esta é a MESMA lógica que já existia dentro de `Stepper.tsx`, agora
 * extraída para um hook único usado por TODAS as barras de menu/abas do
 * app (`ds-segmented`, `TabsList`, etc.), porque a regra vale para todas —
 * nunca só para o editor de guia.
 *
 * O que ela garante, em qualquer largura de tela:
 *   1) Nenhum item da barra jamais aparece cortado pela metade — nem na
 *      borda esquerda, nem na direita.
 *   2) Quando sobra um pedaço de espaço menor do que o próximo item
 *      inteiro, esse resto vira um espaçador INVISÍVEL logo depois do
 *      último item que coube inteiro. Assim o próximo item é empurrado
 *      100% para fora da área visível, em vez de "espiar" cortado.
 *      IMPORTANTE: esse espaçador é sempre transparente. Já foi tentado
 *      colori-lo igual ao item ativo (para o vão não parecer um buraco) e
 *      o resultado foi pior: virava uma "faixa roxa" na borda que parecia
 *      exatamente aquilo que a regra proíbe — um item cortado.
 *   3) A "página" começa o mais cedo possível (puxando itens anteriores)
 *      desde que o item âncora continue 100% visível — isso reduz ao
 *      mínimo o vão que sobra no fim.
 *   4) Um espaçador fixo no fim de tudo garante respiro real depois do
 *      último item (padding-right de container com overflow não entra de
 *      forma confiável na área rolável).
 *   5) Arrastar com o dedo e parar no meio de um item é corrigido: 150ms
 *      depois de o usuário soltar, a barra reencaixa numa página limpa.
 *
 * Sem gradiente/máscara nas bordas — proibido pelo cliente.
 */
const ORDER_STEP = 2;
const END_GUTTER_PX = 8;
const SETTLE_MS = 150;

function isSpacer(el: Element) {
  return el.hasAttribute("data-spacer");
}

export function useAntiClipBar<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const hideSpacerRef = useRef<HTMLSpanElement | null>(null);
  const endGutterRef = useRef<HTMLSpanElement | null>(null);
  const settleTimer = useRef<number | null>(null);

  const items = useCallback((): HTMLElement[] => {
    const el = ref.current;
    if (!el) return [];
    return Array.from(el.children).filter((c): c is HTMLElement => c instanceof HTMLElement && !isSpacer(c));
  }, []);

  const activeIndex = useCallback((): number => {
    return items().findIndex(
      (b) => b.getAttribute("data-state") === "active" || b.getAttribute("aria-selected") === "true",
    );
  }, [items]);

  const leadingIndex = useCallback((): number => {
    const nav = ref.current;
    if (!nav) return 0;
    const btns = items();
    let idx = 0;
    for (let i = 0; i < btns.length; i++) {
      if (btns[i].offsetLeft <= nav.scrollLeft + 1) idx = i;
      else break;
    }
    return idx;
  }, [items]);

  const applyPage = useCallback(
    (anchorIndex: number, scroll: boolean) => {
      const nav = ref.current;
      const btns = items();
      const hideSpacer = hideSpacerRef.current;
      const anchorBtn = btns[Math.max(0, anchorIndex)];
      if (!nav || !anchorBtn || btns.length === 0) return;

      // Cada item real recebe uma `order` PAR, deixando os ímpares livres
      // para encaixar o espaçador entre dois itens quaisquer sem mexer no
      // DOM nem no espaço interno de nenhum botão.
      btns.forEach((b, i) => {
        b.style.order = String(i * ORDER_STEP);
        // Zera o espaçamento extra da página anterior ANTES de medir.
        b.style.marginRight = "";
      });
      if (endGutterRef.current) {
        endGutterRef.current.style.order = String(btns.length * ORDER_STEP);
        endGutterRef.current.style.width = `${END_GUTTER_PX}px`;
      }

      // Zera o espaçador ANTES de medir — senão a medição herda a página
      // anterior.
      if (hideSpacer) {
        hideSpacer.style.width = "0px";
        hideSpacer.style.order = String(btns.length * ORDER_STEP - 1);
      }
      void nav.offsetWidth;

      // O padding lateral do container conta: sem descontá-lo, o último item
      // da página ultrapassava a borda por alguns pixels (corte fino).
      const cs = getComputedStyle(nav);
      const padLeft = parseFloat(cs.paddingLeft) || 0;
      const padRight = parseFloat(cs.paddingRight) || 0;
      const containerWidth = nav.clientWidth - padLeft - padRight;

      const fillFrom = (start: number) => {
        const startBtn = btns[start];
        if (!startBtn) return null;
        const startLeft = startBtn.offsetLeft;
        let last = start;
        let end = startLeft;
        for (let i = start; i < btns.length; i++) {
          const b = btns[i];
          const bEnd = b.offsetLeft + b.offsetWidth;
          if (bEnd - startLeft > containerWidth) break;
          last = i;
          end = bEnd;
        }
        return { last, end, startLeft };
      };

      const initial = fillFrom(anchorIndex);
      if (!initial) return;
      let best = initial;
      let bestStart = anchorIndex;
      for (let start = anchorIndex - 1; start >= 0; start--) {
        const candidate = fillFrom(start);
        if (!candidate || candidate.last < anchorIndex) break;
        const candidateLeftover = containerWidth - (candidate.end - candidate.startLeft);
        const bestLeftover = containerWidth - (best.end - best.startLeft);
        if (candidateLeftover < bestLeftover) {
          best = candidate;
          bestStart = start;
        }
      }

      const { last: lastIncluded, end: consumedEnd, startLeft } = best;
      const leftover = containerWidth - (consumedEnd - startLeft);
      const isTrueEnd = lastIncluded === btns.length - 1;
      const gaps = lastIncluded - bestStart;

      if (!isTrueEnd && leftover > 1) {
        if (gaps > 0) {
          // REGRA ANTI-CORTE: a sobra vira espaçamento PROPORCIONAL entre as
          // opções visíveis, de modo que a última opção da página termine
          // exatamente na borda direita. Nada de bloco vazio no fim (que
          // parecia uma aba cortada) e nada de item "espiando" pela metade.
          const extra = leftover / gaps;
          for (let i = bestStart; i < lastIncluded; i++) {
            btns[i].style.marginRight = `${extra}px`;
          }
        } else if (hideSpacer) {
          // Só um item cabe na página: não há vão para distribuir, então o
          // resto vira espaçador invisível para empurrar o próximo item
          // 100% para fora da área visível.
          hideSpacer.style.order = String(lastIncluded * ORDER_STEP + 1);
          hideSpacer.style.width = `${leftover}px`;
        }
      }

      if (scroll) {
        nav.scrollTo({ left: bestStart === 0 ? 0 : Math.max(0, startLeft - padLeft), behavior: "smooth" });
      }
    },
    [items],
  );

  const realign = useCallback(
    (preferActive: boolean) => {
      const nav = ref.current;
      if (!nav) return;
      const btns = items();
      if (btns.length === 0) return;
      const idx = preferActive ? activeIndex() : -1;
      if (idx >= 0) {
        const btn = btns[idx];
        const fullyVisible =
          btn.offsetLeft >= nav.scrollLeft - 1 &&
          btn.offsetLeft + btn.offsetWidth <= nav.scrollLeft + nav.clientWidth + 1;
        applyPage(fullyVisible ? leadingIndex() : idx, !fullyVisible);
        return;
      }
      applyPage(leadingIndex(), false);
    },
    [activeIndex, applyPage, items, leadingIndex],
  );

  useEffect(() => {
    const nav = ref.current;
    if (!nav) return;

    // O snap nativo do CSS (`ds-segmented`) só resolve a borda esquerda e
    // brigaria com o cálculo deste hook pela posição de rolagem.
    nav.style.scrollSnapType = "none";

    const mkSpacer = () => {
      const s = document.createElement("span");
      s.setAttribute("data-spacer", "");
      s.setAttribute("aria-hidden", "true");
      s.style.flex = "0 0 auto";
      s.style.width = "0px";
      s.style.alignSelf = "stretch";
      s.style.pointerEvents = "none";
      nav.appendChild(s);
      return s;
    };
    hideSpacerRef.current = mkSpacer();
    endGutterRef.current = mkSpacer();

    realign(true);

    const onScroll = () => {
      if (settleTimer.current) window.clearTimeout(settleTimer.current);
      settleTimer.current = window.setTimeout(() => applyPage(leadingIndex(), true), SETTLE_MS);
    };
    nav.addEventListener("scroll", onScroll, { passive: true });

    const ro = new ResizeObserver(() => realign(false));
    ro.observe(nav);
    Array.from(nav.children).forEach((c) => ro.observe(c));

    // Troca de aba ativa (clique ou navegação programática) e itens
    // adicionados/removidos dinamicamente.
    const mo = new MutationObserver(() => realign(true));
    mo.observe(nav, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state", "aria-selected", "class"],
    });

    return () => {
      nav.removeEventListener("scroll", onScroll);
      ro.disconnect();
      mo.disconnect();
      if (settleTimer.current) window.clearTimeout(settleTimer.current);
      hideSpacerRef.current?.remove();
      endGutterRef.current?.remove();
      hideSpacerRef.current = null;
      endGutterRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return ref;
}
