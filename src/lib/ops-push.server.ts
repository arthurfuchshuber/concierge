// Server-only: notificações push operacionais (check-ins / check-outs).
// Importar somente dentro de handlers (server routes / server functions).

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PUSH_GAP_MINUTES,
  arrivalStepBody,
  arrivalStepTitle,
  bodyByCity,
  conversationBody,
  conversationTitle,
  dashboardWindowUrl,
  guestPushBody,
  inDailyWindow,
  opsTitles,
  rankScanCandidates,
  truncateLine,
  truncateText,
  type ScanCandidate,
} from "@/lib/push-format";
import type { Database } from "@/integrations/supabase/types";
import { sendPushToSubscriptions, type PushPayload } from "@/lib/push.server";

type Admin = SupabaseClient<Database>;

const TZ = "America/Sao_Paulo";

export type LocalNow = {
  /** YYYY-MM-DD no fuso de São Paulo */
  date: string;
  hour: number;
  minute: number;
  /** minutos desde 00:00 local */
  minutes: number;
};

function localNow(now = new Date()): LocalNow {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour,
    minute,
    minutes: hour * 60 + minute,
  };
}

/** "15:00" | "15:00:00" -> minutos. Retorna fallback se inválido. */
function timeToMinutes(value: string | null | undefined, fallback: number): number {
  if (!value) return fallback;
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!m) return fallback;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (Number.isNaN(h) || Number.isNaN(min)) return fallback;
  return h * 60 + min;
}

function fmtTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const DEFAULT_CHECKIN = 15 * 60; // 15:00
const DEFAULT_CHECKOUT = 11 * 60; // 11:00

/** Usuários que devem receber avisos operacionais de uma conta (owner + membros ativos owner/agent). */
async function getAccountNotifiableUsers(admin: Admin, ownerId: string): Promise<string[]> {
  const { data: members } = await admin
    .from("account_members")
    .select("member_user_id, role, status")
    .eq("owner_id", ownerId)
    .eq("status", "active");
  const ids = new Set<string>([ownerId]);
  for (const m of members ?? []) {
    if (m.role === "owner" || m.role === "agent") ids.add(m.member_user_id as string);
  }
  return Array.from(ids);
}

/**
 * Todos os VINCULADOS a um imóvel (pedido explícito, 16/10/2026): titular +
 * membros ativos que enxergam o imóvel (qualquer papel) + quem tem vínculo
 * direto ao imóvel (`property_assignments` ativos: co-anfitrião, prestador…).
 * Usado em check-in, check-out e limpeza concluídos.
 */
async function getPropertyLinkedUsers(admin: Admin, ownerId: string, propertyId: string): Promise<string[]> {
  const ids = new Set<string>([ownerId]);
  const { data: members } = await admin
    .from("account_members")
    .select("member_user_id")
    .eq("owner_id", ownerId)
    .eq("status", "active");
  for (const m of members ?? []) {
    const uid = m.member_user_id as string | null;
    if (!uid) continue;
    const { data: ok } = await admin.rpc("member_can_see_property", {
      _user_id: uid,
      _owner_id: ownerId,
      _property_id: propertyId,
    });
    if (ok) ids.add(uid);
  }
  const { data: asg } = await admin
    .from("property_assignments")
    .select("user_id, status")
    .eq("property_id", propertyId);
  for (const a of asg ?? []) {
    if ((a.status ?? "active") !== "inactive" && a.user_id) ids.add(a.user_id as string);
  }
  return Array.from(ids);
}

/**
 * Envia um push operacional a uma conta, garantindo unicidade via `dedupe_key`.
 * Se a chave já existir no log, nada é enviado.
 */
async function sendOpsPush(
  admin: Admin,
  opts: {
    ownerId: string;
    kind: string;
    dedupeKey: string;
    payload: PushPayload;
    /** Destinatários específicos. Se omitido, usa owner + membros ativos. */
    userIds?: string[];
  },
): Promise<{ sent: number; skipped: boolean }> {
  const { error: dedupeError } = await admin.from("ops_push_log").insert({
    owner_id: opts.ownerId,
    kind: opts.kind,
    dedupe_key: opts.dedupeKey,
    payload: JSON.parse(JSON.stringify(opts.payload)),
  });
  // Violação de unicidade => já enviado nesta janela
  if (dedupeError) return { sent: 0, skipped: true };

  // Se nada for enviado agora, apagamos a marca de dedupe para que a próxima
  // execução do cron possa tentar de novo (senão o aviso se perderia).
  const releaseDedupe = async () => {
    await admin.from("ops_push_log").delete().eq("dedupe_key", opts.dedupeKey);
  };

  const userIds = opts.userIds ?? (await getAccountNotifiableUsers(admin, opts.ownerId));
  if (userIds.length === 0) {
    await releaseDedupe();
    return { sent: 0, skipped: false };
  }


  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("user_id", userIds)
    .eq("enabled", true);
  if (!subs || subs.length === 0) {
    await releaseDedupe();
    return { sent: 0, skipped: false };
  }

  let res: { sent: number; stale: string[] };
  try {
    res = await sendPushToSubscriptions(
      subs.map((s) => ({
        id: s.id as string,
        endpoint: s.endpoint as string,
        p256dh: s.p256dh as string,
        auth: s.auth as string,
      })),
      opts.payload,
    );
  } catch (err) {
    await releaseDedupe();
    throw err;
  }
  if (res.stale.length) await admin.from("push_subscriptions").delete().in("id", res.stale);

  await admin.from("ops_push_log").update({ sent_count: res.sent }).eq("dedupe_key", opts.dedupeKey);
  return { sent: res.sent, skipped: false };
}

