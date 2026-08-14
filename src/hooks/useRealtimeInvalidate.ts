import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type TableWatch = {
  table: string;
  /** Filtro no formato do Postgres Realtime, ex.: "property_id=eq.<uuid>". */
  filter?: string;
};

/**
 * Generaliza o canal "dash-live" (já usado no Dashboard) para qualquer tela:
 * assina mudanças do Postgres nas tabelas informadas e invalida as queries
 * do React Query indicadas — para QUALQUER usuário com a tela aberta, não só
 * quem fez a alteração. É isto que torna um "Salvar" (ou qualquer escrita)
 * instantâneo para todo mundo, e não só para quem clicou.
 *
 * Debounce de 400ms: evita disparar várias buscas seguidas quando uma ação
 * gera várias escritas em sequência (ex.: salvar o guia grava manual + FAQs
 * + checkout de uma vez).
 */
export function useRealtimeInvalidate(
  channelName: string,
  watches: TableWatch[],
  queryKeysToInvalidate: unknown[][],
  options?: {
    enabled?: boolean;
    /** Se retornar false, a busca automática é pulada (ex.: há edição local
     * não salva — sobrescrever agora apagaria o que a pessoa está digitando). */
    shouldRefetch?: () => boolean;
    /** Sempre dispara, mesmo quando shouldRefetch bloqueia o refetch — use
     * pra avisar "alguém mais alterou isto" sem apagar nada na hora. */
    onRemoteChange?: () => void;
  },
) {
  const qc = useQueryClient();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabled = options?.enabled ?? true;

  useEffect(() => {
    if (!enabled || watches.length === 0) return;

    const invalidate = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const allowed = options?.shouldRefetch ? options.shouldRefetch() : true;
        if (allowed) {
          for (const key of queryKeysToInvalidate) {
            qc.invalidateQueries({ queryKey: key, refetchType: "active" });
          }
        }
        options?.onRemoteChange?.();
      }, 400);
    };

    let channel = supabase.channel(channelName);
    for (const w of watches) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: w.table, ...(w.filter ? { filter: w.filter } : {}) },
        invalidate,
      );
    }
    channel.subscribe();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, enabled, JSON.stringify(watches), JSON.stringify(queryKeysToInvalidate)]);
}
