import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CalendarRange, Home, Smartphone } from "lucide-react";

export type EngagementFilters = {
  period: "7d" | "30d" | "90d" | "all";
  propertyId: string;
  device: "all" | "mobile" | "tablet" | "desktop";
};

type Props = {
  filters: EngagementFilters;
  onChange: (patch: Partial<EngagementFilters>) => void;
  properties: Array<{ id: string; name: string }>;
};

export function GlobalFilters({ filters, onChange, properties }: Props) {
  return (
    <div className="sticky top-0 z-20 -mx-4 sm:mx-0 px-4 sm:px-0 bg-background/85 backdrop-blur border-b border-border/60 py-3 flex flex-wrap items-center gap-2">
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

      <div className="flex items-center gap-1.5">
        <Home className="size-3.5 text-muted-foreground" />
        <Select value={filters.propertyId} onValueChange={(v) => onChange({ propertyId: v })}>
          <SelectTrigger className="h-8 w-[200px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os imóveis</SelectItem>
            {properties.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

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
  );
}
