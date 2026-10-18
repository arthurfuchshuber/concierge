import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarX2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FILTER_PANEL_CLASS, FILTER_PANEL_COLLISION, FILTER_PANEL_OFFSET } from "@/components/dashboard/filter-panel";
import { ACTION_ICON, ACTION_SEGMENT } from "@/components/dashboard/panel-chrome";
import { createManualBlockFn, listManualBlocks, removeManualBlockFn } from "@/lib/manual-blocks.functions";
import { useImpersonation } from "@/hooks/useImpersonation";

const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** "Bloquear datas": fecha o imóvel (e anúncios gêmeos) no Airbnb/PriceLabs via API. */
export function ManualBlockButton() {
  const { impersonation } = useImpersonation();
  const ownerId = impersonation?.userId ?? null;
  const listFn = useServerFn(listManualBlocks);
  const createFn = useServerFn(createManualBlockFn);
  const removeFn = useServerFn(removeManualBlockFn);
  const qc = useQueryClient();
  const key = ["manual-blocks", ownerId];
  const { data } = useQuery({ queryKey: key, queryFn: () => listFn({ data: { ownerId } }) });
  const [open, setOpen] = useState(false);
  const [propertyId, setPropertyId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  if (!data?.canEdit) return null;
  const names = new Map(data.properties.map((p) => [p.id, p.name]));

  async function save() {
    if (!propertyId || !from || !to) return toast.error("Escolha o imóvel e as datas.");
    setBusy(true);
    try {
      const r = await createFn({ data: { ownerId, propertyId, from, to, note: note || null } });
      if (r.connected && !r.ok) toast.warning("Bloqueio salvo, mas não consegui fechar as datas nos anúncios. Tente de novo em alguns minutos.");
      else toast.success(r.connected ? "Datas bloqueadas em todos os anúncios." : "Bloqueio salvo.");
      setFrom(""); setTo(""); setNote("");
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível bloquear.");
    } finally { setBusy(false); }
  }

  async function remove(id: string, pid: string) {
    setBusy(true);
    try {
      const r = await removeFn({ data: { ownerId, propertyId: pid, id } });
      if (r.connected && !r.ok) toast.warning("Datas liberadas aqui, mas não consegui reabri-las nos anúncios. Tente de novo em alguns minutos.");
      else toast.success("Datas liberadas.");
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível liberar.");
    } finally { setBusy(false); }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={ACTION_SEGMENT} aria-label="Bloquear datas" title="Bloquear datas">
          <CalendarX2 className={ACTION_ICON} />
        </button>
      </PopoverTrigger>
      <PopoverContent className={FILTER_PANEL_CLASS} collisionPadding={FILTER_PANEL_COLLISION} sideOffset={FILTER_PANEL_OFFSET}>
        <div className="space-y-3 p-3">
          <p className="text-sm font-semibold">Bloquear datas</p>
          <select className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm" value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
            <option value="">Imóvel…</option>
            {data.properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <label className="min-w-0 text-xs text-muted-foreground">De<Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="min-w-0 text-xs text-muted-foreground">Até (saída)<Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          </div>
          <Input placeholder="Motivo (opcional)" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
          <Button className="w-full" disabled={busy} onClick={save}>Bloquear</Button>
          {data.blocks.length > 0 && (
            <div className="space-y-1 border-t border-border pt-2">
              {data.blocks.map((b) => (
                <div key={b.id} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1">{names.get(b.propertyId)} · {ddmm(b.from)} a {ddmm(b.to)}</span>
                  <button type="button" disabled={busy} onClick={() => remove(b.id, b.propertyId)} aria-label="Liberar datas" className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
