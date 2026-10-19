import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { notifyAction } from "@/components/UndoActionBar";
import { track } from "@/lib/trail";
import {
  appendSituationMedia,
  createRecordSituation,
  undoRecordSituation,
} from "@/lib/reservation-records.functions";
import {
  configurarFila,
  envioEmAndamento,
  ouvirFila,
  processarFila,
  trabalhosPendentes,
} from "@/lib/offline/situation-outbox";

/**
 * Liga a fila de envio de situações (fotos, vídeos, áudios, arquivos) e a
 * mantém viva: retoma ao abrir o painel, ao voltar para a aba, ao voltar a
 * internet e a cada 30 s. Mostra o andamento no canto da tela.
 */
export function SituationOutboxRunner() {
  const qc = useQueryClient();

  useEffect(() => {
    configurarFila({
      criar: (data) => createRecordSituation({ data: data as never }) as never,
      anexar: (data) => appendSituationMedia({ data: data as never }),
    });

    const pos = { position: "bottom-right" as const };
    const refrescar = () => {
      for (const k of ["account-records", "reservation-records", "dash-tasks"]) {
        void qc.invalidateQueries({ queryKey: [k] });
      }
    };
    const ultimoTxt = new Map<string, string>();

    const sair = ouvirFila((e) => {
      const id = `fila-${e.job.groupId}`;
      const rotulo = e.job.title || "Situação";
      if (e.tipo === "criada") {
        refrescar();
        if (e.job.midias.length === 0) {
          const { groupId, taskId } = e.job;
          notifyAction(e.job.taskCreated ? "Situação registrada e pendência aberta." : "Situação registrada.", () => {
            void undoRecordSituation({ data: { groupId, taskId: taskId ?? null } })
              .then(refrescar)
              .catch((err) => toast.error(err instanceof Error ? err.message : "Não foi possível desfazer."));
          });
        }
      } else if (e.tipo === "progresso") {
        const media = Math.round(((e.feitos + e.pct / 100) / Math.max(1, e.total)) * 100);
        const txt = `Enviando ${Math.min(e.feitos + 1, e.total)} de ${e.total} · ${media}%`;
        if (ultimoTxt.get(id) === txt) return;
        ultimoTxt.set(id, txt);
        toast.loading(txt, { id, description: `${rotulo} — mantenha o app aberto`, ...pos });
      } else if (e.tipo === "concluida") {
        ultimoTxt.delete(id);
        refrescar();
        if (e.job.midias.length > 0) {
          toast.success(`${e.job.midias.length} arquivo(s) enviados`, { id, description: rotulo, duration: 5000, ...pos });
        }
      } else if (e.tipo === "pendente") {
        ultimoTxt.delete(id);
        track({
          type: "record_media_failed",
          label: "Envio de situação pendente (fila do aparelho)",
          category: "ERROR",
          severity: "warning",
          metadata: { groupId: e.job.groupId, propertyId: e.job.propertyId, tentativas: e.job.tentativas, erro: e.erro },
        });
        // Oscilações passageiras se resolvem sozinhas: só avisa após 3 rodadas.
        if ((e.job.tentativas ?? 0) < 3) {
          toast.dismiss(id);
          return;
        }
        toast.message("Envio pausado — continua sozinho", {
          id,
          description: `${rotulo}: ${e.erro} Está guardado no aparelho e será enviado assim que a conexão melhorar.`,
          duration: 6000,
          ...pos,
        });
      }
    });

    void trabalhosPendentes().then((l) => {
      if (l.length) void processarFila();
    });
    const tick = window.setInterval(() => void processarFila(), 30_000);
    const aoVoltar = () => {
      if (document.visibilityState === "visible") void processarFila();
    };
    const aoConectar = () => void processarFila();
    const antesDeSair = (ev: BeforeUnloadEvent) => {
      if (envioEmAndamento()) {
        ev.preventDefault();
        ev.returnValue = "";
      }
    };
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("online", aoConectar);
    window.addEventListener("beforeunload", antesDeSair);
    return () => {
      sair();
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("online", aoConectar);
      window.removeEventListener("beforeunload", antesDeSair);
    };
  }, [qc]);

  return null;
}
