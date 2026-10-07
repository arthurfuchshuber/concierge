import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  getAirbnbAiToggles,
  getChannexStatus,
  importarAnunciosAirbnb,
  setAirbnbAiToggle,
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
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ["airbnb-ai-toggles"] });
      toast.success(v.enabled ? "IA ligada no chat do Airbnb." : "IA desligada no chat do Airbnb.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível alterar."),
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
          {toggles.data!.map((t) => (
            <label key={t.propertyId} className="flex min-w-0 items-center justify-between gap-3 text-xs">
              <span className="min-w-0 break-words text-muted-foreground">{t.name}</span>
              <Switch
                checked={t.enabled}
                disabled={toggle.isPending}
                onCheckedChange={(enabled) => toggle.mutate({ propertyId: t.propertyId, enabled })}
                aria-label={`IA no Airbnb — ${t.name}`}
              />
            </label>
          ))}
          <p className="text-[11px] text-muted-foreground">
            Desligada: as mensagens só ficam registradas no Atendimento e a equipe é avisada.
          </p>
        </div>
      )}

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
