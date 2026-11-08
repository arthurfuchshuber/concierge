/**
 * X OFICIAL DE CANTO — padrão do sistema inteiro (opção C do mockup aprovado em 08/11/2026: o X da janela
 * "Detalhes da limpeza"). Aba de 32px colada no canto superior direito, curva de 12px embaixo à esquerda,
 * canto de cima acompanhando o raio da janela, VÉU ESCURO TRANSLÚCIDO (preto 35%, 55% no hover/toque) e
 * ícone branco. Antes a aba usava um tom sólido misturado do `--card`, quase igual ao da janela porém
 * acinzentado: virava uma "mancha" quadrada que apagava o filete dourado do topo.
 * Toda janela/painel/bolha com X de canto usa ESTA classe — nunca uma cópia local.
 */
export const CORNER_CLOSE_CLASS =
  "absolute right-0 top-0 z-[10] grid size-8 cursor-pointer place-items-center rounded-bl-[12px] rounded-tr-[calc(var(--win-radius,12px)-1px)] bg-black/35 text-white transition-colors hover:bg-black/55 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none";
