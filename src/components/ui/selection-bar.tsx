import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * PADRÃO DE SELEÇÃO MÚLTIPLA (regra do sistema, mockup IA no Airbnb, 15/11/2026):
 *  - entra segurando um item (toque longo), SEM checkbox; depois é só tocar nos demais;
 *  - item selecionado ganha `SELECTED_ITEM_CLASS` (tom neutro, nada gritante);
 *  - a linha de controle é `SelectionBar`: "N Selecionados" à esquerda e, à direita,
 *    o X "Remover seleção" + "Selecionar Todos" / "Desmarcar Todos".
 */
export const SELECTED_ITEM_CLASS =
  "border-foreground/[0.28] bg-[color-mix(in_oklab,var(--foreground)_11%,var(--card))]";

/** Mesmo tom, para cartões cuja casca (`PANEL_SHELL`) já define fundo e borda. */
export const SELECTED_ITEM_IMPORTANT_CLASS =
  "!border-foreground/[0.28] !bg-[color-mix(in_oklab,var(--foreground)_11%,var(--card))]";

export function SelectionBar({
  count,
  allSelected,
  onClear,
  onToggleAll,
  className,
}: {
  count: number;
  allSelected: boolean;
  onClear: () => void;
  onToggleAll: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3 text-[12px]", className)}>
      <span className="font-bold">
        {count} {count === 1 ? "Selecionado" : "Selecionados"}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Remover seleção"
          title="Remover seleção"
          onClick={onClear}
          className="grid size-6 place-items-center rounded-[7px] text-muted-foreground transition-colors hover:text-foreground [&_svg]:size-3.5"
        >
          <X strokeWidth={2.2} />
        </button>
        <button
          type="button"
          onClick={onToggleAll}
          className="font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          {allSelected ? "Desmarcar Todos" : "Selecionar Todos"}
        </button>
      </div>
    </div>
  );
}
