import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { linkTwin, listTwinCandidates } from "@/lib/channex-twins.functions";

/** Une dois anúncios do Airbnb da mesma unidade: reservar um fecha o outro. */
export function ChannexTwinsPanel() {
  const qc = useQueryClient();
  const listFn = useServerFn(listTwinCandidates);
  const linkFn = useServerFn(linkTwin);
  const q = useQuery({ queryKey: ["channex-twins"], queryFn: () => listFn(), retry: false });
  const [primary, setPrimary] = useState("");
  const [twin, setTwin] = useState("");
  const rows = useMemo(() => q.data?.listings ?? [], [q.data]);
  const titleOf = useMemo(() => new Map(rows.map((r) => [r.listingId, r.title])), [rows]);
  const groups = q.data?.links ?? [];

  const p = rows.find((r) => r.listingId === primary);
  const t = rows.find((r) => r.listingId === twin);
  const link = useMutation({
    mutationFn: () => linkFn({ data: { channelId: p!.channelId, primaryListingId: primary, twinListingId: twin } }),
    onSuccess: (r) => {
      toast.success(r.alreadyLinked ? "Esses anúncios já estavam unidos." : "Anúncios unidos: reservar um fecha o outro.");
      setTwin("");
      qc.invalidateQueries({ queryKey: ["channex-twins"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível unir."),
  });

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <p className="text-xs font-medium text-foreground">Anúncios do mesmo imóvel</p>
      <p className="text-[11px] text-muted-foreground">
        Una dois anúncios da mesma unidade: quando um recebe reserva, o outro fecha as mesmas datas automaticamente.
      </p>

      {q.isLoading ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : (
        <>
          <div className="grid min-w-0 gap-2 sm:grid-cols-2">
            <Select value={primary} onValueChange={setPrimary}>
              <SelectTrigger className="min-w-0 text-xs"><SelectValue placeholder="Anúncio principal" /></SelectTrigger>
              <SelectContent>
                {rows.map((r) => <SelectItem key={r.listingId} value={r.listingId} className="text-xs">{r.title}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={twin} onValueChange={setTwin}>
              <SelectTrigger className="min-w-0 text-xs"><SelectValue placeholder="Anúncio gêmeo" /></SelectTrigger>
              <SelectContent>
                {rows.filter((r) => r.listingId !== primary && (!p || r.channelId === p.channelId)).map((r) => (
                  <SelectItem key={r.listingId} value={r.listingId} className="text-xs">{r.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {p && t && (
            <p className="text-[11px] text-muted-foreground">
              Cada anúncio continua separado (aparece sozinho no PriceLabs), mas os calendários passam a fechar juntos na hora. O anúncio gêmeo fica cerca de 1 minuto desconectado e volta publicado; depois, rode a importação no PriceLabs.
            </p>
          )}
          <Button size="sm" className="h-8 rounded-full text-xs" disabled={!p || !t || link.isPending} onClick={() => link.mutate()}>
            {link.isPending ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <Link2 className="mr-1 size-3.5" />}
            {link.isPending ? "Unindo (até 1 min)…" : "Unir anúncios"}
          </Button>

          {groups.length > 0 && (
            <ul className="space-y-2 border-t border-border pt-2">
              {groups.map((g) => (
                <li key={g.twin_listing_id} className="text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground">Unidos:</span>{" "}
                  <span className="break-words">
                    {(g.primary_title || titleOf.get(g.primary_listing_id) || g.primary_listing_id) + " + " + (g.twin_title || titleOf.get(g.twin_listing_id) || g.twin_listing_id)}
                  </span>
                  {g.last_error ? <span className="block text-destructive">{g.last_error}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
