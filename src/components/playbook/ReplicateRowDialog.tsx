import { FilterMultiSelect } from "@/components/dashboard/filter-panel";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { bulkUpdatePlaybookEntries, listBulkTargets } from "@/lib/playbook.functions";

/**
 * REPLICAR UMA LINHA DO DOSSIÊ EM OUTROS IMÓVEIS DA CONTA (24/10/2026).
 * Só aparece em linhas da lista branca (`classifyBulkRow`); o backend recusa
 * de novo qualquer campo proibido (senhas, códigos, endereço, estrutura física).
 */
export function ReplicateRowDialog({
  propertyId,
  row,
  onClose,
}: {
  propertyId: string;
  row: { id: string; label: string; value: string } | null;
  onClose: () => void;
}) {
  const listFn = useServerFn(listBulkTargets);
  const bulkFn = useServerFn(bulkUpdatePlaybookEntries);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const targets = useQuery({
    queryKey: ["playbook-bulk-targets", propertyId],
    queryFn: () => listFn({ data: { propertyId } }),
    enabled: !!row,
    staleTime: 60_000,
  });
  const list = targets.data ?? [];

  const close = () => {
    setPicked([]);
    onClose();
  };

  async function apply() {
    if (!row || picked.length === 0) return;
    setBusy(true);
    try {
      const r = await bulkFn({
        data: { sourcePropertyId: propertyId, targetPropertyIds: picked, action: "content", source: { kind: "row", rowId: row.id } },
      });
      if (r.failed.length) toast.error(`Aplicado em ${r.applied}; ${r.failed.length} não puderam ser alterados.`);
      else toast.success(r.applied === 1 ? "Replicado em 1 imóvel." : `Replicado em ${r.applied} imóveis.`);
      close();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível replicar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!row} onOpenChange={(v) => !v && close()}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Replicar “{row?.label}”</DialogTitle>
          <DialogDescription>O conteúdo deste campo substitui o mesmo campo nos imóveis escolhidos.</DialogDescription>
        </DialogHeader>

        <div className="max-h-28 overflow-y-auto whitespace-pre-line rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          {row?.value}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {targets.isLoading ? (
            <p className="py-4 text-sm text-muted-foreground">Carregando imóveis…</p>
          ) : list.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">Nenhum outro imóvel nesta conta.</p>
          ) : (
            <div className="overflow-hidden rounded-md border border-[var(--panel-border)]">
              <FilterMultiSelect
                options={list.map((p) => ({ value: p.id, label: p.name }))}
                selected={picked}
                onChange={setPicked}
                searchPlaceholder="Buscar imóvel..."
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={() => void apply()} disabled={busy || picked.length === 0}>
            {busy ? "Replicando…" : picked.length ? `Replicar em ${picked.length}` : "Replicar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
