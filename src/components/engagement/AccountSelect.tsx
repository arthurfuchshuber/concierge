import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { adminListCustomers } from "@/lib/admin-subs.functions";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronDown, Search, Users, Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function AccountSelect({
  value, onChange, compact = false,
}: {
  value: string | null; // null = self / minha conta
  onChange: (userId: string | null, name: string | null) => void;
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

  const filtered = useMemo(() => {
    const list = (q.data?.customers ?? []).filter(
      (c) => c.subscription?.status === "active" || c.subscription?.status === "trialing",
    );
    const term = search.trim().toLowerCase();
    const out = term
      ? list.filter(
          (c) =>
            (c.fullName ?? "").toLowerCase().includes(term) ||
            (c.email ?? "").toLowerCase().includes(term),
        )
      : list;
    return [...out].sort((a, b) => {
      const na = (a.fullName ?? a.email ?? "").toLowerCase();
      const nb = (b.fullName ?? b.email ?? "").toLowerCase();
      return na.localeCompare(nb, "pt-BR");
    });
  }, [q.data, search]);

  const selectedName = useMemo(() => {
    if (!value) return null;
    const found = (q.data?.customers ?? []).find((c) => c.userId === value);
    return found?.fullName ?? found?.email ?? "Cliente";
  }, [value, q.data]);

  const label = selectedName ?? "Minha conta";

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
      <PopoverContent align="start" className="w-[300px] p-0 rounded-md">
        <div className="p-2 border-b border-border">
          <div className="relative">
            <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              placeholder="Buscar cliente…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-xs"
            />
          </div>
        </div>
        <div className="max-h-72 overflow-y-auto py-1">
          <button
            type="button"
            onClick={() => { onChange(null, null); setOpen(false); }}
            className="w-full px-3 py-2 flex items-center gap-2 text-left text-xs hover:bg-secondary/60"
          >
            <div className={cn("flex size-4 items-center justify-center rounded-sm border", !value ? "bg-primary border-primary text-primary-foreground" : "border-border")}>
              {!value && <Check className="size-3" />}
            </div>
            <span>Minha conta</span>
          </button>
          {q.isLoading ? (
            <div className="p-6 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
              <Loader2 className="size-3.5 animate-spin" /> Carregando…
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">Nenhum cliente.</div>
          ) : (
            filtered.map((c) => {
              const name = c.fullName || c.email || "(sem nome)";
              const active = value === c.userId;
              return (
                <button
                  key={c.userId}
                  type="button"
                  onClick={() => { onChange(c.userId, name); setOpen(false); }}
                  className={cn("w-full px-3 py-2 flex items-center gap-2 text-left text-xs", active ? "bg-accent/10" : "hover:bg-secondary/60")}
                >
                  <div className={cn("flex size-4 items-center justify-center rounded-sm border shrink-0", active ? "bg-primary border-primary text-primary-foreground" : "border-border")}>
                    {active && <Check className="size-3" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{name}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{c.email}</div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
