import { useEffect, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { ensureRealtimeAuth } from "@/lib/realtime-auth";
import { getChangePulse } from "@/lib/change-pulse.functions";
import { AWAY_RESYNC_MS, beginResync, endResync } from "@/lib/resync-state";

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
  // 17/10/2026 — cobertura total: tudo que uma pessoa pode alterar numa tela
  // precisa aparecer na das demais (a publicação no banco vem da migration
  // 20261017120000_realtime_cobertura_total.sql).
  "guide_access_logs",
  "property_manual_items",
  "property_faqs",
  "property_checkout_items",
  "property_emergency_contacts",
  "property_types",
  "city_references",
  "city_reference_groups",
  "city_reference_group_members",
  "property_details",
  "property_daily_tips",
  "property_listing_raw_data",
  "ai_alerts",
  "account_member_permissions",
  "account_member_invites",
  "permission_assignments",
  "owner_ledger_entries",
  "owner_loose_documents",
  "clicksign_documents",
  "reservation_records_trash",
  "stakeholder_link_aliases",
  "provider_categories",
];

/**
 * CONSULTAS DE "CASCA" FORA DA RECARGA POR EVENTO (02/11/2026, auditoria de
 * lentidão): estas leem tabelas que NÃO estão na publicação ao vivo
 * (`user_roles`, `subscriptions`, `profiles`, usuários do login), então um
 * evento das tabelas acima nunca muda o resultado delas. Antes, cada evento
 * recarregava todas — `adminListCustomers` (lista TODOS os usuários do login)
 * rodava ~7 mil vezes por dia. Elas continuam recarregando ao voltar para a
 * aba, ao reconectar e quando a própria tela pede.
 */
const NOT_LIVE = new Set<string>(["is-admin", "my-subscription", "my-profile", "admin-customers", "admin-customers-engajamento"]);

/** Pulso de segurança: de quantos em quantos ms perguntar "algo mudou?". */
const PULSE_MS = 8_000;

/** Saúde do canal ao vivo: com ele conectado, o polling vira só rede de
 *  segurança espaçada (5 min); sem ele, volta a 30 s até reconectar. */