type PropRow = {
  id: string;
  owner_id: string;
  name: string | null;
  city: string | null;
  checkin_time: string | null;
  checkin_time_max: string | null;
  checkout_time: string | null;
};

/**
 * Varredura operacional. Roda a cada 30 minutos (cron).
 * A fonte de verdade é EXATAMENTE a mesma esteira (Kanban) do dashboard:
 * usamos `buildArrivalRows` e consideramos apenas os cards pendentes.
 *
 * Avisos (textos do mockup aprovado em 07/11/2026):
 *  · 🔴 Check-Out(s) Atrasado(s) — passou do horário oficial, sem "check";
 *  · 🔴 Check-In(s) Atrasado(s) — passou do horário LIMITE (ou da chegada
 *    avisada pelo hóspede). Antes do limite é só pendente: não avisa;
 *  · Check-In(s) de Hoje — a partir das 07h;
 *  · Check-Out(s) de Amanhã — a partir das 20h;
 *
 * TIMING (pedido explícito, 07/11/2026: "precisa ter intervalo entre os
 * pushs"): no máximo UM aviso por rodada e por conta, escolhido por
 * prioridade (`rankScanCandidates`); o resto fica para a rodada seguinte.
 * Nada sai se a conta recebeu um push nos últimos 5 minutos. Atrasos repetem
 * no máximo de hora em hora (chave de unicidade por hora).
 */
