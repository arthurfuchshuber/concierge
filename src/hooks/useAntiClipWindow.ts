import * as React from "react";

/**
 * REGRA GLOBAL DE JANELAS (pedido explícito, 09/10/2026): "toda e qualquer
 * janela expande ou reduz a altura conforme o conteúdo, com teto de 75% da
 * tela; se passar, aplica a regra anticorte e a barra de rolagem".
 *
 * O teto de 75% mora no CSS de cada janela (`max-h-[min(90dvh,…)]`). Este hook
 * é a metade ANTICORTE, aplicada AUTOMATICAMENTE pelas bases (Dialog,
 * AlertDialog, Drawer, Popover, HoverCard, menus) — nenhuma janela precisa
 * lembrar de chamar nada:
 *
 *   · acha cada área que rola dentro da janela (ou a própria janela);
 *   · se o conteúdo cabe, não faz nada (a janela cresce/encolhe sozinha);
 *   · se não cabe, encolhe a área visível até o fim da última UNIDADE inteira
 *     (cartão, linha, passo) — nunca deixa algo cortado ao meio na borda de
 *     baixo. A barra de rolagem global (fina, lilás) continua visível.
 *
 * Unidades: elementos marcados com `data-clip-row` (precisão máxima, usados
 * em Registros e no Histórico) e, onde não há marca, os filhos diretos da área
 * que rola — descendo um nível quando um filho sozinho ocupa mais de 60% da
 * área (lista longa dentro de um único bloco).
 */

const MAX_DEPTH = 4;
/** Contêineres que sempre se abrem em linhas, em qualquer tamanho. */
const LIST_TAGS = new Set(["TABLE", "TBODY", "UL", "OL"]);
/** Folga mínima (px) entre o último card inteiro e a borda de baixo da janela. */
const MIN_CLEARANCE = 12;

function isOutOfFlow(el: HTMLElement): boolean {
  const pos = getComputedStyle(el).position;
  return pos === "absolute" || pos === "fixed";
}

function collectUnits(root: HTMLElement, avail: number): HTMLElement[] {
  const out: HTMLElement[] = [];
  const walk = (node: HTMLElement, depth: number) => {
    for (const child of Array.from(node.children) as HTMLElement[]) {
      if (child.offsetHeight === 0 || isOutOfFlow(child)) continue;
      if (child.hasAttribute("data-clip-row")) {
        out.push(child);
      } else if (child.querySelector("[data-clip-row]")) {
        walk(child, depth + 1);
      } else if (LIST_TAGS.has(child.tagName) && child.children.length > 0) {
        // Tabelas e listas: a unidade é a LINHA (<tr>/<li>), nunca a tabela inteira
        // (print de 23/10/2026: "Limpezas Realizadas" cortava a última linha).
        walk(child, depth);
      } else if (
        depth < MAX_DEPTH &&
        child.children.length > 0 &&
        child.offsetHeight > avail * 0.6
      ) {
        walk(child, depth + 1);
      } else {
        out.push(child);
      }
    }
  };
  walk(root, 0);
  return out;
}

