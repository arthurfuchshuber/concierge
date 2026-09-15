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

    let current: ReturnType<typeof supabase.channel> | null = null;
    let tentativa = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelado = false;

    const conectar = () => {
      if (cancelado) return;
      if (current) supabase.removeChannel(current);
      let channel = supabase.channel(`${channelName}-${Date.now()}-${tentativa}`);
      for (const w of watches) {
        channel = channel.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: w.table,
            ...(w.filter ? { filter: w.filter } : {}),
          },
          invalidate,
        );
      }
      current = channel;
      channel.subscribe((status) => {
        if (cancelado) return;
        if (status === "SUBSCRIBED") {
          // Reconectou: busca o que mudou enquanto a conexão esteve fora.
          if (tentativa > 0) invalidate();
          tentativa = 0;
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          const espera = Math.min(30_000, 1_000 * 2 ** tentativa);
          tentativa += 1;
          if (retryTimer) clearTimeout(retryTimer);
          retryTimer = setTimeout(conectar, espera);
        }
      });
    };

    conectar();

    return () => {
      cancelado = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (current) supabase.removeChannel(current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, enabled, JSON.stringify(watches), JSON.stringify(queryKeysToInvalidate)]);
}