export async function runOpsPushScan(admin: Admin, now = new Date()) {
  const t = localNow(now);
  const today = t.date;
  const { buildArrivalRows } = await import("@/lib/arrival-board.server");

  // SEM filtro de `published`: essa varredura precisa enxergar EXATAMENTE os
  // mesmos imóveis que aparecem no Kanban/Dashboard operacional, que não
  // filtra por publicação do guia (um imóvel duplicado nasce com
  // published=false, e um imóvel pode ficar despublicado temporariamente
  // durante uma edição — em nenhum dos dois casos ele para de operar).
  const { data: propsRaw } = await admin
    .from("properties")
    .select("id, owner_id, name, city, checkin_time, checkin_time_max, checkout_time");
  const props = (propsRaw ?? []) as PropRow[];
  if (props.length === 0) return { ownersNotified: 0, notifications: 0 };

  const propsByOwner = new Map<string, PropRow[]>();
  for (const p of props) {
    const arr = propsByOwner.get(p.owner_id) ?? [];
    arr.push(p);
    propsByOwner.set(p.owner_id, arr);
  }

  const hourKey = (h: number) => `${t.date}-${String(h).padStart(2, "0")}`;
  const slotHour = hourKey(t.hour);
  const prevHour = t.hour > 0 ? hourKey(t.hour - 1) : null;
  const nowMs = now.getTime();
  const gapSince = new Date(nowMs - PUSH_GAP_MINUTES * 60_000).toISOString();

  let notifications = 0;
  const owners = new Set<string>();

  // Proprietários são processados em PARALELO (não mais um por vez, em
  // sequência): cada um é totalmente independente (própria query, próprio
  // dedupe), e a varredura roda em contas com muitos proprietários — a
  // versão sequencial somava o tempo de todo mundo e estourava o timeout de
  // 5s do pg_net (chamada do cron via net.http_post), fazendo o cron
  // "desistir" antes do fim mesmo com o endpoint funcionando normalmente.
  await Promise.all(
    Array.from(propsByOwner.entries()).map(async ([ownerId, ownerProps]) => {
    // Respiro: a conta recebeu um push há pouco → esta rodada não manda nada.
    const { data: recent } = await admin
      .from("ops_push_log")
      .select("id")
      .eq("owner_id", ownerId)
      .gt("sent_count", 0)
      .gte("created_at", gapSince)
      .limit(1);
    if ((recent ?? []).length > 0) return;

    const propById = new Map(ownerProps.map((p) => [p.id, p]));
    const propIds = ownerProps.map((p) => p.id);

    const needTomorrow = inDailyWindow(t.hour, 20);
    const needToday = inDailyWindow(t.hour, 7);
    const [checkoutToday, checkinToday, checkoutTomorrow] = await Promise.all([
      buildArrivalRows(admin as never, { kind: "checkout", range: "today", propIds }),
      buildArrivalRows(admin as never, { kind: "checkin", range: "today", propIds }),
      needTomorrow
        ? buildArrivalRows(admin as never, { kind: "checkout", range: "tomorrow", propIds })
        : Promise.resolve({ rows: [] as Awaited<ReturnType<typeof buildArrivalRows>>["rows"] }),
    ]);

    const pendingCheckouts = checkoutToday.rows.filter((r) => r.status === "pending");
    const pendingCheckins = checkinToday.rows.filter((r) => r.status === "pending");

    const cityOf = (propertyId: string, fallback: string | null) => {
      const p = propById.get(propertyId);
      return (p?.city || p?.name || fallback || "Imóvel sem cidade").trim();
    };
    /** Card silenciado pelo usuário no Kanban (só afeta alertas de atraso). */
    const isMuted = (r: { mutedUntil: string | null }) =>
      !!r.mutedUntil && new Date(r.mutedUntil).getTime() > nowMs;
    const tally = (map: Map<string, number>, city: string) => map.set(city, (map.get(city) ?? 0) + 1);

    type Candidate = ScanCandidate & { dedupeKey: string; payload: PushPayload };
    const candidates: Candidate[] = [];

    // Check-outs de amanhã (mesma lista do Kanban, filtro "Amanhã").
    const tomorrowRows = checkoutTomorrow.rows.filter((r) => r.status === "pending");
    if (needTomorrow && tomorrowRows.length > 0) {
      const byCity = new Map<string, number>();
      for (const r of tomorrowRows) tally(byCity, cityOf(r.propertyId, r.propertyName));
      candidates.push({
        kind: "checkouts-tomorrow",
        dedupeKey: `checkouts-tomorrow:${ownerId}:${today}`,
        payload: {
          title: opsTitles.checkoutsTomorrow(tomorrowRows.length),
          body: bodyByCity(byCity),
          data: { url: dashboardWindowUrl("checkouts-amanha"), tag: "ops-checkouts-tomorrow" },
        },
      });
    }

    // Check-ins de hoje.
    const checkinTodayRows = pendingCheckins.filter((r) => r.date === today);
    if (needToday && checkinTodayRows.length > 0) {
      const byCity = new Map<string, number>();
      for (const r of checkinTodayRows) tally(byCity, cityOf(r.propertyId, r.propertyName));
      candidates.push({
        kind: "checkins-today",
        dedupeKey: `checkins-today:${ownerId}:${today}`,
        payload: {
          title: opsTitles.checkinsToday(checkinTodayRows.length),
          body: bodyByCity(byCity),
          data: { url: dashboardWindowUrl("checkins"), tag: "ops-checkins-today" },
        },
      });
    }

    // ----- atrasos (com base nos cards pendentes da esteira) -----
    const lateCheckoutsByCity = new Map<string, number>();
    let lateCheckouts = 0;
    for (const r of pendingCheckouts) {
      if (r.date > today) continue;
      if (isMuted(r)) continue;
      const p = propById.get(r.propertyId);
      const limit = timeToMinutes(r.standardTime ?? p?.checkout_time ?? null, DEFAULT_CHECKOUT);
      const lateBy = r.date < today ? 24 * 60 : t.minutes - limit;
      if (lateBy <= 0) continue;
      lateCheckouts++;
      tally(lateCheckoutsByCity, cityOf(r.propertyId, r.propertyName));
    }

    const lateCheckinsByCity = new Map<string, number>();
    let lateCheckins = 0;
    for (const r of pendingCheckins) {
      // Previsão de chegada posterior (o `date` do card já resolve o
      // override): enquanto o dia previsto não chegou, nada está atrasado.
      if (r.date > today) continue;
      if (isMuted(r)) continue;
      const p = propById.get(r.propertyId);
      // Pedido explícito do cliente (05/09/2026, reforçado em 07/11/2026):
      // check-in só é ATRASADO depois do HORÁRIO LIMITE configurado para o
      // imóvel — antes disso é só pendente e não gera aviso. Se o hóspede
      // avisou uma chegada ainda mais tarde, ela prevalece.
      const configuredLimit = timeToMinutes(
        r.standardTimeMax ?? p?.checkin_time_max ?? r.standardTime ?? p?.checkin_time ?? null,
        DEFAULT_CHECKIN,
      );
      const predicted = r.arrivalTimeOverride ?? r.guestArrivalTime ?? null;
      const predictedLimit = predicted ? timeToMinutes(predicted, configuredLimit) : configuredLimit;
      const limit = Math.max(configuredLimit, predictedLimit);
      const lateBy = r.date < today ? 24 * 60 : t.minutes - limit;
      if (lateBy <= 0) continue;
      lateCheckins++;
      tally(lateCheckinsByCity, cityOf(r.propertyId, r.propertyName));
    }

    // Repetição = o mesmo atraso já foi avisado na hora anterior.
    const prevKeys = prevHour
      ? [`checkouts-late:${ownerId}:${prevHour}`, `checkins-late:${ownerId}:${prevHour}`]
      : [];
    const { data: prevRows } = prevKeys.length
      ? await admin.from("ops_push_log").select("dedupe_key").in("dedupe_key", prevKeys)
      : { data: [] as Array<{ dedupe_key: string }> };
    const sentBefore = new Set((prevRows ?? []).map((r) => r.dedupe_key as string));

    if (lateCheckouts > 0) {
      candidates.push({
        kind: "checkouts-late",
        repeat: sentBefore.has(`checkouts-late:${ownerId}:${prevHour}`),
        dedupeKey: `checkouts-late:${ownerId}:${slotHour}`,
        payload: {
          title: opsTitles.checkoutsLate(lateCheckouts),
          body: bodyByCity(lateCheckoutsByCity),
          data: { url: dashboardWindowUrl("checkouts"), tag: "ops-checkouts-late" },
        },
      });
    }
    if (lateCheckins > 0) {
      candidates.push({
        kind: "checkins-late",
        repeat: sentBefore.has(`checkins-late:${ownerId}:${prevHour}`),
        dedupeKey: `checkins-late:${ownerId}:${slotHour}`,
        payload: {
          title: opsTitles.checkinsLate(lateCheckins),
          body: bodyByCity(lateCheckinsByCity),
          data: { url: dashboardWindowUrl("checkins"), tag: "ops-checkins-late" },
        },
      });
    }

    // "Aguardando Limpeza" NÃO repete mais na varredura (pedido explícito, 08/11/2026): o aviso sai uma vez,
    // no momento em que o imóvel é liberado — no check-out confirmado (push "Check-Out Confirmado", que abre
    // a Fila de Limpeza) ou, na baixa automática do horário oficial, num aviso em massa por conta
    // (`notifyAutoCheckoutBatch`).

    // Um só por rodada: o primeiro da fila que ainda não saiu nesta janela.
    for (const c of rankScanCandidates(candidates)) {
      const r = await sendOpsPush(admin, { ownerId, kind: c.kind, dedupeKey: c.dedupeKey, payload: c.payload });
      if (r.skipped) continue; // já saiu nesta janela → tenta o próximo
      if (r.sent > 0) {
        notifications++;
        owners.add(ownerId);
      }
      break;
    }
    }),
  );

  return {
    ownersNotified: owners.size,
    notifications,
    localTime: `${today} ${fmtTime(t.minutes)}`,
  };
}

