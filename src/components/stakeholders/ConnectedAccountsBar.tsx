import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link2, Plus, Download } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  listAirbnbAccounts,
  listAirbnbAccountListings,
} from "@/lib/airbnb-account.functions";
import { useImpersonation } from "@/hooks/useImpersonation";
import { PANEL_SHELL } from "@/components/dashboard/panel-chrome";
import { AirbnbAccountFlow, type AirbnbFlowRequest } from "./AirbnbAccountFlow";

/** Faixa da página Proprietários/Imóveis: botão "Contas Conectadas" → janela com Contas e Anúncios. */
export function ConnectedAccountsBar() {
  const { impersonation } = useImpersonation();
  const accountOwnerId = impersonation?.userId ?? null;
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"accounts" | "listings">("accounts");
  const [flow, setFlow] = useState<AirbnbFlowRequest>(null);
  const accountsFn = useServerFn(listAirbnbAccounts);
  const listingsFn = useServerFn(listAirbnbAccountListings);
  const accountsQ = useQuery({
    queryKey: ["airbnb-accounts", accountOwnerId ?? "self"],
    queryFn: () => accountsFn({ data: { accountOwnerId } }),
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const listingsQ = useQuery({
    queryKey: ["airbnb-account-listings", accountOwnerId ?? "self", "all-live"],
    queryFn: () => listingsFn({ data: { accountOwnerId, live: false } }),
    enabled: open && tab === "listings",
    staleTime: 0,
    retry: false,
  });
  const accounts = (accountsQ.data ?? []).filter((a) => a.status !== "disconnected");
  const totalListings = accounts.reduce((s, a) => s + (a.listings ?? 0), 0);
  const titleOf = (id: string) => accounts.find((a) => a.channelId === id)?.title ?? "";

  const tabBtn = (v: "accounts" | "listings", label: string) => (
    <button
      type="button"
      onClick={() => setTab(v)}
      className={`h-8 shrink-0 rounded-full px-3.5 text-[12px] font-bold transition-colors ${tab === v ? "bg-foreground/[0.08] text-foreground" : "text-muted-foreground hover:text-foreground"}`}
    >
      {label}
    </button>
  );

  return (
    <>
      <div className={`${PANEL_SHELL} mb-4 flex min-w-0 items-center justify-between gap-3 px-3.5 py-2.5`}>
        <span className="grid min-w-0 gap-0.5">
          <span className="ds-eyebrow text-[10px] tracking-[0.2em]">Airbnb</span>
          <span className="text-[12px] text-muted-foreground">
            {accounts.length} {accounts.length === 1 ? "conta" : "contas"} · {totalListings}{" "}
            {totalListings === 1 ? "anúncio" : "anúncios"}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] bg-foreground/[0.05] px-3.5 text-[12px] font-bold text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_14%,transparent)]"
        >
          <Link2 className="size-3.5" /> Contas Conectadas
        </button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[min(94vw,560px)] max-h-[90dvh] overflow-y-auto gap-3 p-4 sm:max-w-[560px]">
          <DialogTitle className="pr-11 font-display text-[18px] font-extrabold">
            Contas Conectadas
          </DialogTitle>
          <DialogDescription className="sr-only">Contas e anúncios do Airbnb conectados.</DialogDescription>
          <div className="ds-scroll-x flex gap-1">
            {tabBtn("accounts", "Contas Conectadas")}
            {tabBtn("listings", "Anúncios Conectados")}
          </div>

          {tab === "accounts" ? (
            <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
              {accountsQ.isLoading ? (
                <p className="py-6 text-center text-[12.5px] text-muted-foreground">Buscando contas…</p>
              ) : accounts.length === 0 ? (
                <p className="py-6 text-center text-[12.5px] text-muted-foreground">Nenhuma conta no momento.</p>
              ) : (
                accounts.map((a) => (
                  <div key={a.channelId} className={`${PANEL_SHELL} flex min-w-0 items-center gap-2.5 px-3 py-2.5`}>
                    <span aria-hidden className={`size-1.5 shrink-0 rounded-full bg-current ${a.status === "active" ? "ds-ok" : "ds-atencao"}`} />
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <b className="break-words text-[13px] font-bold">{a.title}</b>
                      <span className="text-[11.5px] text-muted-foreground">
                        {a.status === "active"
                          ? `${a.listings ?? 0} anúncios · ${a.imported} importados`
                          : "Precisa autorizar de novo"}
                      </span>
                    </span>
                    {a.status === "active" ? (
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false);
                          setFlow({ type: "resync" });
                        }}
                        className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[11.5px] font-bold shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_14%,transparent)] hover:bg-foreground/[0.05]"
                      >
                        <Download className="size-3" /> Importar
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false);
                          setFlow({ type: "reconnect", channelId: a.channelId } as AirbnbFlowRequest);
                        }}
                        className="inline-flex h-7 shrink-0 items-center rounded-full px-2.5 text-[11.5px] font-bold ds-atencao shadow-[inset_0_0_0_1px_currentColor]"
                      >
                        Reconectar
                      </button>
                    )}
                  </div>
                ))
              )}
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setFlow({ type: "connect" });
                }}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[10px] bg-foreground/[0.05] text-[12.5px] font-bold"
              >
                <Plus className="size-3.5" /> Conectar nova conta
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
              {listingsQ.isLoading ? (
                <p className="py-6 text-center text-[12.5px] text-muted-foreground">Buscando anúncios…</p>
              ) : (listingsQ.data?.listings ?? []).length === 0 ? (
                <p className="py-6 text-center text-[12.5px] text-muted-foreground">Nenhum anúncio encontrado.</p>
              ) : (
                (listingsQ.data?.listings ?? []).map((l) => (
                  <div key={l.listingId} className={`${PANEL_SHELL} flex min-w-0 items-center gap-2.5 px-3 py-2.5`}>
                    <span aria-hidden className={`size-1.5 shrink-0 rounded-full bg-current ${l.imported ? "ds-ok" : "ds-atencao"}`} />
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <b className="break-words text-[12.5px] font-bold">{l.title}</b>
                      <span className="text-[11px] text-muted-foreground">
                        {titleOf(l.channelId)} · {l.imported ? (l.ownerName ? `Importado · ${l.ownerName}` : "Importado") : "Não importado"}
                      </span>
                    </span>
                  </div>
                ))
              )}
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setFlow({ type: "resync" });
                }}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[10px] bg-foreground/[0.05] text-[12.5px] font-bold"
              >
                <Download className="size-3.5" /> Importar anúncios
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AirbnbAccountFlow request={flow} onClose={() => setFlow(null)} />
    </>
  );
}
