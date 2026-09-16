import { describe, expect, it } from "vitest";
import { fitColumns } from "@/hooks/useAntiClipColumns";

/**
 * A regra ANTI-CORTE em números. O que estes testes protegem é uma frase só:
 * em nenhuma largura de tela um dia pode aparecer pela metade.
 */
const MIN = 56;

describe("fitColumns — regra anti-corte das colunas do gráfico", () => {
  it("sem medida ainda, não decide nada", () => {
    expect(fitColumns(undefined, 7, MIN)).toEqual({
      viewportWidth: undefined,
      contentWidth: undefined,
      spacer: 0,
      scrolls: false,
    });
  });

  it("cabendo todos os dias, ocupa a largura inteira e não rola", () => {
    // 7 dias × 56 = 392, e sobra espaço: as colunas se esticam.
    const r = fitColumns(500, 7, MIN);
    expect(r.scrolls).toBe(false);
    expect(r.viewportWidth).toBe(500);
    expect(r.contentWidth).toBe(500);
    expect(r.spacer).toBe(0);
  });

  it("no limite exato (largura = dias × mínimo) ainda não rola", () => {
    const r = fitColumns(7 * MIN, 7, MIN);
    expect(r.scrolls).toBe(false);
    expect(r.spacer).toBe(0);
  });

  it("não cabendo, rola — e a janela vira múltiplo exato da coluna", () => {
    // 360px comportam 6 colunas inteiras (336) e sobram 24.
    const r = fitColumns(360, 7, MIN);
    expect(r.scrolls).toBe(true);
    expect(r.viewportWidth).toBe(6 * MIN);
    expect(r.contentWidth).toBe(7 * MIN);
    expect(r.spacer).toBe(24);
  });

  it("a janela NUNCA corta uma coluna, em nenhuma largura", () => {
    for (let largura = 60; largura <= 1200; largura++) {
      for (const dias of [7, 14, 30]) {
        const r = fitColumns(largura, dias, MIN);
        if (!r.scrolls) continue;
        // A propriedade central: a área visível é sempre um número inteiro
        // de colunas — logo nenhuma delas pode ficar pela metade.
        expect(r.viewportWidth! % MIN).toBe(0);
        // E o espaçador é exatamente a sobra, nunca negativo nem maior que
        // uma coluna inteira (senão caberia mais um dia).
        expect(r.spacer).toBe(largura - r.viewportWidth!);
        expect(r.spacer).toBeGreaterThanOrEqual(0);
        expect(r.spacer).toBeLessThan(MIN);
      }
    }
  });

  it("numa tela estreita demais, mostra uma coluna em vez de nenhuma", () => {
    const r = fitColumns(40, 7, MIN);
    expect(r.scrolls).toBe(true);
    expect(r.viewportWidth).toBe(MIN);
    // Aqui a janela é MAIOR que o disponível — é a única saída honesta: o
    // alternativo seria não mostrar dia nenhum.
    expect(r.spacer).toBe(0);
  });
});
