import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { advanceArrival } from "@/lib/dashboard.functions";
import { track } from "@/lib/trail";
import {
  carregarEtapas,
  configurarEtapas,
  ouvirEtapas,
  processarEtapas,
} from "@/lib/offline/stage-outbox";

/**
 * Mantém viva a fila de conclusões de limpeza guardada no aparelho: entrega
 * ao abrir o painel, ao voltar a internet, ao voltar para a aba e a cada 15 s.
 */
export function StageOutboxRunner() {
  const qc = useQueryClient();

  useEffect(() => {
    configurarEtapas((job) =>
      advanceArrival({
        data: {
          ...(job.logId ? { logId: job.logId } : {}),
          ...(job.reservationId ? { reservationId: job.reservationId } : {}),
          from: job.from,
          ...(job.cleaningType ? { cleaningType: job.cleaningType } : {}),
        },
      }),
    );
    const pos = { position: "top-center" as const };
    const refrescar = () => {
      for (const k of ["dash-list", "dash-kpis", "cleaning-stats", "occupancy-board"]) {
        void qc.invalidateQueries({ queryKey: [k] });
      }
    };

    const sair = ouvirEtapas((e) => {
      if (e.tipo === "mudou") {
        // Reaplica o filtro de pendentes nas listas já carregadas.
        void qc.invalidateQueries({ queryKey: ["dash-list"] });
        return;
      }
      const id = `etapa-${e.job.rowId}`;
      if (e.tipo === "concluida") {
        refrescar();
        if (e.job.tentativas > 0) {
          toast.success("Limpeza sincronizada com a central", { id, description: e.job.rotulo, duration: 4000, ...pos });
        } else {
          toast.dismiss(id);
        }
      } else if (e.tipo === "pendente") {
        track({
          type: "stage_sync_pending",
          label: "Conclusão de limpeza aguardando conexão",
          category: "ERROR",
          severity: "warning",
          metadata: { rowId: e.job.rowId, tentativas: e.job.tentativas, erro: e.erro },
        });
        toast.message("Gravado no aparelho · sincronizando…", {
          id,
          description: `${e.job.rotulo} — será enviado sozinho assim que a internet estabilizar.`,
          duration: 6000,
          ...pos,
        });
      } else if (e.tipo === "recusada") {
        refrescar();
        track({
          type: "stage_sync_rejected",
          label: "Conclusão de limpeza recusada pelo servidor",
          category: "ERROR",
          severity: "error",
          metadata: { rowId: e.job.rowId, erro: e.erro },
        });
        toast.error("Não foi possível concluir a limpeza", {
          id,
          description: `${e.job.rotulo}: ${e.erro}`,
          duration: 8000,
          ...pos,
        });
      }
    });

    void carregarEtapas().then(() => processarEtapas());
    const tick = window.setInterval(() => void processarEtapas(), 15_000);
    const aoVoltar = () => {
      if (document.visibilityState === "visible") void processarEtapas();
    };
    const aoConectar = () => void processarEtapas();
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("online", aoConectar);
    return () => {
      sair();
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("online", aoConectar);
    };
  }, [qc]);

  return null;
}
