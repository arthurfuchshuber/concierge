/**
 * X OFICIAL DE CANTO — padrão do sistema inteiro (opção C do mockup aprovado em 08/11/2026: o X da janela
 * "Detalhes da limpeza"). Aba de 32px colada no canto superior direito, curva de 12px embaixo à esquerda,
 * canto de cima acompanhando o raio da janela, VÉU ESCURO TRANSLÚCIDO (preto 35%, 55% no hover/toque) e
 * ícone branco. Antes a aba usava um tom sólido misturado do `--card`, quase igual ao da janela porém
 * acinzentado: virava uma "mancha" quadrada que apagava o filete dourado do topo.
 * TOM QUE ACOMPANHA O TEMA (08/11/2026, pedido do titular): o véu preto gritava no tema claro e sumia no
 * escuro. Agora a aba é a cor do TEXTO do tema (`--foreground`) a 9% (16% no hover) e o ícone a 70%
 * (100% no hover): no claro vira um bege suave; no escuro, um marfim discreto que aparece.
 * Toda janela/painel/bolha com X de canto usa ESTA classe — nunca uma cópia local.
 */
export const CORNER_CLOSE_CLASS =
  "absolute right-0 top-0 z-[10] grid size-8 cursor-pointer place-items-center rounded-bl-[12px] rounded-tr-[calc(var(--win-radius,12px)-1px)] bg-[color-mix(in_oklab,var(--foreground)_9%,transparent)] text-foreground/70 transition-colors hover:bg-[color-mix(in_oklab,var(--foreground)_16%,transparent)] hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none";

/**
 * "VOLTAR" DE CANTO (11/11/2026, mockup aprovado): quando a ação da janela é VOLTAR (ex.: do detalhe de um
 * lançamento para a lista, dentro da MESMA janela), a aba do canto superior direito vira "‹ Voltar" no lugar do
 * "X" — mesma aba, mesma curva e mesmo tom do X oficial, só mais larga (ícone + palavra). Nunca um botão
 * "Voltar" solto no corpo da janela. Quem fecha de vez é o "X" da tela de origem. Use `DialogContent onBack`.
 */
export const CORNER_BACK_CLASS =
  "absolute right-0 top-0 z-[10] flex h-8 cursor-pointer items-center gap-0.5 rounded-bl-[12px] rounded-tr-[calc(var(--win-radius,12px)-1px)] bg-[color-mix(in_oklab,var(--foreground)_9%,transparent)] pl-2.5 pr-3.5 text-[12px] font-bold text-foreground/80 transition-colors hover:bg-[color-mix(in_oklab,var(--foreground)_16%,transparent)] hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";