function fitScroller(el: HTMLElement) {
  // Posição de rolagem de quem está usando: medir exige voltar ao tamanho natural (mais alto), e isso
  // faz o navegador "apertar" o scrollTop para o novo máximo. Sem restaurar, qualquer remedição
  // (barra de endereço do celular encolhendo, teclado, redimensionar) jogava a janela de volta.
  const keepTop = el.scrollTop;
  // Volta ao tamanho natural para medir o espaço realmente disponível.
  el.style.flex = "";
  el.style.height = "";
  const avail = el.clientHeight;
  if (avail <= 0 || el.scrollHeight <= avail + 1) {
    if (el.scrollTop !== keepTop) el.scrollTop = keepTop;
    return; // cabe inteiro
  }
  const box = el.getBoundingClientRect();
  // `zoom-in-95` (transform: scale) encolhe getBoundingClientRect, não
  // clientHeight — desfaz a escala para medir na mesma régua.
  const scale = el.offsetHeight > 0 ? box.height / el.offsetHeight : 1;
  let fit = 0;
  let nextTop = Infinity;
  for (const u of collectUnits(el, avail)) {
    const r = u.getBoundingClientRect();
    const bottom = (r.bottom - box.top) / (scale || 1) + el.scrollTop;
    if (bottom <= avail + 0.5) fit = Math.max(fit, bottom);
    else nextTop = Math.min(nextTop, (r.top - box.top) / (scale || 1) + el.scrollTop);
  }
  const own = getComputedStyle(el);
  // Quando a própria janela é a área que rola, o recorte no fim da última linha
  // deixava o cartão colado (e com o canto arredondado cortado) na borda de baixo.
  // Devolve o respiro do rodapé (padding), sem deixar a próxima linha espiar.
  // (Vale em QUALQUER posição de rolagem: antes só valia com scrollTop = 0 e a altura mudava ~7 px
  // conforme a pessoa rolava, o que fazia a janela "trepidar".)
  if (fit > 0) {
    // RESPIRO MÍNIMO (bug real, 17/10/2026: abrindo um card em "Atrasados" o
    // último card ficava ENCOSTADO na borda da janela). Quando a área que rola
    // não tem padding embaixo (o respiro mora num <div> interno, como na lista
    // dos KPIs), `pad` era 0 e o corte caía rente ao fim do card. Agora a área
    // visível termina SEMPRE com pelo menos `MIN_CLEARANCE` px de folga depois
    // do último card inteiro — limitada ao espaço real até a próxima unidade,
    // para nunca deixar uma tira dela aparecendo.
    const pad = Math.max(parseFloat(own.paddingBottom) || 0, MIN_CLEARANCE);
    const room = Number.isFinite(nextTop)
      ? Math.max(0, nextTop - fit - 1)
      : Math.max(0, el.scrollHeight - fit);
    fit += Math.min(pad, room);
  }
  if (fit > 0 && fit < avail) {
    // A janela inteira rola (ela mesma é a área): `height` com `max-height`
    // continua respeitando o teto de 75%.
    el.style.flex = own.display === "flex" || el.parentElement ? "none" : "";
    el.style.height = `${Math.ceil(fit)}px`;
  }
  if (el.scrollTop !== keepTop) el.scrollTop = keepTop;
}

function scrollersIn(root: HTMLElement): HTMLElement[] {
  const all = [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))];
  return all.filter((el) => {
    const oy = getComputedStyle(el).overflowY;
    return oy === "auto" || oy === "scroll";
  });
}

/** Ref callback que liga o anticorte a uma janela e repassa o ref original. */
export function useAntiClipWindow<T extends HTMLElement>(
  forwarded?: React.ForwardedRef<T>,
): (node: T | null) => void {
  const fwd = React.useRef(forwarded);
  fwd.current = forwarded;
  const cleanup = React.useRef<(() => void) | null>(null);

  return React.useCallback((node: T | null) => {
    const f = fwd.current;
    if (typeof f === "function") f(node);
    else if (f) f.current = node;

    cleanup.current?.();
    cleanup.current = null;
    if (!node || typeof window === "undefined") return;

    let raf = 0;
    // CONTEÚDO QUE MUDA DE ALTURA SEM MEXER NO DOM (bug 21/10/2026, prints da
    // "Limpezas Realizadas"/"Fila de Limpeza": a última linha aparecia cortada).
    // Depois de fixar a altura da área que rola, uma linha que cresce sozinha
    // (fonte web carregando, foto/avatar, texto que quebra) NÃO dispara o
    // MutationObserver nem o ResizeObserver da janela (a janela mantém a mesma
    // altura) — o corte ficava velho. Agora cada área que rola e cada filho
    // direto dela também são observados, e a fonte pronta refaz a conta.
    const inner = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => schedule()) : null;
    const run = () => {
      raf = 0;
      for (const s of scrollersIn(node)) {
        fitScroller(s);
        if (inner) for (const c of Array.from(s.children)) inner.observe(c);
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(run);
    };
    schedule();
    const t1 = window.setTimeout(schedule, 120);
    const t2 = window.setTimeout(schedule, 320); // depois da animação de abertura
    void document.fonts?.ready.then(schedule);
    const mo = new MutationObserver(schedule);
    mo.observe(node, { childList: true, subtree: true, characterData: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    ro?.observe(node);
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    cleanup.current = () => {
      if (raf) cancelAnimationFrame(raf);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      mo.disconnect();
      ro?.disconnect();
      inner?.disconnect();
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
    };
  }, []);
}
