/**
 * REGRA GLOBAL DE ABERTURA DE TOOLTIPS, POPOVERS E MENUS.
 *
 * Pedido explícito (08/09/2026): "nenhum tooltip/quadrante pode ser aberto para
 * o lado que estiver mais propício a ficar escondido — se houver qualquer
 * chance, então a abertura tem que ser para o lado oposto".
 *
 * O Radix já vira o painel para o lado oposto sozinho quando não cabe. O que
 * ele não sabe é que a tela NÃO termina onde o viewport termina: o app tem uma
 * barra de navegação fixa embaixo e um cabeçalho fixo em cima, e os dois ficam
 * POR CIMA de qualquer painel. Para o Radix havia espaço; para os olhos, o
 * calendário abria por baixo da barra e ficava cortado (caso real: o seletor de
 * data prevista, aberto num card do fim da lista).
 *
 * A correção é contar essas faixas como se fossem borda da tela. Com elas na
 * conta, "não cabe embaixo" passa a ser verdade antes de o painel encostar na
 * barra — e o Radix abre para cima, que é exatamente a regra pedida.
 *
 * Os valores são folgados de propósito. Errar para o lado de virar cedo demais
 * custa um painel abrindo para cima sem precisar; errar para o outro lado custa
 * um painel ilegível.
 */
export const OVERLAY_COLLISION_PADDING = {
  /** Cabeçalho fixo do app. */
  top: 72,
  right: 12,
  /** Barra de navegação inferior fixa + área segura do aparelho. */
  bottom: 96,
  left: 12,
} as const;
