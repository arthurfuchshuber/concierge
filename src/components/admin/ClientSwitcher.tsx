import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { adminListCustomers } from "@/lib/admin-subs.functions";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { ChevronDown, Search, Users, Loader2, X } from "lucide-react";
import { useImpersonation, setImpersonation } from "@/hooks/useImpersonation";

type StatusFilter = "active" | "canceled";

const STATUS_LABEL: Record<StatusFilter, string> = {
  active: "Ativos",
  canceled: "Cancelados",
};

function matchesStatus(status: string | undefined | null, f: StatusFilter): boolean {
  if (f === "active") return status === "active" || status === "trialing";
  return status === "canceled";
}

export function ClientSwitcher() {
  const listFn = useServerFn(adminListCustomers);
  const navigate = useNavigate();
  const { impersonation, clear } = useImpersonation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("active");

  const q = useQuery({
    queryKey: ["admin-customers"],
    queryFn: () => listFn(),
    staleTime: 60_000,
  });

  const filtered = useMemo(() => {
    const list = (q.data?.customers ?? []).filter((c) =>
      matchesStatus(c.subscription?.status, status),
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
  }, [q.data, status, search]);

  function pick(userId: string, name: string, email: string | null) {
    setImpersonation({ userId, name, email });
    setOpen(false);
    navigate({ to: "/admin/guias" });
  }

  function exit(e: React.MouseEvent) {
    e.stopPropagation();
    clear();
    navigate({ to: "/admin/guias" });
  }

  const label = impersonation?.name || impersonation?.email || "Acessar cliente";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-md text-sm border transition-colors text-left ${
            impersonation
              ? "border-accent/40 bg-accent/10 hover:bg-accent/15"
              : "border-border bg-secondary/40 hover:bg-secondary"
          }`}
        >
          <Users className="size-4 shrink-0" />
          <span className={`flex-1 truncate ${impersonation ? "text-foreground font-medium" : "text-foreground/80"}`}>
            {label}
          </span>
          {impersonation ? (
            <span
              role="button"
              tabIndex={0}
              onClick={exit}
              aria-label="Sair da visualização"
              className="size-5 grid place-items-center rounded text-muted-foreground hover:text-foreground hover:bg-background/60"
            >
              <X className="size-3.5" />
            </span>
          ) : (
            <ChevronDown className="size-4 shrink-0 opacity-60" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0 rounded-md" align="start" sideOffset={8}>
        <div className="p-3 border-b border-border space-y-2">
          <div className="relative">
            <Search className="size-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              placeholder="Buscar por nome ou email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9 rounded-md"
            />
          </div>
          <div className="flex gap-1">
            {(Object.keys(STATUS_LABEL) as StatusFilter[]).map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={`text-[11px] uppercase tracking-wider px-2.5 py-1 rounded-md border transition ${
                  status === s
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:bg-secondary"
                }`}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {q.isLoading ? (
            <div className="p-6 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
              <Loader2 className="size-3.5 animate-spin" /> Carregando clientes…
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">
              Nenhum cliente encontrado.
            </div>
          ) : (
            <ul className="py-1">
              {filtered.map((c) => {
                const name = c.fullName || c.email || "(sem nome)";
                const subStatus = c.subscription?.status ?? "—";
                const plan = c.subscription?.plan ?? "—";
                const active = impersonation?.userId === c.userId;
                return (
                  <li key={c.userId}>
                    <button
                      onClick={() => pick(c.userId, name, c.email)}
                      className={`w-full px-3 py-2 flex items-center gap-3 text-left ${
                        active ? "bg-accent/10" : "hover:bg-secondary/60"
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{name}</div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {c.email} · {plan} · {subStatus}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