/**
 * Baixa AUTOMÁTICA do horário oficial (cron): UM aviso em massa "🧹 Aguardando Limpeza" por pessoa, com a
 * contagem por cidade dos imóveis dela que acabaram de ser liberados — nunca um push por imóvel (pedido
 * explícito, 08/11/2026). Destinatários: todos os vinculados a esses imóveis; cada um recebe só a contagem
 * dos imóveis a que tem acesso. Um envio por grupo de pessoas com o mesmo conjunto de imóveis.
 */
export async function notifyAutoCheckoutBatch(
  admin: Admin,
  opts: { propertyIds: string[]; runKey: string },
): Promise<{ notifications: number }> {
  const ids = [...new Set(opts.propertyIds)];
  if (ids.length === 0) return { notifications: 0 };
  const { data } = await admin.from("properties").select("id, owner_id, name, city").in("id", ids);
  const props = (data ?? []) as Array<{ id: string; owner_id: string; name: string | null; city: string | null }>;
  const byOwner = new Map<string, typeof props>();
  for (const p of props) byOwner.set(p.owner_id, [...(byOwner.get(p.owner_id) ?? []), p]);

  let notifications = 0;
  for (const [ownerId, list] of byOwner) {
    // pessoa → imóveis liberados a que ela tem acesso
    const perUser = new Map<string, string[]>();
    for (const p of list) {
      for (const u of await getPropertyLinkedUsers(admin, ownerId, p.id)) {
        perUser.set(u, [...(perUser.get(u) ?? []), p.id]);
      }
    }
    // agrupa pessoas com o mesmo conjunto de imóveis (um envio por grupo)
    const groups = new Map<string, string[]>();
    for (const [u, pids] of perUser) {
      const key = [...pids].sort().join(",");
      groups.set(key, [...(groups.get(key) ?? []), u]);
    }
    const propById = new Map(list.map((p) => [p.id, p]));
    for (const [key, userIds] of groups) {
      const byCity = new Map<string, number>();
      for (const pid of key.split(",")) {
        const p = propById.get(pid);
        const city = (p?.city || p?.name || "Imóvel sem cidade").trim();
        byCity.set(city, (byCity.get(city) ?? 0) + 1);
      }
      const r = await sendOpsPush(admin, {
        ownerId,
        kind: "auto-checkout-batch",
        dedupeKey: `auto-checkout-batch:${ownerId}:${opts.runKey}:${key}`.slice(0, 400),
        userIds,
        payload: {
          title: opsTitles.cleaningPending(),
          body: bodyByCity(byCity, { one: "imóvel", many: "imóveis" }),
          data: { url: dashboardWindowUrl("limpeza"), tag: "ops-auto-checkout" },
        },
      });
      if (r.sent > 0) notifications++;
    }
  }
  return { notifications };
}

