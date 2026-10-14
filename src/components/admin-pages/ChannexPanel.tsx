import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link2, Loader2, MoreHorizontal, RefreshCw, Unlink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AirbnbAccountFlow,
  type AirbnbFlowRequest,
} from "@/components/stakeholders/AirbnbAccountFlow";
import { listAirbnbAccounts } from "@/lib/airbnb-account.functions";
import { useImpersonation } from "@/hooks/useImpersonation";
import { ChannexTwinsPanel } from "./ChannexTwinsPanel";
import { ChannexModeCard } from "./ChannexModeCard";
import { ConnectedListingsCard } from "./ConnectedListingsCard";
import {
  getAirbnbAiToggles,
  getChannexStatus,
  importarAnunciosAirbnb,
  setAirbnbAiToggle,
  getListingSenders,
  setListingSender,
  type ChannexSyncResult,
} from "@/lib/channex.functions";

/** Painel da integração Channex: importa os anúncios do Airbnb. */
export function ChannexPanel() {
  const qc = useQueryClient();
  const statusFn = useServerFn(getChannexStatus);
  const importFn = useServerFn(importarAnunciosAirbnb);
  const togglesFn = useServerFn(getAirbnbAiToggles);
  const setToggleFn = useServerFn(setAirbnbAiToggle);
  const toggles = useQuery({
    queryKey: ["airbnb-ai-toggles"],
    queryFn: () => togglesFn(),
    retry: false,
  });
  const toggle = useMutation({
    mutationFn: (v: { propertyId: string; enabled: boolean }) => setToggleFn({ data: v }),
    // Espelho imediato: o anúncio e todos os gêmeos (mesmo imóvel) mudam juntos na tela.
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["airbnb-ai-toggles"] });
      const prev = qc.getQueryData(["airbnb-ai-toggles"]);
      qc.setQueryData(["airbnb-ai-toggles"], (old: typeof toggles.data) =>
        old?.map((t) => (t.propertyId === v.propertyId ? { ...t, enabled: v.enabled } : t)),
      );
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["airbnb-ai-toggles"], ctx.prev);
      toast.error(e instanceof Error ? e.message : "Não foi possível alterar.");
    },
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ["airbnb-ai-toggles"] });
      qc.invalidateQueries({ queryKey: ["connected-listings-inventory"] });
      toast.success(
        v.enabled
          ? "IA ligada no chat do Airbnb (incluindo anúncios gêmeos)."
          : "IA desligada no chat do Airbnb (incluindo anúncios gêmeos).",
      );
    },
  });
  const sendersFn = useServerFn(getListingSenders);
  const setSenderFn = useServerFn(setListingSender);
  const senders = useQuery({
    queryKey: ["listing-senders"],
    queryFn: () => sendersFn(),
    retry: false,
    staleTime: 60_000,
  });
  const senderBy = new Map((senders.data ?? []).map((s) => [s.listingId, s]));
  const changeSender = useMutation({
    mutationFn: (v: { listingIds: string[]; channelId: string }) => setSenderFn({ data: v }),
        onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["listing-senders"] });
      setPicked(new Set());
      toast.success(`Respostas agora assinadas por "${r.title}" (incluindo anúncios gêmeos).`);
    },
    onError: (e) => {
      qc.invalidateQueries({ queryKey: ["listing-senders"] });
      toast.error(e instanceof Error ? e.message : "Não foi possível trocar a conta.");
    },
  });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkTarget, setBulkTarget] = useState("");
  const allOptions = senders.data?.[0]?.options ?? [];
  const pickable = (toggles.data ?? []).filter((t) => senderBy.has(t.listingId));
  const togglePick = (id: string, on: boolean) => {
    const t = (toggles.data ?? []).find((x) => x.listingId === id);
    // Gêmeos do mesmo imóvel entram juntos.
    const same = (toggles.data ?? [])
      .filter((x) => x.propertyId === t?.propertyId)
      .map((x) => x.listingId);
    setPicked((p) => {
      const n = new Set(p);
      for (const s of same) on ? n.add(s) : n.delete(s);
      return n;
    });
  };
  const runBulk = () => {
    if (!bulkTarget || !picked.size) return;
    const title = allOptions.find((o) => o.channelId === bulkTarget)?.title ?? "conta escolhida";
    if (
      !window.confirm(
        `Assinar as respostas de ${picked.size} anúncio(s) por "${title}"? Gêmeos mudam juntos. Preços não são alterados.`,
      )
    )
      return;
    changeSender.mutate({ listingIds: [...picked], channelId: bulkTarget });
  };
  const [last, setLast] = useState<ChannexSyncResult | null>(null);
  // Contas do Airbnb conectadas (várias por conta do sistema).
  const [flow, setFlow] = useState<AirbnbFlowRequest>(null);
  const { impersonation } = useImpersonation();
  const accountOwnerId = impersonation?.userId ?? null;
  const accountsFn = useServerFn(listAirbnbAccounts);
  const accounts = useQuery({
    queryKey: ["airbnb-accounts", accountOwnerId ?? "self"],
    queryFn: () => accountsFn({ data: { accountOwnerId } }),
    retry: false,
    staleTime: 30_000,
  });

  const status = useQuery({
    queryKey: ["channex-status"],
    queryFn: () => statusFn(),
    retry: false,
  });

  const sync = useMutation({
    mutationFn: () => importFn(),
    onSuccess: (res) => {
      setLast(res);
      qc.invalidateQueries({ queryKey: ["channex-status"] });
      qc.invalidateQueries({ queryKey: ["connected-listings-inventory"] });
      qc.invalidateQueries({ queryKey: ["airbnb-ai-toggles"] });
      qc.invalidateQueries({ queryKey: ["channex-twins"] });
      toast.success(`${res.importados} imóvel(is) sincronizado(s) de ${res.total} anúncio(s).`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível sincronizar."),
  });

  return (
    <div className="space-y-3">
      <p className="ds-card-desc">
        {status.data?.configured === false
          ? "A chave da integração ainda não está configurada no servidor."
          : `Imóveis já importados: ${status.data?.imported ?? 0}.`}
      </p>

      <Button
        size="sm"
        className="h-8 rounded-full text-xs"
        disabled={sync.isPending || status.data?.configured === false}
        onClick={() => sync.mutate()}
      >
        {sync.isPending ? (
          <Loader2 className="mr-1 size-3.5 animate-spin" />
        ) : (
          <RefreshCw className="mr-1 size-3.5" />
        )}
        Sincronizar Imóveis do Airbnb
      </Button>

      <div className="space-y-2 rounded-lg border border-border p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-foreground">
            Contas do Airbnb{accounts.data ? ` · ${accounts.data.length}` : ""}
          </p>
          <Button
            size="sm"
            className="h-8 rounded-full text-xs"
            onClick={() => setFlow({ type: "connect" })}
          >
            <Link2 className="mr-1 size-3.5" />
            Conectar conta
          </Button>
        </div>
        {accounts.isLoading ? (
          <p className="ds-card-desc">Buscando contas…</p>
        ) : (accounts.data?.length ?? 0) === 0 ? (
          <p className="ds-card-desc">Nenhuma conta do Airbnb conectada ainda.</p>
        ) : (
          (accounts.data ?? []).map((a) => (
            <div
              key={a.channelId}
              className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-bold">{a.title}</p>
                <p className="ds-meta">
                  {a.listings === null ? "Sem acesso aos anúncios" : `${a.listings} anúncios`} ·{" "}
                  {a.imported} importados
                </p>
              </div>
              <span
                className={`rounded-full px-2 py-0 text-[10px] font-semibold ${
                  a.status === "active"
                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                    : "border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                }`}
              >
                {a.status === "active"
                  ? "Ativa"
                  : a.status === "expired"
                    ? "Reconectar"
                    : "Desconectada"}
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Mais opções">
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  {a.status === "active" ? (
                    <DropdownMenuItem onClick={() => setFlow({ type: "resync" })}>
                      <RefreshCw className="size-3.5" /> ReSincronizar
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      onClick={() => setFlow({ type: "reconnect", channelId: a.channelId })}
                    >
                      <Link2 className="size-3.5" /> Reconectar
                    </DropdownMenuItem>
                  )}
                  {a.status !== "disconnected" ? (
                    <DropdownMenuItem
                      onClick={() => setFlow({ type: "disconnect", channelId: a.channelId })}
                    >
                      <Unlink className="size-3.5" /> Desconectar
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))
        )}
      </div>
      <AirbnbAccountFlow request={flow} onClose={() => setFlow(null)} />

      {(toggles.data?.length ?? 0) > 0 && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <p className="text-xs font-medium text-foreground">IA respondendo no chat do Airbnb</p>
          {pickable.length > 0 && allOptions.length > 0 && (
            <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-md bg-muted/50 p-2 text-[11px] text-muted-foreground">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  className="size-3.5 accent-primary"
                  checked={picked.size > 0 && picked.size >= pickable.length}
                  disabled={changeSender.isPending}
                  onChange={(e) =>
                    setPicked(
                      e.target.checked ? new Set(pickable.map((t) => t.listingId)) : new Set(),
                    )
                  }
                />
                Todos ({picked.size}/{pickable.length})
              </label>
              <select
                className="min-w-0 max-w-full rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground"
                value={bulkTarget}
                disabled={changeSender.isPending}
                onChange={(e) => setBulkTarget(e.target.value)}
                aria-label="Conta para os anúncios selecionados"
              >
                <option value="">Assinar selecionados por…</option>
                {allOptions.map((o) => (
                  <option key={o.channelId} value={o.channelId}>
                    {o.title}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                className="h-7 rounded-full text-[11px]"
                disabled={changeSender.isPending || !bulkTarget || !picked.size}
                onClick={runBulk}
              >
                {changeSender.isPending && <Loader2 className="mr-1 size-3 animate-spin" />}
                {changeSender.isPending ? "Trocando…" : "Aplicar"}
              </Button>
            </div>
          )}
          {toggles.data!.map((t) => {
            const snd = senderBy.get(t.listingId);
            return (
            <div key={t.listingId} className="space-y-1">
            <label className="flex min-w-0 items-center justify-between gap-3 text-xs">
              <span className="min-w-0 break-words text-muted-foreground">
                {t.name}
                {t.pairNames.length > 0 && (
                  <span className="block text-[11px] text-muted-foreground/80">
                    {t.kind === "twin" ? "Gêmeo de " : "Gêmeo: "}
                    {t.pairNames.join(", ")} · mesma chave
                  </span>
                )}
              </span>
              <Switch
                checked={t.enabled}
                disabled={toggle.isPending}
                    onCheckedChange={(enabled) =>
                      toggle.mutate({ propertyId: t.propertyId, enabled })
                    }
                aria-label={`IA no Airbnb — ${t.name}`}
              />
            </label>
            {snd && snd.options.length > 0 && (
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  className="size-3.5 accent-primary"
                  checked={picked.has(t.listingId)}
                  disabled={changeSender.isPending}
                  onChange={(e) => togglePick(t.listingId, e.target.checked)}
                  aria-label={`Selecionar ${t.name} para troca em massa`}
                />
                <span>Respostas assinadas por</span>
                <select
                  className="min-w-0 max-w-full rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground"
                  value={snd.currentChannelId ?? ""}
                  disabled={changeSender.isPending}
                  onChange={(e) => {
                    const channelId = e.target.value;
                    if (!channelId || channelId === snd.currentChannelId) return;
                        if (
                          !window.confirm(
                            "Trocar a conta que assina as respostas deste anúncio (e dos gêmeos)? Vale na hora; preços e calendário não são alterados.",
                          )
                        )
                          return;
                    changeSender.mutate({ listingIds: [t.listingId], channelId });
                  }}
                  aria-label={`Conta remetente — ${t.name}`}
                >
                  {!snd.currentChannelId && <option value="">Não conectado</option>}
                  {snd.options.map((o) => (
                    <option key={o.channelId} value={o.channelId}>
                      {o.title}
                    </option>
                  ))}
                </select>
              </div>
            )}
            </div>
            );
          })}
          <p className="text-[11px] text-muted-foreground">
            Desligada: as mensagens só ficam registradas no Atendimento e a equipe é avisada.
          </p>
        </div>
      )}

      {status.data?.configured !== false && <ConnectedListingsCard />}
      {status.data?.configured !== false && <ChannexModeCard />}
      {status.data?.configured !== false && <ChannexTwinsPanel />}

      {last && (
        <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
          <p>
            {last.total} anúncio(s) encontrados · {last.importados} sincronizado(s) ·{" "}
            {last.jaExistentes} já estavam em dia.
          </p>
          {last.falhas.length > 0 && (
            <ul className="mt-2 space-y-1">
              {last.falhas.map((f) => (
                <li key={f.titulo} className="break-words text-destructive">
                  {f.titulo}: {f.erro}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
