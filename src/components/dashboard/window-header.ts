/**
 * CABEÇALHO PADRÃO DAS JANELAS (mesmo do "+ registro", Regra 5 de 14/11/2026): faixa de 48px, título
 * Manrope 14px negrito em UMA linha, subtítulo 12px, margem esquerda de 16px e filete embaixo.
 * O "X" (ou o "‹ Voltar") fica no canto direito, por isso o recuo `pr-14` (`pr-24` com o Voltar).
 */
export const WINDOW_HEADER_CLASS =
  "flex min-h-12 shrink-0 flex-col justify-center space-y-0 border-b border-[var(--panel-div)] py-1.5 pl-4 pr-14 text-left";
export const WINDOW_HEADER_BACK_CLASS =
  "flex min-h-12 shrink-0 flex-col justify-center space-y-0 border-b border-[var(--panel-div)] py-1.5 pl-4 pr-24 text-left";
export const WINDOW_TITLE_CLASS = "block truncate font-display text-[14px] font-bold leading-tight text-foreground";
export const WINDOW_SUBTITLE_CLASS = "mt-0.5 block truncate text-[12px] leading-tight text-muted-foreground";