/** Aviso de que um hóspede iniciou uma conversa com a IA. */
export async function sendConversationStartedPush(
  admin: Admin,
  opts: { propertyId: string; propertyName: string | null; conversationId: string; guestName: string | null; firstMessage: string | null },
) {
  const { data: prop } = await admin
    .from("properties")
    .select("owner_id")
    .eq("id", opts.propertyId)
    .maybeSingle();
  if (!prop?.owner_id) return { sent: 0, skipped: true };

  // Padrão Airbnb (mockup 07/11/2026): "Nome • 7–8 de nov." / imóvel / mensagem.
  const guest = opts.guestName?.trim() || "Hóspede";
  const { resolveStayRange } = await import("@/lib/handoff.server");
  const range = await resolveStayRange(admin, { propertyId: opts.propertyId, guestName: opts.guestName });
  const message = truncateText(opts.firstMessage, 140) || "Nova conversa com a IA.";
  return sendOpsPush(admin, {
    ownerId: prop.owner_id as string,
    kind: "conversation-started",
    dedupeKey: `conversation-started:${opts.conversationId}`,
    payload: {
      title: conversationTitle(guest, range),
      body: conversationBody(opts.propertyName, message),
      data: {
        url: `/admin/atendimento?conv=${opts.conversationId}`,
        conversationId: opts.conversationId,
        tag: `conv-start-${opts.conversationId}`,
      },
    },
  });
}

// ===========================================================================
// Notificações de LIMPEZA (design próprio, separado dos avisos da esteira).
// data.style = "cleaning-ready" | "cleaning-done" → o service worker aplica
// ícone, vibração e ações diferentes das notificações operacionais.
// ===========================================================================

const CLEANING_RE = /limp|faxin|clean|housekeep/i;

function isCleaningCategory(row: { category?: string | null; categories?: string[] | null }): boolean {
  if (row.category && CLEANING_RE.test(row.category)) return true;
  return (row.categories ?? []).some((c) => CLEANING_RE.test(c ?? ""));
}

const COUNTRY_RE = /\b(brasil|brazil|br|portugal|pt|argentina|espanha|spain|usa|eua|estados unidos|united states)\b/i;

/** Remove sufixos de país (ex.: "Florianópolis, Brasil" → "Florianópolis"). */
function cleanCity(city?: string | null): string {
  if (!city) return "";
  const parts = String(city)
    .split(/[,/·–-]/)
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !COUNTRY_RE.test(p));
  return (parts[0] ?? "").trim();
}

async function getPropertyBasics(admin: Admin, propertyId: string) {
  const { data } = await admin
    .from("properties")
    .select("id, owner_id, name, city, address")
    .eq("id", propertyId)
    .maybeSingle();
  const prop = data as
    | {
        id: string;
        owner_id: string;
        name: string | null;
        city: string | null;
        address: string | null;
      }
    | null;
  if (!prop) return null;

  return {
    ...prop,
    cityClean: cleanCity(prop.city),
  };
}

/**
 * Check-out confirmado → avisa os prestadores de LIMPEZA vinculados ao imóvel
 * que a casa já está liberada para a faxina.
 */
