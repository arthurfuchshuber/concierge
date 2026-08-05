import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Building2, ChevronDown, Check } from "lucide-react";
import { setImpersonation } from "@/hooks/useImpersonation";
import { useActiveAccount } from "@/hooks/useActiveAccount";

/**
 * For team members (users invited via account_members) — shows the active
 * account/company and lets them switch between the accounts they belong to.
 * A seleção automática da única empresa vinculada acontece em
 * `useActiveAccount`, para valer em todas as páginas do painel.
 *
 * Hidden entirely for SaaS admins (they already have ClientSwitcher).
 */
export function AccountSwitcher() {
  const { isAdmin, accounts, hasOwn, impersonation, query: q } = useActiveAccount();
  const [open, setOpen] = useState(false);

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
