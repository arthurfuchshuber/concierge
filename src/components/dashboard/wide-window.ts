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

/** Palavras de ligação que ficam minúsculas no meio de um título ("Fila de Limpeza"). */
const TITLE_CONNECTORS = new Set([
  "a", "à", "ao", "aos", "as", "às", "com", "da", "das", "de", "do", "dos", "e", "em", "na", "nas", "no", "nos", "o", "os", "ou", "para", "pela", "pelas", "pelo", "pelos", "por",
]);

/**
 * TÍTULO DE JANELA COM AS INICIAIS MAIÚSCULAS (regra de 18/11/2026, vale para todas as janelas):
 * "check-ins pendentes" → "Check-ins Pendentes", "FILA DE LIMPEZA" → "Fila de Limpeza". As palavras de
 * ligação (de, da, do, e, em…) ficam minúsculas, menos quando abrem o título.
 */
export function windowTitle(text: string): string {
  return text
    .trim()
    .split(/\s+/)
    .map((w, i) => {
      const low = w.toLowerCase();
      if (i > 0 && TITLE_CONNECTORS.has(low)) return low;
      return low.charAt(0).toUpperCase() + low.slice(1);
    })
    .join(" ");
}