export async function notifyCleaningReady(
  admin: Admin,
  opts: { propertyId: string; refKey: string; guestName?: string | null },
) {
  const prop = await getPropertyBasics(admin, opts.propertyId);
  if (!prop) return { sent: 0, skipped: true };

  const { data: providersRaw } = await admin
    .from("service_providers")
    .select("member_user_id, category, categories, status")
    .eq("account_owner_id", prop.owner_id)
    .not("member_user_id", "is", null);

  const cleaners = (providersRaw ?? []).filter(
    (p) =>
      (p.status ?? "active") !== "inactive" &&
      isCleaningCategory(p as { category?: string | null; categories?: string[] | null }),
  );
  if (cleaners.length === 0) return { sent: 0, skipped: true };

  const cleanerIds = Array.from(new Set(cleaners.map((p) => p.member_user_id as string)));

  // Só notifica quem está vinculado a esta residência.
  const { data: assignments } = await admin
    .from("property_assignments")
    .select("user_id, status")
    .eq("property_id", opts.propertyId)
    .in("user_id", cleanerIds);
  const targets = Array.from(
    new Set((assignments ?? []).filter((a) => (a.status ?? "active") !== "inactive").map((a) => a.user_id as string)),
  );
  if (targets.length === 0) return { sent: 0, skipped: true };

  const name = (prop.name || "Residência").trim();
  return sendOpsPush(admin, {
    ownerId: prop.owner_id,
    kind: "cleaning-ready",
    dedupeKey: `cleaning-ready:${opts.propertyId}:${opts.refKey}`,
    userIds: targets,
    payload: {
      title: "🧹 Liberado para Limpeza",
      body: truncateLine(name),
      data: {
        url: dashboardWindowUrl("limpeza"),
        tag: `cleaning-ready-${opts.propertyId}`,
        style: "cleaning-ready",
        propertyId: opts.propertyId,
      },
    },
  });
}

/**
 * Limpeza finalizada → avisa TODOS os vinculados ao imóvel (pedido explícito,
 * 07/11/2026), menos quem acabou de concluir — como no check-in/check-out
 * confirmado, ninguém recebe o aviso da própria ação.
 */
export async function notifyCleaningDone(
  admin: Admin,
  opts: { propertyId: string; refKey: string; byUserId?: string | null },
) {
  const prop = await getPropertyBasics(admin, opts.propertyId);
  if (!prop) return { sent: 0, skipped: true };

  const all = await getPropertyLinkedUsers(admin, prop.owner_id, opts.propertyId);
  const userIds = all.filter((u) => u !== (opts.byUserId ?? null));
  if (userIds.length === 0) return { sent: 0, skipped: true };

  const name = (prop.name || "Residência").trim();
  return sendOpsPush(admin, {
    ownerId: prop.owner_id,
    kind: "cleaning-done",
    dedupeKey: `cleaning-done:${opts.propertyId}:${opts.refKey}`,
    userIds,
    payload: {
      title: "✨ Limpeza Finalizada",
      body: truncateLine(name),
      data: {
        url: dashboardWindowUrl("limpeza"),
        tag: `cleaning-done-${opts.propertyId}`,
        style: "cleaning-done",
        propertyId: opts.propertyId,
      },
    },
  });
}

/**
 * PUSH AO HÓSPEDE: IMÓVEL LIBERADO PARA CHECK-IN (26/09/2026).
 * Disparado quando a limpeza é finalizada. Vai para as conversas do guia
 * cujo hóspede tem entrada HOJE no imóvel (nome do formulário do guia).
 * Uma vez por estadia (dedupe em `ops_push_log`).
 */
