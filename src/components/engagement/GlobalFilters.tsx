import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetFooter } from "@/components/ui/sheet";
import { PropertyMultiSelect } from "./PropertyMultiSelect";
import { AccountMultiSelect } from "./AccountMultiSelect";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { cn } from "@/lib/utils";

export type EngagementFilters = {
  period: "7d" | "30d" | "90d" | "all";
  propertyIds: string[]; // ["all"] or list of ids
  device: "all" | "mobile" | "tablet" | "desktop";
};

type Props = {
  filters: EngagementFilters;
  onChange: (patch: Partial<EngagementFilters>) => void;
  properties: Array<{ id: string; name: string }>;
  accountId: string | null;
  onAccountChange: (userId: string | null, name: string | null) => void;
  className?: string;
};

export function FiltersIconButton({
  filters, onChange, properties, accountId, onAccountChange, className,
}: Props) {
  const [open, setOpen] = useState(false);
  const activeCount =
    (filters.period !== "30d" ? 1 : 0) +
    (filters.propertyIds.length > 0 && !filters.propertyIds.includes("all") ? 1 : 0) +
    (filters.device !== "all" ? 1 : 0) +
    (accountId ? 1 : 0);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Filtros"
          className={cn("relative size-9 rounded-full shrink-0 bg-transparent hover:bg-transparent border-0 shadow-none text-foreground", className)}
        >

          <Filter className="size-4" />
          {activeCount > 0 && (
            <Badge
              variant="secondary"
              className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full text-[9px] font-semibold flex items-center justify-center bg-primary text-primary-foreground"
            >
              {activeCount}
            </Badge>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[min(92vw,380px)] sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Filtros</SheetTitle>
        </SheetHeader>
        <div className="space-y-5 py-4">
          <div>
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Conta</label>
            <div className="mt-1.5">
              <AccountSelect value={accountId} onChange={onAccountChange} compact />
            </div>
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Imóveis</label>
            <div className="mt-1.5">
              <PropertyMultiSelect
                selected={filters.propertyIds}
                onChange={(v) => onChange({ propertyIds: v })}
                properties={properties}
                compact
              />
            </div>
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Período</label>
            <Select value={filters.period} onValueChange={(v) => onChange({ period: v as EngagementFilters["period"] })}>
              <SelectTrigger className="mt-1.5 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Últimos 7 dias</SelectItem>
                <SelectItem value="30d">Últimos 30 dias</SelectItem>
                <SelectItem value="90d">Últimos 90 dias</SelectItem>
                <SelectItem value="all">Tudo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Dispositivo</label>
            <Select value={filters.device} onValueChange={(v) => onChange({ device: v as EngagementFilters["device"] })}>
              <SelectTrigger className="mt-1.5 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="mobile">Mobile</SelectItem>
                <SelectItem value="tablet">Tablet</SelectItem>
                <SelectItem value="desktop">Desktop</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <SheetFooter className="flex-row gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => {
              onChange({ period: "30d", propertyIds: ["all"], device: "all" });
              onAccountChange(null, null);
            }}
          >
            Limpar
          </Button>
          <Button className="flex-1" onClick={() => setOpen(false)}>Aplicar</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
