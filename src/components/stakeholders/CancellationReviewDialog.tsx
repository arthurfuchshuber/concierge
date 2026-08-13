import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  listPendingCancellations,
  resolveScheduledCancellation,
} from "@/lib/stakeholders.functions";

/**
 * Popup global: quando chega a data de um cancelamento agendado, toda a equipe
 * é consultada para confirmar o cancelamento definitivo ou reverter para Ativo.
 * Enquanto ninguém responder, o popup continua aparecendo em qualquer tela.
 */
export function CancellationReviewDialog() {
  const qc = useQueryClient();
  const listFn = useServerFn(listPendingCancellations);
  const resolveFn = useServerFn(resolveScheduledCancellation);
  const [busy, setBusy] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["pending-cancellations"],
    queryFn: () => listFn(),
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
    retry: false,
  });

  const item = data?.pending?.[0];

  async function resolve(outcome: "canceled" | "active") {
    if (!item) return;
    setBusy(outcome);
    try {
      await resolveFn({ data: { kind: item.kind, id: item.id, outcome } });
      toast.success(
        outcome === "canceled" ? "Cancelamento confirmado." : "Cliente revertido para ativo.",
      );
      await qc.invalidateQueries({ queryKey: ["pending-cancellations"] });
      qc.invalidateQueries({ queryKey: ["stakeholders"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível registrar a decisão.");
    } finally {
      setBusy(null);
    }
  }

  if (!item) return null;

  return (
    <Dialog open>
      <DialogContent
        className="sm:max-w-md [&>button]:hidden"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <div className="flex items-center gap-2 text-yellow-500">
            <AlertTriangle className="size-4" />
            <span className="text-[11px] uppercase tracking-wider">Cancelamento agendado</span>
          </div>
          <DialogTitle className="font-display text-xl">{item.name}</DialogTitle>
          <DialogDescription>
            O cancelamento estava previsto para{" "}
            {new Date(item.scheduled_at).toLocaleDateString("pt-BR")}. Este cliente cancelou
            definitivamente ou foi revertido para ativo?
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
          <Button
            variant="outline"
            className="rounded-full border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/10"
            disabled={!!busy}
            onClick={() => resolve("active")}
          >
            {busy === "active" && <Loader2 className="size-3.5 mr-1.5 animate-spin" />}
            Revertido para Ativo
          </Button>
          <Button
            className="rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={!!busy}
            onClick={() => resolve("canceled")}
          >
            {busy === "canceled" && <Loader2 className="size-3.5 mr-1.5 animate-spin" />}
            Cancelou definitivamente
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
