import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { adminListCustomers } from "@/lib/admin-subs.functions";
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
import { ChevronDown, Users, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function AccountMultiSelect({
  value, onChange, compact = false,
}: {
  value: string[]; // [] = minha conta
  onChange: (userIds: string[]) => void;
  compact?: boolean;
}) {
  const listFn = useServerFn(adminListCustomers);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const q = useQuery({
    queryKey: ["admin-customers-engajamento"],
    queryFn: () => listFn(),
    staleTime: 60_000,
  });

  const all = useMemo(() => {
    const list = (q.data?.customers ?? []).filter(
      (c) => c.subscription?.status === "active" || c.subscription?.status === "trialing",
    );
    return [...list].sort((a, b) => {
      const na = (a.fullName ?? a.email ?? "").toLowerCase();
      const nb = (b.fullName ?? b.email ?? "").toLowerCase();
      return na.localeCompare(nb, "pt-BR");
    });
  }, [q.data]);

  const selectedSet = useMemo(() => new Set(value), [value]);
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of all) m.set(c.userId, c.fullName || c.email || "Cliente");
    return m;
  }, [all]);

  const label =
    value.length === 0
      ? "Todas as contas"
      : value.length === 1
        ? (nameById.get(value[0]) ?? "1 conta")
        : `${value.length} contas`;

  const options = useMemo<FilterMultiOption[]>(
    () => all.map((c) => ({ value: c.userId, label: c.fullName || c.email || "(sem nome)", sublabel: c.fullName ? c.email : null })),
    [all],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("h-8 justify-between gap-2 text-xs font-normal", compact ? "w-full" : "w-[220px]")}
        >
          <span className="flex items-center gap-1.5 truncate">
            <Users className="size-3.5 text-muted-foreground shrink-0" />
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
        <FilterScreenHeader icon={Users} title="Contas" />
        {q.isLoading ? (
          <div className="flex items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Carregando…
          </div>
        ) : (
          <FilterMultiSelect
            options={options}
            selected={value}
            onChange={onChange}
            searchPlaceholder="Buscar cliente..."
            emptyLabel="Nenhum cliente."
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