let healthy = false;
const listeners = new Set<() => void>();
function setHealthy(v: boolean) {
  if (healthy === v) return;
  healthy = v;
  listeners.forEach((l) => l());
}
function useLiveSyncHealthy() {
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
  const pulseFn = useServerFn(getChangePulse);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    // `todas`: voltar para a aba / reconectar relê tudo, inclusive a casca.
    let todas = false;
    // `precisaReler`: a tela pode estar mostrando um retrato velho (voltou de segundo plano ou reconectou);
    // os botões de etapa dos cards ficam "Atualizando…" até a releitura terminar (mockup D009, 09/11/2026).
    let precisaReler = false;
    const refresh = (all = false) => {
      todas = todas || all;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const incluirCasca = todas;
        const reler = precisaReler;
        todas = false;
        precisaReler = false;
        const feito = qc.invalidateQueries({
          refetchType: "active",
          predicate: (q) => incluirCasca || !NOT_LIVE.has(String(q.queryKey[0])),
        });
        if (reler) void feito.finally(() => endResync());
      }, 120);
    };
    // Reconexão/volta da internet: eventos podem ter sido perdidos ⇒ sempre relê com os botões em espera.
    const relerAposQueda = () => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      precisaReler = true;
      beginResync();
      refresh(true);
    };
    // Voltar à tela: só conta quando ficou fora tempo suficiente para o canal ao vivo ter perdido algo
    // (uma piscada de aba ou clique fora da janela não pode apagar os botões).
    let ausenteDesde: number | null = null;
    const saiu = () => {
      if (ausenteDesde === null) ausenteDesde = Date.now();
    };
    const voltou = () => {
      const longe = ausenteDesde !== null && Date.now() - ausenteDesde > AWAY_RESYNC_MS;
      ausenteDesde = null;
      if (longe) relerAposQueda();
      else refresh(true);
    };
    const onChange = () => refresh();

    let channel: ReturnType<typeof supabase.channel> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let stopped = false;

    const connect = async () => {
      if (stopped) return;
      // Token no socket ANTES de assinar: sem ele a RLS descarta os eventos.
      await ensureRealtimeAuth();
      if (stopped) return;
      if (retry) clearTimeout(retry);
      retry = null;
      // LAÇO DE RECONEXÃO (bug real, 02/11/2026): remover o canal antigo dispara
      // "CLOSED" NO PRÓPRIO canal antigo. Tratado como queda, isso agendava outra
      // conexão, que removia o canal atual, e assim por diante — a cada ~2 s o
      // painel relia TODAS as consultas (~23 mil chamadas por hora de uma só
      // pessoa, e a trilha de auditoria crescia ~550 mil linhas por dia). Agora
      // o canal antigo sai de cena ANTES de ser removido e só o callback do
      // canal atual decide alguma coisa.
      const old = channel;
      channel = null;
      if (old) supabase.removeChannel(old);
      let ch = supabase.channel(`live-sync-${Date.now()}-${attempt}`);
      for (const table of TABLES) {
        ch = ch.on("postgres_changes", { event: "*", schema: "public", table }, onChange);
      }
      channel = ch;
      const mine = ch;
      ch.subscribe((status) => {
        if (stopped || channel !== mine) return;
        if (status === "SUBSCRIBED") {
          setHealthy(true);
          if (attempt > 0) relerAposQueda();
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
    /* O cliente do login emite SIGNED_IN de novo a cada retomada da sessão
       (voltar para a aba, renovar o token). Refazer o canal nesses casos
       re-assinava as 38 tabelas a cada foco — no banco, ~1,8 milhão de
       consultas de assinatura em 3,6 dias. O token novo já vai pelo
       `setAuth`; o canal só é refeito se mudou a pessoa ou se ele caiu. */
    let connectedUser: string | null = null;
    const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.access_token) supabase.realtime.setAuth(session.access_token);
      if (event !== "SIGNED_IN") return;
      const uid = session?.user?.id ?? null;
      if (healthy && uid && uid === connectedUser) return;
      connectedUser = uid;
      void connect();
    });

    const onVisible = () => {
      if (document.visibilityState === "visible") voltou();
      else saiu();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", relerAposQueda);
    window.addEventListener("focus", voltou);
    window.addEventListener("blur", saiu);

    // PULSO DE SEGURANÇA: mesmo com o canal "saudável", um evento pode se
    // perder sem aviso. A cada PULSE_MS (só com a aba visível e online),
    // compara a impressão digital das tabelas de operação; se mudou, relê a
    // tela. Atraso máximo cai de minutos para poucos segundos.
    let lastPulse: string | null = null;
    let pulsing = false;
    const pulse = async () => {
      if (stopped || pulsing) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      pulsing = true;
      try {
        const r = (await pulseFn()) as { pulse?: string } | undefined;
        const p = r?.pulse ?? null;
        if (p && lastPulse !== null && p !== lastPulse) refresh();
        if (p) lastPulse = p;
      } catch {
        /* a próxima rodada tenta de novo */
      } finally {
        pulsing = false;
      }
    };
    const pulseTimer = setInterval(() => void pulse(), PULSE_MS);
    void pulse();
    // Ao voltar para a aba, a fotografia anterior está velha: compara já.
    const onVisiblePulse = () => {
      if (document.visibilityState === "visible") void pulse();
    };
    document.addEventListener("visibilitychange", onVisiblePulse);

    return () => {
      stopped = true;
      clearInterval(pulseTimer);
      document.removeEventListener("visibilitychange", onVisiblePulse);
      setHealthy(false);
      authSub.subscription.unsubscribe();
      if (timer) clearTimeout(timer);
      if (retry) clearTimeout(retry);
      if (channel) supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", relerAposQueda);
      window.removeEventListener("focus", voltou);
      window.removeEventListener("blur", saiu);
      endResync();
    };
  }, [qc, pulseFn]);

  return null;
}
