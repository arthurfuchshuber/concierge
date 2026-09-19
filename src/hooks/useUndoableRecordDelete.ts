import { useCallback } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { notifyAction } from "@/components/UndoActionBar";
import {
  deleteReservationRecord,
  purgeRecordFile,
  restoreReservationRecord,
} from "@/lib/reservation-records.functions";

/**
 * EXCLUIR REGISTRO COM "DESFAZER" (pedido explícito, 17/09/2026).
 *
 * - Some da tela no clique (as duas listas: a aba Registros e o clipe da
 *   reserva), sem esperar o servidor.
 * - O arquivo fica guardado durante os 5s do "Desfazer". Desfez: a linha
 *   volta igual, com o mesmo id. Não desfez: o arquivo é apagado.
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
  const purgeFn = useServerFn(purgeRecordFile);

  const refresh = useCallback(() => {
    for (const k of RECORD_KEYS) void qc.invalidateQueries({ queryKey: [k] });
    void qc.invalidateQueries({ queryKey: ["dash-tasks"] });
  }, [qc]);

  return useCallback(
    (id: string) => {
      const snapshots: Array<[QueryKey, unknown]> = RECORD_KEYS.flatMap((k) =>
        qc.getQueriesData({ queryKey: [k] }),
      );
      for (const k of RECORD_KEYS) {
        void qc.cancelQueries({ queryKey: [k] });
        qc.setQueriesData<WithRecords>({ queryKey: [k] }, (old) =>
          old?.records ? { ...old, records: old.records.filter((r) => r.id !== id) } : old,
        );
      }
      onDeleted?.();

      const request = deleteFn({ data: { id, keepFile: true } });
      request
        .catch((err) => {
          for (const [key, data] of snapshots) qc.setQueryData(key, data);
          toast.error(err instanceof Error ? err.message : "Não foi possível excluir.");
        })
        .finally(refresh);

      notifyAction(
        "Registro excluído.",
        () => {
          for (const [key, data] of snapshots) qc.setQueryData(key, data);
          void request
            .then((res) =>
              res.removed
                ? restoreFn({
                    data: { removed: res.removed, removedTask: res.removedTask ?? null },
                  })
                : null,
            )
            .catch((err) =>
              toast.error(err instanceof Error ? err.message : "Não foi possível desfazer."),
            )
            .finally(refresh);
        },
        {
          onExpire: () => {
            void request
              .then((res) => {
                const path = res.removed?.storage_path;
                if (path) return purgeFn({ data: { storagePath: path } });
                return null;
              })
              .catch(() => {
                /* o arquivo fica órfão; não atrapalha ninguém */
              });
          },
        },
      );
    },
    [qc, deleteFn, restoreFn, purgeFn, refresh, onDeleted],
  );
}
