import { useEffect, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * AO VIVO PARA TODOS, EM TODO O PAINEL (pedido explícito, 01/10/2026):
 * "a atualização de toda e qualquer ação precisa ser instantânea para todos
 * os usuários com a tela aberta". Um único canal escuta as tabelas de
 * operação e, a qualquer mudança (de qualquer pessoa), relê o que está na
 * tela. O banco só entrega mudanças que a pessoa pode ver (RLS), então não há
 * vazamento entre contas. Ao voltar para a aba ou reconectar, relê também —
 * o celular em segundo plano derruba a conexão ao vivo.
 */
const TABLES = [
  "tasks",
  "task_completions",
  "reservation_records",
  "guest_arrival_status",
  "property_reservations",
  "properties",
  "property_owners",
  "service_providers",
  "property_providers",
  "property_recommendations",
  "stakeholder_activities",
  "stakeholder_events",
  "property_chat_conversations",
  "property_chat_messages",
  "account_members",
  "property_assignments",
];

/** Saúde do canal ao vivo: com ele conectado, o polling vira só rede de
 *  segurança espaçada (5 min); sem ele, volta a 30 s até reconectar. */
let healthy = false;
const listeners = new Set<() => void>();
function setHealthy(v: boolean) {
  if (healthy === v) return;
  healthy = v;
  listeners.forEach((l) => l());
}
export function useLiveSyncHealthy() {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => healthy,
    () => false,
  );
}
/** Intervalo de fallback: espaçado quando o tempo real está saudável. */
export function useFallbackInterval(unhealthyMs = 30_000) {
  return useLiveSyncHealthy() ? 5 * 60_000 : unhealthyMs;
}

export function LiveSync() {
  const qc = useQueryClient();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void qc.invalidateQueries({ refetchType: "active" });
      }, 120);
    };

    let channel: ReturnType<typeof supabase.channel> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let stopped = false;

    const connect = async () => {
      if (stopped) return;
      // Token no socket ANTES de assinar: sem ele a RLS descarta os eventos.
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token) supabase.realtime.setAuth(data.session.access_token);
      if (stopped) return;
      if (channel) supabase.removeChannel(channel);
      let ch = supabase.channel(`live-sync-${Date.now()}-${attempt}`);
      for (const table of TABLES) {
        ch = ch.on("postgres_changes", { event: "*", schema: "public", table }, refresh);
      }
      channel = ch;
      ch.subscribe((status) => {
        if (stopped) return;
        if (status === "SUBSCRIBED") {
          setHealthy(true);
          if (attempt > 0) refresh();
          attempt = 0;
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setHealthy(false);
          const wait = Math.min(30_000, 1_000 * 2 ** attempt);
          attempt += 1;
          if (retry) clearTimeout(retry);
          retry = setTimeout(() => void connect(), wait);
        }
      });
    };
    void connect();
    const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.access_token) supabase.realtime.setAuth(session.access_token);
      if (event === "SIGNED_IN") void connect();
    });

    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);

    return () => {
      stopped = true;
      setHealthy(false);
      authSub.subscription.unsubscribe();
      if (timer) clearTimeout(timer);
      if (retry) clearTimeout(retry);
      if (channel) supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [qc]);

  return null;
}
