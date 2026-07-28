import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Building2, ChevronDown, Check } from "lucide-react";
import { listMyAccounts } from "@/lib/active-account.functions";
import { useImpersonation, setImpersonation } from "@/hooks/useImpersonation";
import { useIsAdmin } from "@/hooks/useIsAdmin";

/**
 * For team members (users invited via account_members) — shows the active
 * account/company and lets them switch between the accounts they belong to.
 * If the user only belongs to a single account and owns no properties, it
 * auto-selects that account on first render.
 *
 * Hidden entirely for SaaS admins (they already have ClientSwitcher).
 */
export function AccountSwitcher() {
  const { isAdmin } = useIsAdmin();
  const listFn = useServerFn(listMyAccounts);
  const q = useQuery({
    queryKey: ["my-accounts"],
    queryFn: () => listFn(),
    staleTime: 5 * 60_000,
    enabled: !isAdmin,
  });
  const { impersonation } = useImpersonation();
  const [open, setOpen] = useState(false);

  const accounts = useMemo(() => q.data?.accounts ?? [], [q.data]);
  const hasOwn = q.data?.hasOwnProperties ?? true;

  // Auto-select: se o usuário NÃO tem propriedades próprias, sempre garantimos
  // uma conta ativa — usa a primeira membership disponível. Isso evita que a
  // UI opere "sem conta" e vaze/oculte dados de forma inconsistente.
  useEffect(() => {
    if (isAdmin) return;
    if (!q.data) return;
    if (impersonation) return;
    if (hasOwn) return;
    if (accounts.length >= 1) {
      const a = accounts[0];
      setImpersonation({ userId: a.ownerId, name: a.name || a.email || "Conta", email: a.email });
    }
  }, [q.data, hasOwn, accounts, impersonation, isAdmin]);

  if (isAdmin) return null;
  if (!q.data) return null;
  // Nothing to switch: user is a plain host with only their own account.
  if (accounts.length === 0) return null;

  const totalOptions = accounts.length + (hasOwn ? 1 : 0);
  const activeLabel = impersonation ? (impersonation.name || impersonation.email || "Conta") : "Minha conta";

  function pickOwn() {
    setImpersonation(null);
    setOpen(false);
  }
  function pick(ownerId: string, name: string, email: string | null) {
    setImpersonation({ userId: ownerId, name, email });
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-md text-sm border border-border bg-secondary/40 hover:bg-secondary text-left transition-colors"
          disabled={totalOptions <= 1}
        >
          <Building2 className="size-4 shrink-0 text-primary" />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground leading-none">Empresa ativa</div>
            <div className="text-sm truncate mt-0.5">{activeLabel}</div>
          </div>
          {totalOptions > 1 && <ChevronDown className="size-4 shrink-0 opacity-60" />}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start" sideOffset={8}>
        <ul className="py-1 max-h-80 overflow-y-auto">
          {hasOwn && (
            <li>
              <button
                onClick={pickOwn}
                className={`w-full px-3 py-2 flex items-center gap-2 text-left text-sm ${!impersonation ? "bg-accent/10" : "hover:bg-secondary/60"}`}
              >
                <div className="flex-1 min-w-0 truncate">Minha conta</div>
                {!impersonation && <Check className="size-4 text-primary" />}
              </button>
            </li>
          )}
          {accounts.map((a) => {
            const active = impersonation?.userId === a.ownerId;
            const name = a.name || a.email || "(sem nome)";
            return (
              <li key={a.ownerId}>
                <button
                  onClick={() => pick(a.ownerId, name, a.email)}
                  className={`w-full px-3 py-2 flex items-center gap-2 text-left ${active ? "bg-accent/10" : "hover:bg-secondary/60"}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{name}</div>
                    <div className="text-[11px] text-muted-foreground truncate uppercase tracking-wider">{a.role}</div>
                  </div>
                  {active && <Check className="size-4 text-primary" />}
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
