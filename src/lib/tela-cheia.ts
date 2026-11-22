/**
 * TELA CHEIA NO CELULAR (pedido explícito, 22/11/2026 — mockups "TelaCheia-01/02"): toda janela com
 * informação ELÁSTICA (listas que crescem: KPIs do Dashboard, listas do Financeiro, registros e pendências
 * do imóvel…) ocupa o aparelho inteiro abaixo de `lg` — sem margens, sem raio, sem sombra, cabeçalho no
 * topo e o "X" de canto. No computador (lg+) nada muda. A regra ANTICORTE continua valendo: a lista
 * termina sempre num card inteiro e o rodapé fica colado embaixo (o espaço que sobra fica entre os dois).
 */
export const TELA_CHEIA_CLASS = "sg-tela-cheia";

export const TELA_CHEIA_QUERY = "(max-width: 1023.98px)";

/** O elemento está numa janela de tela cheia que, neste tamanho de tela, ocupa o aparelho inteiro? */
export function inTelaCheia(el: Element | null | undefined): HTMLElement | null {
  if (!el || typeof window === "undefined" || !window.matchMedia?.(TELA_CHEIA_QUERY).matches) return null;
  return el.closest<HTMLElement>(`.${TELA_CHEIA_CLASS}`);
}
