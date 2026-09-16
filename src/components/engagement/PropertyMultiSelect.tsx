import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Check, ChevronDown, Home } from "lucide-react";
import { cn } from "@/lib/utils";

type Prop = { id: string; name: string };

export function PropertyMultiSelect({
  selected, onChange, properties, compact = false,
}: {
  selected: string[]; // [] || ["all"] || specific ids
  onChange: (next: string[]) => void;
  properties: Prop[];
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const isAll = selected.length === 0 || selected.includes("all");
  const label = isAll
    ? `Todos os imóveis${properties.length > 0 ? ` (${properties.length})` : ""}`
    : selected.length === 1
    ? properties.find((p) => p.id === selected[0])?.name ?? "1 imóvel"
    : `${selected.length} imóveis`;

  function toggle(id: string) {
    if (isAll) { onChange([id]); return; }
    const set = new Set(selected);
    if (set.has(id)) set.delete(id); else set.add(id);
    const next = Array.from(set);
    onChange(next.length === 0 || next.length === properties.length ? ["all"] : next);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("h-8 justify-between gap-2 text-xs font-normal", compact ? "w-full" : "w-[220px]")}
        >
          <span className="flex items-center gap-1.5 truncate">
            <Home className="size-3.5 text-muted-foreground shrink-0" />
            <span className="truncate">{label}</span>
          </span>
          <ChevronDown className="size-3.5 opacity-60 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="p-0 w-[280px]">
        <Command>
          <CommandInput placeholder="Buscar imóvel…" className="h-9" />
          <CommandList>
            <CommandEmpty>Nenhum imóvel.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                onSelect={() => onChange(["all"])}
                className="text-xs"
              >
                <div className={cn("mr-2 flex size-4 items-center justify-center rounded-sm border", isAll ? "bg-primary border-primary text-primary-foreground" : "border-border")}>
                  {isAll && <Check className="size-3" />}
                </div>
                Selecionar todos
              </CommandItem>
              {!isAll && (
                <CommandItem onSelect={() => onChange(["all"])} className="text-xs text-muted-foreground">
                  Limpar seleção
                </CommandItem>
              )}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              {properties.map((p) => {
                const checked = !isAll && selected.includes(p.id);
                return (
                  <CommandItem key={p.id} onSelect={() => toggle(p.id)} className="text-xs">
                    <div className={cn("mr-2 flex size-4 items-center justify-center rounded-sm border", checked ? "bg-primary border-primary text-primary-foreground" : "border-border")}>
                      {checked && <Check className="size-3" />}
                    </div>
                    <span className="truncate">{p.name}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
