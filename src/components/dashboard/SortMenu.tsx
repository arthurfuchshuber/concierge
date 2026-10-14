import { useState } from "react";
import { ArrowUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  FILTER_PANEL_CLASS,
  FILTER_PANEL_COLLISION,
  FILTER_PANEL_OFFSET,
  FilterOptionRow,
} from "@/components/dashboard/filter-panel";
import {
  ACTION_BAR,
  ACTION_SEGMENT,
  ACTION_BUTTON_TONE,
  ACTION_ICON,
} from "@/components/dashboard/panel-chrome";

/**
 * O BOTÃO DE ORDENAR: só o ícone de seta para cima e para baixo, na mesma
 * peça (`ACTION_BAR`) dos botões de ação — mesma cor, altura e raio. Fora da
 * ordem padrão, um ponto de destaque no canto avisa que a lista está
 * reordenada (mesmo recurso do botão Filtros).
 */
export function SortMenu<T extends string>({
  value,
  defaultValue,
  options,
  onChange,
  title = "Ordenar imóveis por",
}: {
  value: T;
  defaultValue: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className={`${ACTION_BAR} !w-auto shrink-0`}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={`${ACTION_SEGMENT} ${ACTION_BUTTON_TONE}`}
            aria-label="Ordenar a lista"
            title="Ordenar a lista"
          >
            <ArrowUpDown className={ACTION_ICON} />
            {value !== defaultValue && (
              <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-accent" />
            )}
          </button>
        </PopoverTrigger>
      </div>
      <PopoverContent
        align="end"
        sideOffset={FILTER_PANEL_OFFSET}
        collisionPadding={FILTER_PANEL_COLLISION}
        className={FILTER_PANEL_CLASS}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div role="radiogroup" aria-label={title}>
          <p className="ds-eyebrow px-3.5 pb-1 pt-3 text-[12px] tracking-[0.09em] text-muted-foreground">
            {title}
          </p>
          {options.map((o, i) => (
            <FilterOptionRow
              key={o.value}
              label={o.label}
              selected={value === o.value}
              last={i === options.length - 1}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
