import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getChannexStatus, importarAnunciosAirbnb, type ChannexSyncResult } from "@/lib/channex.functions";

/** Painel da integração Channex: importa os anúncios do Airbnb. */
export function ChannexPanel() {
  const qc = useQueryClient();
  const statusFn = useServerFn(getChannexStatus);
  const importFn = useServerFn(importarAnunciosAirbnb);
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
