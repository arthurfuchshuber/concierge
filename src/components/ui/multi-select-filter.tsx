import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

/**
 * Campo de filtro com busca e múltipla seleção — pensado para viver dentro
 * de um Popover de "Filtros" (como em Stakeholders) e ser reaproveitado nos
 * demais filtros do sistema, mantendo sempre a mesma dinâmica: rótulo do
 * campo, contagem de selecionados com atalho para limpar, busca e uma lista
 * com checkbox por opção.
 */
export function MultiSelectFilterField({
  label,
  options,
  selected,
  onChange,
  searchPlaceholder = "Buscar…",
  emptyLabel = "Nenhum resultado.",
  className,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  selected: string[];
  onChange: (next: string[]) => void;
  searchPlaceholder?: string;
  emptyLabel?: string;
  className?: string;
}) {
  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  return (
    <div className={className}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
          {label}
        </span>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="inline-flex items-center gap-1 text-[11px] text-accent hover:text-foreground transition-colors"
          >
            {selected.length} selecionado{selected.length > 1 ? "s" : ""}
            <X className="size-3" />
          </button>
        )}
      </div>
      <Command className="rounded-none border border-border bg-background/40">
        {options.length > 6 && (
          <CommandInput placeholder={searchPlaceholder} className="h-8 text-xs" />
        )}
        <CommandList className="max-h-40 sg-elegant-scroll">
          <CommandEmpty className="py-4 text-center text-xs text-muted-foreground">
            {emptyLabel}
          </CommandEmpty>
          <CommandGroup>
            {options.map((opt) => {
              const active = selected.includes(opt.value);
              return (
                <CommandItem
                  key={opt.value}
                  value={opt.label}
                  onSelect={() => toggle(opt.value)}
                  className="cursor-pointer gap-2 text-xs"
                >
                  <span
                    className={cn(
                      "flex size-3.5 shrink-0 items-center justify-center rounded-sm border border-border",
                      active ? "border-foreground bg-foreground text-background" : "opacity-50",
                    )}
                  >
                    {active && <Check className="size-3" />}
                  </span>
                  <span className="truncate">{opt.label}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  );
}
