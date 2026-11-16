import { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
  FILTER_PANEL_CLASS,
  FILTER_PANEL_COLLISION,
  FILTER_PANEL_OFFSET,
  FilterMultiSelect,
  FilterScreenHeader,
  type FilterMultiOption,
} from "@/components/dashboard/filter-panel";
import { ChevronDown, Home } from "lucide-react";
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

  const options = useMemo<FilterMultiOption[]>(() => properties.map((p) => ({ value: p.id, label: p.name })), [properties]);
  // "Todos" (vazio ou ["all"]) = nada marcado; marcar tudo ou desmarcar tudo volta para "Todos".
  function change(next: string[]) {
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
      <PopoverContent
        align="start"
        sideOffset={FILTER_PANEL_OFFSET}
        collisionPadding={FILTER_PANEL_COLLISION}
        className={FILTER_PANEL_CLASS}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <FilterScreenHeader icon={Home} title="Imóveis" />
        <FilterMultiSelect
          options={options}
          selected={isAll ? [] : selected}
          onChange={change}
          searchPlaceholder="Buscar imóvel..."
          emptyLabel="Nenhum imóvel."
        />
      </PopoverContent>
    </Popover>
  );
}
