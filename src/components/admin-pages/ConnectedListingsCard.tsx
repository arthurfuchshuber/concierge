import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getConnectedListingsInventory } from "@/lib/channex.functions";
import { useImpersonation } from "@/hooks/useImpersonation";

/** Inventário de anúncios conectados ativos (gêmeos contam individualmente). */
export function ConnectedListingsCard() {
  const fn = useServerFn(getConnectedListingsInventory);
  const { impersonation } = useImpersonation();
  const accountOwnerId = impersonation?.userId ?? null;
  const q = useQuery({
    queryKey: ["connected-listings-inventory", accountOwnerId ?? "self"],
    queryFn: () => fn({ data: { accountOwnerId } }),
    retry: false,
  });
  if (!q.data) return null;
  const d = q.data;
  return (
    <div className="ds-surface space-y-2 bg-card p-5">
      <p className="text-xs font-medium text-foreground">
        {d.totalCount} anúncio(s) conectado(s) ativo(s)
      </p>
      <p className="text-[11px] text-muted-foreground">
        {d.primaryCount} principal(is) · {d.twinCount} gêmeo(s). Cada anúncio conta individualmente.
      </p>
      <p className="text-[11px] text-muted-foreground">
        Inventário ativo apurado para a futura cobrança por anúncio conectado. Não altera os valores nem as
        condições do seu plano atual.
      </p>
      {d.items.length > 0 && (
        <ul className="space-y-1">
          {d.items.map((i) => (
            <li key={i.listingId} className="flex min-w-0 items-start justify-between gap-3 text-xs">
              <span className="min-w-0 break-words text-muted-foreground">{i.name}</span>
              <span className="shrink-0 whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                {i.kind === "primary" ? "Principal" : "Gêmeo"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
