import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getAirbnbAiToggles,
  getListingSenders,
  setAirbnbAiToggle,
  setListingSender,
  type AirbnbAiToggle,
} from "@/lib/channex.functions";

const TOGGLES_KEY = ["airbnb-ai-toggles"] as const;
const SENDERS_KEY = ["listing-senders"] as const;

/**
 * Janela "IA no Airbnb": por anúncio, liga/desliga a IA no chat e escolhe quem assina as
 * respostas. Gêmeos do mesmo imóvel espelham a chave (o servidor grava por imóvel).
 */
export function AirbnbAiPanel({ readOnly }: { readOnly?: boolean }) {
  const qc = useQueryClient();
  const togglesFn = useServerFn(getAirbnbAiToggles);
  const setToggleFn = useServerFn(setAirbnbAiToggle);
  const sendersFn = useServerFn(getListingSenders);
  const setSenderFn = useServerFn(setListingSender);

  const toggles = useQuery({ queryKey: TOGGLES_KEY, queryFn: () => togglesFn(), retry: false });
  const senders = useQuery({ queryKey: SENDERS_KEY, queryFn: () => sendersFn(), retry: false, staleTime: 60_000 });
  const senderBy = new Map((senders.data ?? []).map((s) => [s.listingId, s]));

  const toggle = useMutation({
    mutationFn: (v: { propertyId: string; enabled: boolean }) => setToggleFn({ data: v }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: TOGGLES_KEY });
      const prev = qc.getQueryData<AirbnbAiToggle[]>(TOGGLES_KEY);
      qc.setQueryData<AirbnbAiToggle[]>(TOGGLES_KEY, (old) =>
        old?.map((t) => (t.propertyId === v.propertyId ? { ...t, enabled: v.enabled } : t)),
      );
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(TOGGLES_KEY, ctx.prev);
      toast.error(e instanceof Error ? e.message : "Não foi possível alterar.");
    },
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: TOGGLES_KEY });
      toast.success(v.enabled ? "IA ligada neste anúncio." : "IA desligada: a equipe responde neste anúncio.");
    },
  });

  const changeSender = useMutation({
    mutationFn: (v: { listingIds: string[]; channelId: string }) => setSenderFn({ data: v }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: SENDERS_KEY });
      toast.success(`Respostas assinadas por "${r.title}".`);
    },
    onError: (e) => {
      qc.invalidateQueries({ queryKey: SENDERS_KEY });
      toast.error(e instanceof Error ? e.message : "Não foi possível trocar a conta.");
    },
  });

  return (
    <div className="flex min-h-0 flex-col gap-3 p-4">
      <div>
        <h2 className="text-base font-semibold text-foreground">IA no Airbnb</h2>
        <p className="text-sm text-muted-foreground">
          Escolha em quais anúncios a IA responde aos hóspedes e quem assina as respostas.
        </p>
      </div>
      <div className="min-h-0 space-y-2 overflow-y-auto">
        {toggles.isLoading ? (
          <Skeleton className="h-14 w-full" />
        ) : toggles.isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar os anúncios.</p>
        ) : !toggles.data?.length ? (
          <p className="text-sm text-muted-foreground">Nenhum anúncio do Airbnb conectado.</p>
        ) : (
          toggles.data.map((t) => {
            const s = senderBy.get(t.listingId);
            return (
              <div key={t.listingId} className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card p-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{t.name}</p>
                    {t.kind === "twin" ? (
                      <p className="truncate text-xs text-muted-foreground">Gêmeo de {t.pairNames[0]}</p>
                    ) : null}
                  </div>
                  <Switch
                    aria-label={`IA responde em ${t.name}`}
                    checked={t.enabled}
                    disabled={readOnly || toggle.isPending}
                    onCheckedChange={(v) => toggle.mutate({ propertyId: t.propertyId, enabled: v })}
                  />
                </div>
                {s && s.options.length > 1 ? (
                  <label className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                    <span className="shrink-0">Assina</span>
                    <select
                      className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
                      value={s.currentChannelId ?? ""}
                      disabled={readOnly || changeSender.isPending}
                      onChange={(e) =>
                        e.target.value && changeSender.mutate({ listingIds: [t.listingId], channelId: e.target.value })
                      }
                    >
                      {s.options.map((o) => (
                        <option key={o.channelId} value={o.channelId}>
                          {o.title}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
