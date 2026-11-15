import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * PADRÃO DE SELEÇÃO MÚLTIPLA (regra do sistema, mockup IA no Airbnb, 15/11/2026):
 *  - entra segurando um item (toque longo), SEM checkbox; depois é só tocar nos demais;
 *  - item selecionado ganha `SELECTED_ITEM_CLASS` (tom neutro: 9% do texto sobre o cartão no claro, 20% no escuro);
 *  - a linha de controle é `SelectionBar`, SEMPRE alinhada à direita e logo ABAIXO do campo de busca
 *    (a busca vem primeiro): "N Selecionados" + X "Remover seleção" + "Selecionar Todos" /
 *    "Desmarcar Todos", sem hífen. O "N Selecionados" e o X só aparecem com 1 ou mais itens
 *    selecionados; sem seleção sobra só o "Selecionar Todos". Janela somente leitura não mostra a linha.
 */
/**
 * Tom do item selecionado: 9% do texto sobre o cartão no tema CLARO (mais suave) e 20% no ESCURO.
 * Sem borda: a seleção é só o tom.
 */
export const SELECTED_ITEM_BG_CLASS =
  "bg-[color-mix(in_oklab,var(--foreground)_9%,var(--card))] dark:bg-[color-mix(in_oklab,var(--foreground)_20%,var(--card))]";

/** Mesmo tom com o filete neutro, para cartões que já têm borda própria (ex.: Guias). */
export const SELECTED_ITEM_CLASS = `border-foreground/[0.28] ${SELECTED_ITEM_BG_CLASS}`;

/** Mesmo tom, para cartões cuja casca (`PANEL_SHELL`) já define fundo e borda. */
export const SELECTED_ITEM_IMPORTANT_CLASS =
  "!border-foreground/[0.28] !bg-[color-mix(in_oklab,var(--foreground)_9%,var(--card))] dark:!bg-[color-mix(in_oklab,var(--foreground)_20%,var(--card))]";

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
    <div className={cn("flex items-center justify-end gap-1.5 text-[12px]", className)}>
      {count > 0 ? (
        <>
          <span className="font-bold">
            {count} {count === 1 ? "Selecionado" : "Selecionados"}
          </span>
          <button
            type="button"
            aria-label="Remover seleção"
            title="Remover seleção"
            onClick={onClear}
            className="grid size-6 place-items-center rounded-[7px] text-muted-foreground transition-colors hover:text-foreground [&_svg]:size-3.5"
          >
            <X strokeWidth={2.2} />
          </button>
        </>
      ) : null}
      <button
        type="button"
        onClick={onToggleAll}
        className="font-semibold text-muted-foreground transition-colors hover:text-foreground"
      >
        {allSelected ? "Desmarcar Todos" : "Selecionar Todos"}
      </button>
    </div>
  );
}
