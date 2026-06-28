import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { adminListCustomers, adminListUserProperties } from "@/lib/admin-subs.functions";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { ChevronDown, Search, Users, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { friendlyErrorMessage } from "@/lib/friendly-error";

type StatusFilter = "all" | "active" | "canceled" | "other";

const STATUS_LABEL: Record<StatusFilter, string> = {
  all: "Todos",
  active: "Ativos",
  canceled: "Cancelados",
  other: "Outros",
};

function matchesStatus(status: string | undefined | null, f: StatusFilter): boolean {
  if (f === "all") return true;
  if (f === "active") return status === "active" || status === "trialing";
  if (f === "canceled") return status === "canceled";
  return !["active", "trialing", "canceled"].includes(status ?? "");
}

export function ClientSwitcher() {
  const listFn = useServerFn(adminListCustomers);
  const propsFn = useServerFn(adminListUserProperties);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [loadingId, setLoadingId] = useState<string | null>(null);

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

  async function pick(userId: string, displayName: string) {
    setLoadingId(userId);
    try {
      const r = await propsFn({ data: { userId } });
      const first = r.properties?.[0];
      if (!first) {
        toast.message(`${displayName} ainda não tem nenhum guia cadastrado.`);
        return;
      }
      setOpen(false);
      navigate({ to: "/admin/properties/$id", params: { id: first.id } });
    } catch (e) {
      toast.error(friendlyErrorMessage(e));
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm border border-border bg-secondary/40 hover:bg-secondary transition-colors text-left"
        >
          <Users className="size-4 shrink-0" />
          <span className="flex-1 truncate text-foreground/80">Acessar cliente</span>
          <ChevronDown className="size-4 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start" sideOffset={8}>
        <div className="p-3 border-b border-border space-y-2">
          <div className="relative">
            <Search className="size-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              placeholder="Buscar por nome ou email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
          <div className="flex gap-1 flex-wrap">
            {(Object.keys(STATUS_LABEL) as StatusFilter[]).map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={`text-[11px] uppercase tracking-wider px-2.5 py-1 rounded-full border transition ${
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
                const status = c.subscription?.status ?? "—";
                const plan = c.subscription?.plan ?? "—";
                return (
                  <li key={c.userId}>
                    <button
                      onClick={() => pick(c.userId, name)}
                      disabled={loadingId === c.userId}
                      className="w-full px-3 py-2 flex items-center gap-3 hover:bg-secondary/60 text-left disabled:opacity-60"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{name}</div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {c.email} · {plan} · {status}
                        </div>
                      </div>
                      {loadingId === c.userId && <Loader2 className="size-3.5 animate-spin" />}
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
