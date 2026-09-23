import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { getDowngradeImpact, deleteGuides, PLANS, type PlanKey } from "@/lib/payments.functions";
import { featuresLostOnDowngrade } from "@/lib/payments.shared";
import { useSubscription } from "@/hooks/useSubscription";
import { toast } from "sonner";

export function DowngradeExcessDialog({
  open,
  targetPlan,
  onClose,
  onResolved,
}: {
  open: boolean;
  targetPlan: PlanKey;
  onClose: () => void;
  /** Called after user removed enough guides — caller should retry the plan change. */
  onResolved: () => void;
}) {
  const fetchImpact = useServerFn(getDowngradeImpact);
  const doDelete = useServerFn(deleteGuides);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState(false);
  const targetCfg = PLANS[targetPlan];
  const { info: currentInfo } = useSubscription();
  const featuresLost = useMemo(
    () => featuresLostOnDowngrade(currentInfo.plan, targetPlan),
    [currentInfo.plan, targetPlan],
  );

  const impactQuery = useQuery({
    queryKey: ["downgrade-impact", targetCfg.priceId, open],
    queryFn: () => fetchImpact({ data: { targetPriceExternalId: targetCfg.priceId } }),
    enabled: open,
  });

  const impact = impactQuery.data;
  const mustRemove = impact?.mustRemove ?? 0;
  const remaining = impact ? impact.currentCount - selected.size : 0;
  const ready = impact ? remaining <= impact.targetMax : false;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleConfirm() {
    if (!selected.size) return;
    setRemoving(true);
    try {
      await doDelete({ data: { ids: Array.from(selected) } });
      toast.success(`${selected.size} guia(s) excluído(s).`);
      setSelected(new Set());
      onResolved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao excluir guias");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !removing && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-yellow-600" />
            Excesso de guias para o plano {targetCfg.name}
          </DialogTitle>
          <DialogDescription>
            O plano {targetCfg.name} permite até {targetCfg.maxGuides} guias. Selecione
            {mustRemove > 0 ? ` pelo menos ${mustRemove} guia(s) para excluir` : " guias para excluir"} antes
            de fazer o downgrade.
          </DialogDescription>
        </DialogHeader>

        {featuresLost.length > 0 && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 space-y-2">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
              Ao migrar para o plano {targetCfg.name}, seus guias deixarão de oferecer aos hóspedes:
            </p>
            <ul className="space-y-1.5">
              {featuresLost.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-foreground/80">
                  <XCircle className="size-4 text-amber-600 shrink-0 mt-0.5" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        )}


        {impactQuery.isLoading ? (
          <div className="h-40 grid place-items-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : !impact ? (
          <p className="text-sm text-destructive">Não foi possível carregar seus guias.</p>
        ) : (
          <>
            <div className="rounded-xl border border-border divide-y divide-border max-h-72 overflow-y-auto">
              {impact.guides.map((g) => {
                const isSel = selected.has(g.id);
                return (
                  <label
                    key={g.id}
                    className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-secondary/50 ${
                      isSel ? "bg-destructive/5" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => toggle(g.id)}
                      className="size-4 accent-destructive"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{g.name}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        /{g.slug} · {g.published ? "Publicado" : "Não publicado"}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
            <div className="text-xs flex items-center justify-between">
              <span className="text-muted-foreground">
                Restará{" "}
                <strong className={remaining > impact.targetMax ? "text-destructive" : "text-foreground"}>
                  {remaining}
                </strong>{" "}
                de {impact.targetMax} permitidos.
              </span>
              <span className="text-muted-foreground">
                {selected.size} selecionado{selected.size === 1 ? "" : "s"}
              </span>
            </div>
          </>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={removing}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={removing || !ready || selected.size === 0}
          >
            {removing ? (
              <Loader2 className="size-4 mr-1.5 animate-spin" />
            ) : (
              <Trash2 className="size-4 mr-1.5" />
            )}
            Excluir e continuar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
