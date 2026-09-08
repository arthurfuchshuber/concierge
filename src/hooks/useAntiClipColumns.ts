import { useCallback, useEffect, useRef, useState } from "react";

/**
 * ANTI-CORTE (regra global do projeto) aplicada a uma faixa de COLUNAS de
 * largura igual — hoje os gráficos por dia de "Limpeza Prevista 7d".
 *
 * `useAntiClipBar` resolve o caso de uma barra de itens de larguras
 * diferentes (abas, filtros), medindo item a item. Um gráfico não é isso: ele
 * é um desenho contínuo dividido em N fatias idênticas, e não existem
 * "filhos" para medir. A regra, porém, é a mesma e o pedido é literal
 * (08/09/2026): "quando não couber... o sistema precisa usar a regra anti
 * corte e tornar a visão passível de rolagem à direita".
 *
 * Como a regra se cumpre aqui, com colunas de largura uniforme:
 *
 *   1. Cada dia recebe uma largura mínima (`minColumnPx`) grande o bastante
 *      para o rótulo caber inteiro. Se os N dias couberem, a faixa se estica
 *      para 100% e não há rolagem nenhuma.
 *   2. Se não couberem, a faixa passa a rolar na horizontal. O rótulo NUNCA
 *      é comprimido, abreviado nem escondido — é para isso que a rolagem
 *      existe.
 *   3. O CORTE é evitado estreitando a JANELA, não o conteúdo: a área visível
 *      vira um múltiplo exato da largura da coluna, e o resto (`spacer`) fica
 *      como um espaçador INVISÍVEL à direita. Assim qualquer posição de
 *      rolagem mostra apenas colunas inteiras — nenhum dia aparece pela
 *      metade em nenhuma das duas bordas.
 *   4. Sem gradiente/máscara nas bordas — proibido pelo cliente.
 *
 * Devolve as medidas; quem chama monta o layout (janela + espaçador).
 */
export type AntiClipColumns = {
  /**
   * Vai no elemento que mede a largura TOTAL disponível.
   *
   * É um ref de CALLBACK, não um `useRef`, e isso é essencial: o elemento
   * medido só existe depois que os dados chegam (antes disso o gráfico é um
   * spinner) e volta a ser desmontado a cada recarga. Com `useRef` + efeito
   * de montagem, a medição rodava uma única vez — com o elemento ainda
   * inexistente — e a faixa nascia sem largura nenhuma.
   */
  ref: (node: HTMLDivElement | null) => void;
  /** Largura da janela que rola — sempre um múltiplo inteiro da coluna. */
  viewportWidth: number | undefined;
  /** Largura do conteúdo dentro da janela (colunas × largura da coluna). */
  contentWidth: number | undefined;
  /** Sobra à direita, que vira espaçador invisível. */
  spacer: number;
  /** Verdadeiro quando os dados não cabem e a faixa rola. */
  scrolls: boolean;
};

export function useAntiClipColumns(columns: number, minColumnPx: number): AntiClipColumns {
  const observerRef = useRef<ResizeObserver | null>(null);
  const [available, setAvailable] = useState<number | undefined>(undefined);

  const ref = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node) return;
    setAvailable(node.clientWidth);
    const ro = new ResizeObserver(() => setAvailable(node.clientWidth));
    ro.observe(node);
    observerRef.current = ro;
  }, []);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return { ref, ...fitColumns(available, columns, minColumnPx) };
}

/**
 * A conta da regra, separada da medição para poder ser testada sozinha
 * (ver `__tests__/useAntiClipColumns.test.ts`). Recebe a largura disponível e
 * devolve como a faixa deve ser montada.
 */
export function fitColumns(
  available: number | undefined,
  columns: number,
  minColumnPx: number,
): Omit<AntiClipColumns, "ref"> {
  if (!available || columns <= 0) {
    return { viewportWidth: undefined, contentWidth: undefined, spacer: 0, scrolls: false };
  }

  if (columns * minColumnPx <= available) {
    // Cabe: a faixa ocupa tudo e as colunas ficam mais largas que o mínimo.
    return { viewportWidth: available, contentWidth: available, spacer: 0, scrolls: false };
  }

  // Não cabe: a coluna fica no mínimo e a janela encolhe até o último dia
  // INTEIRO. Pelo menos uma coluna sempre — numa tela absurdamente estreita é
  // melhor rolar de um em um do que não caber nada.
  const visible = Math.max(1, Math.floor(available / minColumnPx));
  const viewportWidth = visible * minColumnPx;
  return {
    viewportWidth,
    contentWidth: columns * minColumnPx,
    spacer: Math.max(0, available - viewportWidth),
    scrolls: true,
  };
}
