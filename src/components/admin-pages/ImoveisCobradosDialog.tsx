import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronUp, Receipt } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchActionRow } from "@/components/dashboard/SearchActionRow";
import { MiniSwitch } from "@/components/admin-pages/admin-mobile-ui";
import { getConnectedListingsInventory } from "@/lib/channex.functions";
import { listAirbnbAccountListings, setAirbnbListingActive } from "@/lib/airbnb-account.functions";
import { useImpersonation } from "@/hooks/useImpersonation";
import { friendlyErrorMessage } from "@/lib/friendly-error";

/** O título vem como "nome interno · título do anúncio": a janela mostra só o título do anúncio. */
function publicTitle(t: string) {
  const i = t.indexOf(" · ");
  return i >= 0 ? t.slice(i + 3).trim() || t : t;
}

/**
 * Janela "Imóveis Cobrados" (mockup aprovado, 05/11/2026): busca, proprietários em sanfona (um aberto
 * por vez), anúncios com a chavinha de ativar/desativar e, nos que têm, a bolinha numerada do anúncio
 * gêmeo (abre o tooltip). A cobrança é por anúncio, então o gêmeo conta como qualquer outro.
 * Desativar não apaga dados: só para de receber informações a partir do dia.
 */
export function ImoveisCobradosDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { impersonation } = useImpersonation();
  const accountOwnerId = impersonation?.userId ?? null;
  const qc = useQueryClient();
  const inventoryFn = useServerFn(getConnectedListingsInventory);
  const listFn = useServerFn(listAirbnbAccountListings);
  const toggleFn = useServerFn(setAirbnbListingActive);
  const [q, setQ] = useState("");
  const [openOwner, setOpenOwner] = useState<string | null>(null);

  const inventory = useQuery({
    queryKey: ["connected-listings-inventory", accountOwnerId ?? "self"],
    queryFn: () => inventoryFn({ data: { accountOwnerId } }),
    enabled: open,
    retry: false,
  });
  const listings = useQuery({
    queryKey: ["airbnb-account-listings", accountOwnerId ?? "self", "all"],
    queryFn: () => listFn({ data: { accountOwnerId } }),
    enabled: open,
    retry: false,
  });

  const toggle = useMutation({
    mutationFn: (v: { propertyId: string; active: boolean }) =>
      toggleFn({ data: { propertyId: v.propertyId, active: v.active, accountOwnerId } }),
    onSuccess: (_r, v) => {
      toast.success(v.active ? "Anúncio ativado." : "Anúncio desativado. Os dados foram mantidos.");
      qc.invalidateQueries({ queryKey: ["connected-listings-inventory"] });
      qc.invalidateQueries({ queryKey: ["airbnb-account-listings"] });
    },
    onError: (e) => toast.error(friendlyErrorMessage(e, "Não foi possível alterar o anúncio.")),
  });

  const groups = useMemo(() => {
    const all = listings.data && "listings" in listings.data ? listings.data.listings : [];
    const twinIds = new Set((inventory.data?.items ?? []).filter((i) => i.kind === "twin").map((i) => i.listingId));
    const imported = all.filter((l) => l.imported && l.propertyId);
    const twinsOf = new Map<string, number>();
    for (const l of imported) if (twinIds.has(l.listingId)) twinsOf.set(l.propertyId!, (twinsOf.get(l.propertyId!) ?? 0) + 1);
    const needle = q.trim().toLowerCase();
    const by = new Map<string, { owner: string; items: typeof imported }>();
    for (const l of imported) {
      if (twinIds.has(l.listingId)) continue;
      const owner = l.ownerName ?? "Sem proprietário";
      if (needle && !`${l.title} ${owner}`.toLowerCase().includes(needle)) continue;
      const g = by.get(owner) ?? { owner, items: [] };
      g.items.push(l);
      by.set(owner, g);
    }
    return { list: [...by.values()], twinsOf };
  }, [listings.data, inventory.data, q]);

  const inv = inventory.data;
  const subtitle = inv ? `${inv.totalCount} anúncios · ${inv.primaryCount} principais · ${inv.twinCount} gêmeos` : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-0 p-0 sm:p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="flex h-12 items-center px-4 pr-12">
          <DialogTitle className="font-display text-[14px] font-bold leading-none tracking-normal">Imóveis Cobrados</DialogTitle>
        </div>
        <DialogDescription className="-mt-1.5 px-4 pr-12 text-[12px] text-muted-foreground">{subtitle || " "}</DialogDescription>
        <div className="px-4 pt-3">
          <SearchActionRow value={q} onChange={setQ} placeholder="Buscar imóvel ou proprietário" />
        </div>
        <div className="px-4 pb-2 pt-1">
          {groups.list.length === 0 ? (
            <p className="py-6 text-center text-[12px] text-[var(--faint)]">
              {listings.isLoading ? "Carregando…" : "Nenhum imóvel encontrado."}
            </p>
          ) : (
            groups.list.map((g, gi) => {
              const isOpen = openOwner === g.owner;
              return (
                <div key={g.owner}>
                  <div
                    role="button"
                    aria-expanded={isOpen}
                    tabIndex={0}
                    onClick={() => setOpenOwner(isOpen ? null : g.owner)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setOpenOwner(isOpen ? null : g.owner)}
                    className={`flex h-12 min-w-0 cursor-pointer items-center gap-2 ${gi === 0 ? "" : "border-t border-foreground/[0.11]"}`}
                  >
                    <div className="min-w-0 flex-1 text-[13px]">
                      <span className="block truncate text-[13px] font-semibold">{g.owner}</span>
                    </div>
                    <span className="shrink-0 text-[11.5px] font-semibold tabular-nums text-[var(--faint)]">
                      {g.items.length} {g.items.length === 1 ? "anúncio" : "anúncios"}
                    </span>
                    {isOpen ? (
                      <ChevronUp className="size-4 shrink-0 text-foreground" strokeWidth={2} />
                    ) : (
                      <ChevronDown className="size-4 shrink-0 text-[var(--faint)]" strokeWidth={2} />
                    )}
                  </div>
                  {isOpen && (
                    <div className="mb-3 ml-[7px] border-l border-foreground/[0.11] pl-4">
                      {g.items.map((l, i) => {
                        const on = !l.paused;
                        const gemeos = groups.twinsOf.get(l.propertyId!) ?? 0;
                        return (
                          <div
                            key={l.listingId}
                            className={`flex min-w-0 items-start gap-2.5 py-[9px] ${i === 0 ? "" : "border-t border-foreground/[0.11]"}`}
                          >
                            <div className={`min-w-0 flex-1 ${on ? "" : "opacity-50"}`}>
                              <div className="flex min-h-[18px] min-w-0 items-center gap-1.5">
                                <span className="min-w-0 truncate text-[13px] font-bold leading-[1.3]">{publicTitle(l.title)}</span>
                                {gemeos > 0 && (
                                  <Popover>
                                    <PopoverTrigger asChild>
                                      <button
                                        type="button"
                                        aria-label={`${gemeos} anúncio gêmeo — saiba mais`}
                                        className="inline-grid size-[18px] shrink-0 cursor-pointer place-items-center rounded-full bg-foreground/[0.07] text-[11px] font-bold tabular-nums text-muted-foreground data-[state=open]:bg-foreground/[0.14] data-[state=open]:text-foreground"
                                      >
                                        {gemeos}
                                      </button>
                                    </PopoverTrigger>
                                    <PopoverContent align="start" className="w-[300px] max-w-[calc(100vw-32px)] p-0">
                                      <div className="flex h-12 items-center px-4 font-display text-[14px] font-bold">Anúncio Gêmeo</div>
                                      <div className="flex flex-col gap-2.5 px-4 pb-4">
                                        <p className="text-[12.5px] font-medium leading-[1.45] text-muted-foreground">
                                          Este imóvel tem um segundo anúncio publicado para o mesmo espaço. Uma reserva em um anúncio bloqueia as datas no outro.
                                        </p>
                                        <div className="flex items-center gap-2 text-[11.5px] font-medium leading-[1.45] text-[var(--faint)]">
                                          <Receipt className="size-3.5 shrink-0" strokeWidth={2} />
                                          A cobrança é por anúncio: o gêmeo é cobrado como qualquer outro.
                                        </div>
                                      </div>
                                    </PopoverContent>
                                  </Popover>
                                )}
                              </div>
                              {l.city && (
                                <div className="mt-0.5 truncate text-[11.5px] leading-4 text-[var(--faint)]">{l.city}</div>
                              )}
                            </div>
                            <span className="flex h-[18px] items-center">
                            <MiniSwitch
                              on={on}
                              label={`${on ? "Desativar" : "Ativar"} anúncio`}
                              disabled={toggle.isPending}
                              onChange={(v) => toggle.mutate({ propertyId: l.propertyId!, active: v })}
                            />
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