export async function notifyGuestCheckinReleased(admin: Admin, opts: { propertyId: string }) {
  const { data: prop } = await admin
    .from("properties")
    .select("owner_id, slug, checkin_time, name, city")
    .eq("id", opts.propertyId)
    .maybeSingle();
  if (!prop) return { sent: 0 };
  // ANTES do horário oficial, liberar é decisão HUMANA (18/10/2026): a IA só
  // pergunta à equipe (botões) quando o hóspede pediu para antecipar; nunca
  // avisa o hóspede por conta própria.
  const checkinHour = Number(String((prop as { checkin_time?: string | null }).checkin_time ?? "15").slice(0, 2)) || 15;
  const nowHour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hourCycle: "h23" }).format(new Date()),
  );
  const beforeOfficial = nowHour < checkinHour;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const { data: logs } = await admin
    .from("guide_access_logs")
    .select("id, guest_name")
    .eq("property_id", opts.propertyId)
    .eq("checkin_date", today)
    .limit(20);
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  let sent = 0;
  const { sendPushToGuest } = await import("@/lib/guest-push.server");
  for (const l of (logs ?? []) as Array<{ id: string; guest_name: string | null }>) {
    if (!l.guest_name) continue;
    const dedupeKey = `guest-checkin-released:${l.id}`;
    const { error: dupErr } = await admin.from("ops_push_log").insert({
      owner_id: prop.owner_id,
      kind: "guest-checkin-released",
      dedupe_key: dedupeKey,
      payload: {},
    });
    if (dupErr) continue;
    const { data: convs } = await admin
      .from("property_chat_conversations")
      .select("id, guest_name")
      .eq("property_id", opts.propertyId)
      .order("created_at", { ascending: false })
      .limit(50);
    const target = norm(l.guest_name);
    const mine = ((convs ?? []) as Array<{ id: string; guest_name: string | null }>).filter(
      (c) => c.guest_name && norm(c.guest_name) === target,
    );
    let n = 0;
    if (beforeOfficial) {
      // Antes do horário oficial de check-in, a liberação antecipada é decisão
      // da equipe (feita pelo painel); o hóspede não é avisado automaticamente.
      await admin.from("ops_push_log").delete().eq("dedupe_key", dedupeKey);
      continue;
    }
    for (const c of mine) {
      // Push ao hóspede (mockup 07/11/2026): título = imóvel; "📍 cidade" + mensagem.
      const r = await sendPushToGuest(c.id, {
        title: ((prop as { name?: string | null }).name ?? "").trim() || "Seu imóvel",
        body: guestPushBody(
          cleanCity((prop as { city?: string | null }).city),
          "A limpeza foi concluída! Verifique com a equipe se há possibilidade de antecipação!",
        ),
        data: { url: prop.slug ? `/g/${prop.slug}?chat=1` : "/", tag: `guest-release-${l.id}` },
      });
      n += r.sent;
    }
    if (n === 0) await admin.from("ops_push_log").delete().eq("dedupe_key", dedupeKey);
    sent += n;
  }
  return { sent };
}

/**
 * PUSH DE CHECK-IN / CHECK-OUT: UM SÓ POR ESTADIA, NA MESMA ORDEM (pedido
 * explícito, 08/10/2026: "há 2 pushs para o mesmo assunto.. tem que ser apenas
 * 1"; "informação, título do imóvel, proprietário, hóspede").
 *
 * Por que saíam dois: quando o hóspede confirma pelo guia, o painel avançava o
 * card (e avisava a equipe — "Check-in confirmado") e logo depois o guia
 * mandava o seu aviso ("Check-in feito pelo hóspede"). Agora o guia avisa o
 * painel para NÃO mandar o primeiro (`skipStaffPush`), e os dois avisos
 * dividem a MESMA chave de unicidade: se por qualquer caminho os dois
 * tentarem sair, só o primeiro sai.
 *
 * Formato (mockup aprovado em 07/11/2026): título = a informação
 * ("Check-In Feito pelo Hóspede" / "Check-In Confirmado por Fulano");
 * corpo = imóvel numa linha (cortado com reticências) + "Hóspede: nome".
 * O proprietário não aparece mais no push.
 */
function arrivalPushDedupeKey(kind: "checkin" | "checkout", stayKey: string): string {
  return `arrival-step-${kind}:${stayKey}`;
}

/** Check-in confirmado → janela Em Estadia; check-out → Fila de Limpeza. */
function arrivalPushUrl(kind: "checkin" | "checkout"): string {
  return dashboardWindowUrl(kind === "checkin" ? "estadia" : "limpeza");
}

/** Push interno: hóspede confirmou check-in/check-out pelo guia. */
export async function notifyGuestSelfStep(
  admin: Admin,
  opts: { propertyId: string; kind: "checkin" | "checkout"; stayKey: string; guestName?: string | null },
) {
  const prop = await getPropertyBasics(admin, opts.propertyId);
  if (!prop) return { sent: 0, skipped: true };
  const userIds = await getPropertyLinkedUsers(admin, prop.owner_id, opts.propertyId);
  const name = (prop.name || "Residência").trim();
  return sendOpsPush(admin, {
    ownerId: prop.owner_id,
    kind: `guest-self-${opts.kind}`,
    dedupeKey: arrivalPushDedupeKey(opts.kind, opts.stayKey),
    userIds,
    payload: {
      title: arrivalStepTitle(opts.kind, { guest: true }),
      body: arrivalStepBody(name, opts.guestName),
      data: { url: arrivalPushUrl(opts.kind), tag: `arrival-step-${opts.kind}-${opts.stayKey}`, propertyId: opts.propertyId },
    },
  });
}

