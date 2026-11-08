/**
 * Casca das janelas amplas de limpeza/custo (07/11/2026): grafite quente, fio
 * de luz no topo e o "X" OFICIAL do `DialogContent` (nada de "X" improvisado).
 * Use no `DialogContent` de toda janela ampla (listas/detalhes) do painel; o
 * cabeçalho segue `DialogHeader px-4 pt-3.5 pb-0 pr-14` + título 14px.
 */
export const WIDE_WINDOW_CLASS =
  "sg-vv-center flex max-h-[90dvh] w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-md rounded-[var(--win-radius)] border-[var(--panel-border)] bg-[var(--panel)] shadow-[0_30px_80px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.05)] before:pointer-events-none before:absolute before:inset-x-8 before:top-0 before:h-px before:content-[''] before:bg-[image:var(--panel-hair)]";
