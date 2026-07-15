import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CalendarRange, Smartphone, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetFooter } from "@/components/ui/sheet";
import { PropertyMultiSelect } from "./PropertyMultiSelect";
import { useState } from "react";

export type EngagementFilters = {
  period: "7d" | "30d" | "90d" | "all";
  propertyIds: string[]; // ["all"] or list of ids
  device: "all" | "mobile" | "tablet" | "desktop";
};

type Props = {
  filters: EngagementFilters;
  onChange: (patch: Partial<EngagementFilters>) => void;
  properties: Array<{ id: string; name: string }>;
};

export function GlobalFilters({ filters, onChange, properties }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const activeCount =
    (filters.period !== "30d" ? 1 : 0) +
    (filters.propertyIds.length > 0 && !filters.propertyIds.includes("all") ? 1 : 0) +
    (filters.device !== "all" ? 1 : 0);

  return (
    <div className="sticky top-0 z-20 -mx-4 sm:mx-0 px-4 sm:px-0 bg-background/85 backdrop-blur border-b border-border/60 py-3">
      {/* Mobile: um único botão */}
      <div className="flex sm:hidden items-center gap-2">
        <Badge variant="outline" className="text-[10px] uppercase tracking-wider shrink-0">Filtros</Badge>
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 flex-1 justify-between text-xs font-normal">
              <span className="flex items-center gap-1.5">
                <SlidersHorizontal className="size-3.5" />
                {activeCount > 0 ? `${activeCount} filtro${activeCount > 1 ? "s" : ""} ativo${activeCount > 1 ? "s" : ""}` : "Ajustar filtros"}
              </span>
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="rounded-t-2xl max-h-[85vh]">
            <SheetHeader>
              <SheetTitle>Filtros</SheetTitle>
            </SheetHeader>
            <div className="space-y-5 py-4">
              <div>
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Período</label>
                <Select value={filters.period} onValueChange={(v) => onChange({ period: v as EngagementFilters["period"] })}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7d">Últimos 7 dias</SelectItem>
                    <SelectItem value="30d">Últimos 30 dias</SelectItem>
                    <SelectItem value="90d">Últimos 90 dias</SelectItem>
                    <SelectItem value="all">Tudo</SelectItem>
                  </SelectContent>
                </Select>
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
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Dispositivo</label>
                <Select value={filters.device} onValueChange={(v) => onChange({ device: v as EngagementFilters["device"] })}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
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
              <Button variant="outline" className="flex-1" onClick={() => { onChange({ period: "30d", propertyIds: ["all"], device: "all" }); }}>
                Limpar
              </Button>
              <Button className="flex-1" onClick={() => setMobileOpen(false)}>Aplicar</Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>

      {/* Desktop: linha horizontal */}
      <div className="hidden sm:flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="text-[10px] uppercase tracking-wider">Filtros</Badge>

        <div className="flex items-center gap-1.5">
          <CalendarRange className="size-3.5 text-muted-foreground" />
          <Select value={filters.period} onValueChange={(v) => onChange({ period: v as EngagementFilters["period"] })}>
            <SelectTrigger className="h-8 w-[128px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Últimos 7 dias</SelectItem>
              <SelectItem value="30d">Últimos 30 dias</SelectItem>
              <SelectItem value="90d">Últimos 90 dias</SelectItem>
              <SelectItem value="all">Tudo</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <PropertyMultiSelect
          selected={filters.propertyIds}
          onChange={(v) => onChange({ propertyIds: v })}
          properties={properties}
        />

        <div className="flex items-center gap-1.5">
          <Smartphone className="size-3.5 text-muted-foreground" />
          <Select value={filters.device} onValueChange={(v) => onChange({ device: v as EngagementFilters["device"] })}>
            <SelectTrigger className="h-8 w-[128px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="mobile">Mobile</SelectItem>
              <SelectItem value="tablet">Tablet</SelectItem>
              <SelectItem value="desktop">Desktop</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
