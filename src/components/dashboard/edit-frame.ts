/**
 * MOLDURA DO DADO EDITÁVEL (07/11/2026) — uma só para todo o painel de limpeza
 * e financeiro: Tipo, Prestador e Valor usam exatamente este quadrante, JUSTO
 * ao texto (o mesmo respiro do valor "R$ 100,00"), sem ícone de lápis.
 * Sem permissão de editar, o dado aparece como texto simples, sem moldura.
 */
export const EDIT_BTN =
  "ds-3d ds-3d-hover inline-flex h-[20px] shrink-0 items-center justify-center rounded-[0.3rem] border border-border/70 bg-card px-1.5 text-[11.5px] font-semibold leading-none shadow-sm transition";

/** Campo do valor em edição: mesma posição e altura da moldura. */
export const EDIT_INPUT =
  "h-[20px] w-[72px] shrink-0 rounded-[0.3rem] bg-card px-1 text-right text-[11.5px] font-semibold tabular-nums outline-none ring-1 ring-primary/80";
