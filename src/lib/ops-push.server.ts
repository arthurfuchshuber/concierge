// Server-only: notificações push operacionais (check-ins / check-outs).
// Importar somente dentro de handlers (server routes / server functions).

import type { SupabaseClient } from "@supabase/supabase-js";
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

export function localNow(now = new Date()): LocalNow {
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

export function addDays(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
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
export async function getAccountNotifiableUsers(admin: Admin, ownerId: string): Promise<string[]> {
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
 * Envia um push operacional a uma conta, garantindo unicidade via `dedupe_key`.
 * Se a chave já existir no log, nada é enviado.
 */
export async function sendOpsPush(
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

  const userIds = opts.userIds ?? (await getAccountNotifiableUsers(admin, opts.ownerId));
  if (userIds.length === 0) return { sent: 0, skipped: false };


  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("user_id", userIds)
    .eq("enabled", true);
  if (!subs || subs.length === 0) return { sent: 0, skipped: false };

  const res = await sendPushToSubscriptions(
    subs.map((s) => ({
      id: s.id as string,
      endpoint: s.endpoint as string,
      p256dh: s.p256dh as string,
      auth: s.auth as string,
    })),
    opts.payload,
  );
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
  checkout_time: string | null;
};

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * Monta o corpo da notificação agrupado por cidade:
 *   "2 em Foz do Iguaçu\n1 em Praia do Peró"
 * Quando não há cidade cadastrada, usa o nome do imóvel como fallback.
 */
function bodyByCity(counts: Map<string, number>, suffix: string): string {
  const lines = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([city, n]) => `${n} em ${city}`);
  return lines.length > 0 ? `${lines.join("\n")}${suffix ? `\n${suffix}` : ""}` : suffix;
}


/**
 * Varredura operacional. Deve rodar a cada 30 minutos.
 * A fonte de verdade é EXATAMENTE a mesma esteira (Kanban) do dashboard:
 * usamos `buildArrivalRows` e consideramos apenas os cards pendentes.
 * Regras:
 *  1. 20h — quantos check-outs ocorrem amanhã
 *  2. 07h — quantos check-ins ocorrem hoje
 *  3. a cada 30min — check-outs atrasados (passou do horário oficial, sem "check")
 *  4. a cada 1h após o horário de check-in — check-ins ainda pendentes
 *  5. atraso grave (check-out +2h / check-in +3h) vira alerta crítico — e nesse
 *     caso o aviso "normal" correspondente NÃO é enviado (evita push duplicado).
 */
export async function runOpsPushScan(admin: Admin, now = new Date()) {
  const t = localNow(now);
  const today = t.date;
  const { buildArrivalRows } = await import("@/lib/arrival-board.server");

  const { data: propsRaw } = await admin
    .from("properties")
    .select("id, owner_id, name, city, checkin_time, checkout_time")
    .eq("published", true);
  const props = (propsRaw ?? []) as PropRow[];
  if (props.length === 0) return { ownersNotified: 0, notifications: 0 };

  const propsByOwner = new Map<string, PropRow[]>();
  for (const p of props) {
    const arr = propsByOwner.get(p.owner_id) ?? [];
    arr.push(p);
    propsByOwner.set(p.owner_id, arr);
  }

  const slot30 = `${t.date}-${String(t.hour).padStart(2, "0")}${t.minute < 30 ? "00" : "30"}`;
  const slotHour = `${t.date}-${String(t.hour).padStart(2, "0")}`;
  const url = "/admin/dashboard";
  const nowMs = now.getTime();

  let notifications = 0;
  const owners = new Set<string>();

  for (const [ownerId, ownerProps] of propsByOwner) {
    const propById = new Map(ownerProps.map((p) => [p.id, p]));
    const propIds = ownerProps.map((p) => p.id);

    const fire = async (kind: string, dedupeKey: string, payload: PushPayload) => {
      const r = await sendOpsPush(admin, { ownerId, kind, dedupeKey, payload });
      if (!r.skipped) {
        notifications++;
        owners.add(ownerId);
      }
    };

    const needTomorrow = t.hour === 20;
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
    const nameOf = (propertyId: string, fallback: string | null) =>
      (propById.get(propertyId)?.name || fallback || "Imóvel").trim();
    /** Card silenciado pelo usuário no Kanban (só afeta alertas de atraso). */
    const isMuted = (r: { mutedUntil: string | null }) =>
      !!r.mutedUntil && new Date(r.mutedUntil).getTime() > nowMs;
    const tally = (map: Map<string, number>, city: string) => map.set(city, (map.get(city) ?? 0) + 1);

    // 1. 20h — check-outs de amanhã (mesma lista do Kanban, filtro "Amanhã")
    const tomorrowRows = checkoutTomorrow.rows.filter((r) => r.status === "pending");
    const checkoutsTomorrow = tomorrowRows.length;
    if (needTomorrow && checkoutsTomorrow > 0) {
      const byCity = new Map<string, number>();
      for (const r of tomorrowRows) tally(byCity, cityOf(r.propertyId, r.propertyName));
      await fire("checkouts-tomorrow", `checkouts-tomorrow:${ownerId}:${today}`, {
        title: `Amanhã: ${checkoutsTomorrow} ${plural(checkoutsTomorrow, "check-out", "check-outs")}`,
        body: bodyByCity(byCity, "Prepare a equipe."),
        data: { url, tag: "ops-checkouts-tomorrow" },
      });
    }

    // 2. 07h — check-ins de hoje
    const checkinTodayRows = pendingCheckins.filter((r) => r.date === today);
    const checkinsToday = checkinTodayRows.length;
    if (t.hour === 7 && checkinsToday > 0) {
      const byCity = new Map<string, number>();
      for (const r of checkinTodayRows) tally(byCity, cityOf(r.propertyId, r.propertyName));
      await fire("checkins-today", `checkins-today:${ownerId}:${today}`, {
        title: `Hoje: ${checkinsToday} ${plural(checkinsToday, "check-in", "check-ins")}`,
        body: bodyByCity(byCity, "Confira a esteira de chegadas."),
        data: { url, tag: "ops-checkins-today" },
      });
    }

    // ----- atrasos (com base nos cards pendentes da esteira) -----
    const lateCheckoutNames: string[] = [];
    const lateCheckoutsByCity = new Map<string, number>();
    const criticalCheckoutsByCity = new Map<string, number>();
    let lateCheckouts = 0;
    let criticalCheckouts = 0;
    for (const r of pendingCheckouts) {
      if (r.date > today) continue;
      if (isMuted(r)) continue;
      const p = propById.get(r.propertyId);
      const limit = timeToMinutes(r.standardTime ?? p?.checkout_time ?? null, DEFAULT_CHECKOUT);
      const lateBy = r.date < today ? 24 * 60 : t.minutes - limit;
      if (lateBy <= 0) continue;
      lateCheckouts++;
      const city = cityOf(r.propertyId, r.propertyName);
      tally(lateCheckoutsByCity, city);
      if (lateCheckoutNames.length < 3) lateCheckoutNames.push(nameOf(r.propertyId, r.propertyName));
      if (lateBy >= 120) {
        criticalCheckouts++;
        tally(criticalCheckoutsByCity, city);
      }
    }

    const pendingCheckinNames: string[] = [];
    const lateCheckinsByCity = new Map<string, number>();
    const criticalCheckinsByCity = new Map<string, number>();
    let latePendingCheckins = 0;
    let criticalCheckins = 0;
    for (const r of pendingCheckins) {
      if (r.date > today) continue;
      if (isMuted(r)) continue;
      const p = propById.get(r.propertyId);
      const limit = timeToMinutes(
        r.arrivalTimeOverride ?? r.guestArrivalTime ?? r.standardTime ?? p?.checkin_time ?? null,
        DEFAULT_CHECKIN,
      );
      const lateBy = r.date < today ? 24 * 60 : t.minutes - limit;
      if (lateBy <= 0) continue;
      latePendingCheckins++;
      const city = cityOf(r.propertyId, r.propertyName);
      tally(lateCheckinsByCity, city);
      if (pendingCheckinNames.length < 3) pendingCheckinNames.push(nameOf(r.propertyId, r.propertyName));
      if (lateBy >= 180) {
        criticalCheckins++;
        tally(criticalCheckinsByCity, city);
      }
    }

    // 5. alerta crítico (vermelho) — substitui os avisos normais correspondentes
    const critical = criticalCheckouts + criticalCheckins;
    if (critical > 0) {
      const titulo =
        criticalCheckouts > 0 && criticalCheckins > 0
          ? `🔴 ${critical} ${plural(critical, "atraso crítico", "atrasos críticos")}`
          : criticalCheckouts > 0
            ? `🔴 ${criticalCheckouts} ${plural(criticalCheckouts, "Check-out atrasado", "Check-outs atrasados")}`
            : `🔴 ${criticalCheckins} ${plural(criticalCheckins, "Check-in atrasado", "Check-ins atrasados")}`;
      const byCity = new Map<string, number>();
      for (const [c, n] of criticalCheckoutsByCity) byCity.set(c, (byCity.get(c) ?? 0) + n);
      for (const [c, n] of criticalCheckinsByCity) byCity.set(c, (byCity.get(c) ?? 0) + n);
      await fire("ops-critical", `ops-critical:${ownerId}:${slot30}`, {
        title: titulo,
        body: bodyByCity(byCity, "Ação imediata recomendada."),
        data: { url, tag: "ops-critical", urgency: "high", critical: true },
      });
    }

    // 3. a cada 30min — check-outs atrasados (só se não houver crítico de saída)
    if (lateCheckouts > 0 && criticalCheckouts === 0) {
      await fire("checkouts-late", `checkouts-late:${ownerId}:${slot30}`, {
        title: `${lateCheckouts} ${plural(lateCheckouts, "Check-out atrasado", "Check-outs atrasados")}`,
        body: bodyByCity(lateCheckoutsByCity, "Sem confirmação de saída."),
        data: { url, tag: "ops-checkouts-late" },
      });
    }

    // 4. a cada 1h — check-ins pendentes (só se não houver crítico de chegada)
    if (latePendingCheckins > 0 && criticalCheckins === 0 && t.minute < 30) {
      await fire("checkins-pending", `checkins-pending:${ownerId}:${slotHour}`, {
        title: `${latePendingCheckins} ${plural(latePendingCheckins, "Check-in pendente", "Check-ins pendentes")}`,
        body: bodyByCity(lateCheckinsByCity, "Sem confirmação de entrada."),
        data: { url, tag: "ops-checkins-pending" },
      });
    }
  }


  return {
    ownersNotified: owners.size,
    notifications,
    localTime: `${today} ${fmtTime(t.minutes)}`,
  };
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

  const guest = opts.guestName?.trim() || "Um hóspede";
  const preview = (opts.firstMessage ?? "").trim().slice(0, 140);
  return sendOpsPush(admin, {
    ownerId: prop.owner_id as string,
    kind: "conversation-started",
    dedupeKey: `conversation-started:${opts.conversationId}`,
    payload: {
      title: `${guest} iniciou uma conversa`,
      body: preview
        ? `${opts.propertyName ? `${opts.propertyName}: ` : ""}“${preview}”`
        : `${opts.propertyName ?? "Imóvel"} — nova conversa com a IA.`,
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
    .select("id, owner_id, name, city, address, owner_contact_id")
    .eq("id", propertyId)
    .maybeSingle();
  const prop = data as
    | {
        id: string;
        owner_id: string;
        name: string | null;
        city: string | null;
        address: string | null;
        owner_contact_id: string | null;
      }
    | null;
  if (!prop) return null;

  let ownerName = "";
  let district = "";
  if (prop.owner_contact_id) {
    const { data: oc } = await admin
      .from("property_owners")
      .select("name, trade_name, district")
      .eq("id", prop.owner_contact_id)
      .maybeSingle();
    ownerName = ((oc?.trade_name as string) || (oc?.name as string) || "").trim();
    district = ((oc?.district as string) || "").trim();
  }

  return {
    ...prop,
    cityClean: cleanCity(prop.city),
    ownerName,
    district,
  };
}

/** "Proprietário · Imóvel · Cidade · Bairro" (só o que existir). */
function locLine(parts: (string | null | undefined)[]): string {
  return parts.map((p) => (p ?? "").trim()).filter(Boolean).join(" · ");
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
  const local = prop.city ? ` · ${prop.city}` : "";
  return sendOpsPush(admin, {
    ownerId: prop.owner_id,
    kind: "cleaning-ready",
    dedupeKey: `cleaning-ready:${opts.propertyId}:${opts.refKey}`,
    userIds: targets,
    payload: {
      title: `🧹 Liberado para limpeza — ${name}`,
      body: `Check-out confirmado${local}.${opts.guestName ? ` Hóspede: ${opts.guestName}.` : ""}\nA residência já pode receber a limpeza.`,
      data: {
        url: "/admin/dashboard",
        tag: `cleaning-ready-${opts.propertyId}`,
        style: "cleaning-ready",
        propertyId: opts.propertyId,
      },
    },
  });
}

/** Limpeza finalizada → avisa a equipe do anfitrião (owner + membros ativos). */
export async function notifyCleaningDone(
  admin: Admin,
  opts: { propertyId: string; refKey: string; byUserId?: string | null },
) {
  const prop = await getPropertyBasics(admin, opts.propertyId);
  if (!prop) return { sent: 0, skipped: true };

  let who = "";
  if (opts.byUserId) {
    const { data: provider } = await admin
      .from("service_providers")
      .select("name, trade_name")
      .eq("member_user_id", opts.byUserId)
      .maybeSingle();
    const label = (provider?.trade_name as string) || (provider?.name as string) || "";
    if (label) who = ` por ${label}`;
  }

  const name = (prop.name || "Residência").trim();
  const local = prop.city ? ` · ${prop.city}` : "";
  return sendOpsPush(admin, {
    ownerId: prop.owner_id,
    kind: "cleaning-done",
    dedupeKey: `cleaning-done:${opts.propertyId}:${opts.refKey}`,
    payload: {
      title: `✨ Limpeza finalizada — ${name}`,
      body: `Residência pronta${local}.${who ? ` Concluída${who}.` : ""}\nDisponível para a próxima chegada.`,
      data: {
        url: "/admin/dashboard",
        tag: `cleaning-done-${opts.propertyId}`,
        style: "cleaning-done",
        propertyId: opts.propertyId,
      },
    },
  });
}
