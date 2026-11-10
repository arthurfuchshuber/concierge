/**
 * Casca das janelas amplas de limpeza/custo (07/11/2026): grafite quente, fio
 * de luz no topo e o "X" OFICIAL do `DialogContent` (nada de "X" improvisado).
 * Use no `DialogContent` de toda janela ampla (listas/detalhes) do painel; o
 * cabeçalho segue `DialogHeader px-4 pt-3.5 pb-0 pr-14` + título 14px.
 */
export const WIDE_WINDOW_CLASS =
  "sg-vv-center flex max-h-[90dvh] w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-md rounded-[var(--win-radius)] border-[var(--panel-border)] bg-[var(--panel)] shadow-[0_30px_80px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.05)] before:pointer-events-none before:absolute before:inset-x-8 before:top-0 before:h-px before:content-[''] before:bg-[image:var(--panel-hair)]";

/**
 * JANELA DO FINANCEIRO (pedido explícito, 10/11/2026): a faixa do "Valor total" vai de FORA A FORA da
 * janela (sem a margem interna de 24px que o DialogContent aplica no desktop). Quem usa esta classe
 * devolve o recuo de 24px ao cabeçalho e à lista (`sm:mx-6`) e o texto da faixa fica alinhado a eles
 * (`sm:px-10`), então nada além da faixa muda de lugar.
 */
export const FINANCE_WINDOW_CLASS = `${WIDE_WINDOW_CLASS} sm:!p-0`;

/** Título de janela em "sentence case" ("Check-ins Pendentes" → "Check-ins pendentes"). */
export function windowTitle(text: string): string {
  const t = text.trim();
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}
