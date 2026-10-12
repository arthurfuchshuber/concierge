import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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
  const toggles = useQuery({ queryKey: ["airbnb-ai-toggles"], queryFn: () => togglesFn(), retry: false });
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
  const senders = useQuery({ queryKey: ["listing-senders"], queryFn: () => sendersFn(), retry: false, staleTime: 60_000 });
  const senderBy = new Map((senders.data ?? []).map((s) => [s.listingId, s]));
  const changeSender = useMutation({
    mutationFn: (v: { listingId: string; channelId: string }) => setSenderFn({ data: v }),
    onMutate: () => toast.info("Trocando a conta que assina as respostas (leva cerca de 1 minuto)…"),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["listing-senders"] });
      toast.success(`Respostas agora assinadas por "${r.title}" (incluindo anúncios gêmeos).`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível trocar a conta."),
  });
  const [last, setLast] = useState<ChannexSyncResult | null>(null);

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

      {(toggles.data?.length ?? 0) > 0 && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <p className="text-xs font-medium text-foreground">IA respondendo no chat do Airbnb</p>
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
                onCheckedChange={(enabled) => toggle.mutate({ propertyId: t.propertyId, enabled })}
                aria-label={`IA no Airbnb — ${t.name}`}
              />
            </label>
            {snd && snd.options.length > 0 && (
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span>Respostas assinadas por</span>
                <select
                  className="min-w-0 max-w-full rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground"
                  value={snd.currentChannelId ?? ""}
                  disabled={changeSender.isPending}
                  onChange={(e) => {
                    const channelId = e.target.value;
                    if (!channelId || channelId === snd.currentChannelId) return;
                    if (!window.confirm("Trocar a conta que assina as respostas deste anúncio (e dos gêmeos)? Preços não são alterados.")) return;
                    changeSender.mutate({ listingId: t.listingId, channelId });
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
            {last.total} anúncio(s) encontrados · {last.importados} sincronizado(s) · {last.jaExistentes} já
            estavam em dia.
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