/**
 * LIMPEZA CRIADA MANUALMENTE → avisa o prestador escolhido (pedido explícito,
 * 02/10/2026: "tem que ir para os envolvidos (via push)").
 *
 * Por que NÃO reaproveita `notifyCleaningReady`: aquele aviso vai para todos
 * os prestadores de limpeza vinculados ao imóvel. Na limpeza manual a pessoa
 * escolhe UM prestador — que pode nem ser o do imóvel —, então o aviso vai só
 * para ele. Prestador sem login no sistema (ou sem notificação ativa no
 * aparelho) não recebe nada; quem chama fica sabendo por `sent`.
 *
 * Com data futura o aviso sai na hora da criação dizendo o dia: não existe
 * rotina que avise de novo quando o dia chegar.
 */
export async function notifyManualCleaningAssigned(
  admin: Admin,
  opts: { propertyId: string; providerId: string; refKey: string; date: string; today: string },
) {
  const prop = await getPropertyBasics(admin, opts.propertyId);
  if (!prop) return { sent: 0, skipped: true };
  const { data: prov } = await admin
    .from("service_providers")
    .select("member_user_id, account_owner_id")
    .eq("id", opts.providerId)
    .maybeSingle();
  const userId = (prov as { member_user_id?: string | null } | null)?.member_user_id ?? null;
  if (!userId) return { sent: 0, skipped: true };

  const name = (prop.name || "Residência").trim();
  const future = opts.date > opts.today;
  const ddmm = `${opts.date.slice(8, 10)}/${opts.date.slice(5, 7)}`;
  return sendOpsPush(admin, {
    ownerId: prop.owner_id,
    kind: "cleaning-manual",
    dedupeKey: `cleaning-manual:${opts.refKey}:${opts.providerId}`,
    userIds: [userId],
    payload: {
      title: future ? `🧹 Limpeza Agendada para ${ddmm}` : "🧹 Nova Limpeza para Você",
      body: truncateLine(name),
      data: {
        url: dashboardWindowUrl("limpeza"),
        tag: `cleaning-manual-${opts.refKey}`,
        style: "cleaning-ready",
        propertyId: opts.propertyId,
      },
    },
  });
}

/**
 * Check-in / check-out CONFIRMADO POR UM USUÁRIO → avisa os demais (05/10/2026).
 * O autor não recebe o próprio aviso. O do hóspede continua em
 * `notifyGuestSelfStep`; aqui é o lado da equipe.
 */
export async function notifyStaffArrivalStep(
  admin: Admin,
  opts: {
    propertyId: string;
    kind: "checkin" | "checkout";
    stayKey: string;
    byUserId?: string | null;
    /** Para achar o nome do hóspede (só é usado se for um UUID/reserva reais). */
    logId?: string | null;
    reservationId?: string | null;
  },
) {
  const prop = await getPropertyBasics(admin, opts.propertyId);
  if (!prop) return { sent: 0, skipped: true };
  const all = await getPropertyLinkedUsers(admin, prop.owner_id, opts.propertyId);
  const userIds = all.filter((u) => u !== (opts.byUserId ?? null));
  if (userIds.length === 0) return { sent: 0, skipped: true };

  let who = "";
  if (opts.byUserId) {
    const { data: pr } = await admin
      .from("profiles")
      .select("full_name, trade_name")
      .eq("id", opts.byUserId)
      .maybeSingle();
    const p = pr as { full_name?: string | null; trade_name?: string | null } | null;
    who = ((p?.trade_name || p?.full_name) ?? "").trim();
  }

  // Hóspede da estadia (08/10/2026): o formato do aviso agora traz "Hóspede: …".
  let guest = "";
  const uuid = /^[0-9a-f-]{36}$/i;
  if (opts.logId && uuid.test(opts.logId)) {
    const { data: lg } = await admin
      .from("guide_access_logs")
      .select("guest_name")
      .eq("id", opts.logId)
      .maybeSingle();
    guest = ((lg as { guest_name?: string | null } | null)?.guest_name ?? "").trim();
  }
  if (!guest && opts.reservationId && uuid.test(opts.reservationId)) {
    const { data: rs } = await admin
      .from("property_reservations")
      .select("guest_hint")
      .eq("id", opts.reservationId)
      .maybeSingle();
    guest = ((rs as { guest_hint?: string | null } | null)?.guest_hint ?? "").trim();
  }

  const name = (prop.name || "Residência").trim();
  return sendOpsPush(admin, {
    ownerId: prop.owner_id,
    kind: `staff-${opts.kind}`,
    dedupeKey: arrivalPushDedupeKey(opts.kind, opts.stayKey),
    userIds,
    payload: {
      title: arrivalStepTitle(opts.kind, { who }),
      body: arrivalStepBody(name, guest),
      data: { url: arrivalPushUrl(opts.kind), tag: `arrival-step-${opts.kind}-${opts.stayKey}`, propertyId: opts.propertyId },
    },
  });
}
