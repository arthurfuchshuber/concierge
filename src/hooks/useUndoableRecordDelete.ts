import { useCallback } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { notifyAction } from "@/components/UndoActionBar";
import {
  deleteReservationRecord,
  restoreReservationRecord,
} from "@/lib/reservation-records.functions";

/**
 * EXCLUIR REGISTRO COM "DESFAZER" (pedido explícito, 17/09/2026).
 *
 * - Some da tela no clique (as duas listas: a aba Registros e o clipe da
 *   reserva), sem esperar o servidor.
 * - LIXEIRA OCULTA (04/10/2026): o servidor guarda uma cópia completa por 30
 *   dias (arquivos inclusive) e só então apaga de vez. Desfez: a linha volta
 *   igual, com o mesmo id, e a cópia sai da lixeira.
 * - O grupo inteiro vai em UMA chamada (antes eram várias em paralelo, e a
 *   linha principal só perdia a mídia e continuava viva: o registro "voltava").
 * - Falhou no servidor: a lista volta como estava e aparece o erro.
 *
 * Os dois caches guardam `{ records: [...] }`; qualquer outra forma é
 * deixada como está.
 */
const RECORD_KEYS = ["account-records", "reservation-records"] as const;

type WithRecords = { records?: Array<{ id: string; groupId?: string | null }> };

export function useUndoableRecordDelete(onDeleted?: () => void) {
  const qc = useQueryClient();
  const deleteFn = useServerFn(deleteReservationRecord);
  const restoreFn = useServerFn(restoreReservationRecord);

  const refresh = useCallback(() => {
    for (const k of RECORD_KEYS) void qc.invalidateQueries({ queryKey: [k] });
    void qc.invalidateQueries({ queryKey: ["dash-tasks"] });
  }, [qc]);

  return useCallback(
    /** Um id ou o grupo inteiro (situação com texto + mídias): tudo some de
     * uma vez, com UM único "Desfazer" (pedido 20/09/2026 — o menu não
     * oferece mais excluir pedaço por pedaço). */
    (idOrIds: string | string[]) => {
      const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
      if (ids.length === 0) return;
      const snapshots: Array<[QueryKey, unknown]> = RECORD_KEYS.flatMap((k) =>
        qc.getQueriesData({ queryKey: [k] }),
      );
      for (const k of RECORD_KEYS) {
        void qc.cancelQueries({ queryKey: [k] });
        qc.setQueriesData<WithRecords>({ queryKey: [k] }, (old) =>
          old?.records ? { ...old, records: old.records.filter((r) => !ids.includes(r.id)) } : old,
        );
      }
      onDeleted?.();

      const request = deleteFn({ data: { ids } });
      request
        .catch((err) => {
          for (const [key, data] of snapshots) qc.setQueryData(key, data);
          toast.error(err instanceof Error ? err.message : "Não foi possível excluir.");
        })
        .finally(refresh);

      notifyAction("Registro excluído.", () => {
        for (const [key, data] of snapshots) qc.setQueryData(key, data);
        void request
          .then((res) =>
            res.removed.length > 0
              ? restoreFn({
                  data: {
                    trashId: res.trashId,
                    removed: res.removed,
                    removedTasks: res.removedTasks,
                  },
                })
              : null,
          )
          .catch((err) =>
            toast.error(err instanceof Error ? err.message : "Não foi possível desfazer."),
          )
          .finally(refresh);
      });
    },
    [qc, deleteFn, restoreFn, refresh, onDeleted],
  );
}
