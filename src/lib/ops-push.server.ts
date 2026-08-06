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
  opts: { ownerId: string; kind: string; dedupeKey: string; payload: PushPayload },
): Promise<{ sent: number; skipped: boolean }> {
  const { error: dedupeError } = await admin.from("ops_push_log").insert({
    owner_id: opts.ownerId,
    kind: opts.kind,
    dedupe_key: opts.dedupeKey,
    payload: opts.payload as unknown as Record<string, unknown>,
  });
  // Violação de unicidade => já enviado nesta janela
  if (dedupeError) return { sent: 0, skipped: true };

  const userIds = await getAccountNotifiableUsers(admin, opts.ownerId);
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
  checkin_time: string | null;
  checkout_time: string | null;
};

type ResRow = {
  id: string;
  property_id: string;
  checkin_date: string;
  checkout_date: string;
};

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * Varredura operacional. Deve rodar a cada 30 minutos.
 * Regras:
 *  1. 20h — quantos check-outs ocorrem amanhã
 *  2. 07h — quantos check-ins ocorrem hoje
 *  3. a cada 30min — check-outs atrasados (passou do horário oficial e não foi dado "check")
 *  4. a cada 1h após o horário de check-in — check-ins ainda pendentes
 *  5. alerta crítico (vermelho) para atrasos graves (>2h no check-out, >3h no check-in)
 */
export async function runOpsPushScan(admin: Admin, now = new Date()) {
  const t = localNow(now);
  const today = t.date;
  const tomorrow = addDays(today, 1);
  const windowStart = addDays(today, -14);

  const { data: propsRaw } = await admin
    .from("properties")
    .select("id, owner_id, name, checkin_time, checkout_time")
    .eq("published", true);
  const props = (propsRaw ?? []) as PropRow[];
  if (props.length === 0) return { ownersNotified: 0, notifications: 0 };

  const propById = new Map(props.map((p) => [p.id, p]));
  const propIds = props.map((p) => p.id);

  const [{ data: resRaw }, { data: statusRaw }] = await Promise.all([
    admin
      .from("property_reservations")
      .select("id, property_id, checkin_date, checkout_date")
      .in("property_id", propIds)
      .gte("checkout_date", windowStart)
      .lte("checkin_date", tomorrow)
      .limit(10000),
    admin
      .from("guest_arrival_status")
      .select("reservation_id, kind, status, done_at")
      .in("property_id", propIds)
      .limit(10000),
  ]);

  const reservations = (resRaw ?? []) as ResRow[];
  const doneCheckin = new Set<string>();
  const doneCheckout = new Set<string>();
  for (const s of (statusRaw ?? []) as Array<{
    reservation_id: string | null;
    kind: "checkin" | "checkout";
    status: string | null;
    done_at: string | null;
  }>) {
    if (!s.reservation_id) continue;
    const isDone = s.status === "done" || !!s.done_at;
    if (!isDone) continue;
    if (s.kind === "checkin") doneCheckin.add(s.reservation_id);
    else doneCheckout.add(s.reservation_id);
  }

  type Agg = {
    checkoutsTomorrow: number;
    checkinsToday: number;
    lateCheckouts: number;
    lateCheckoutNames: string[];
    pendingCheckins: number;
    pendingCheckinNames: string[];
    criticalCheckouts: number;
    criticalCheckins: number;
  };
  const byOwner = new Map<string, Agg>();
  const agg = (ownerId: string): Agg => {
    let a = byOwner.get(ownerId);
    if (!a) {
      a = {
        checkoutsTomorrow: 0,
        checkinsToday: 0,
        lateCheckouts: 0,
        lateCheckoutNames: [],
        pendingCheckins: 0,
        pendingCheckinNames: [],
        criticalCheckouts: 0,
        criticalCheckins: 0,
      };
      byOwner.set(ownerId, a);
    }
    return a;
  };

  for (const r of reservations) {
    const p = propById.get(r.property_id);
    if (!p) continue;
    const a = agg(p.owner_id);
    const checkinMin = timeToMinutes(p.checkin_time, DEFAULT_CHECKIN);
    const checkoutMin = timeToMinutes(p.checkout_time, DEFAULT_CHECKOUT);
    const name = (p.name || "Imóvel").trim();

    if (r.checkout_date === tomorrow) a.checkoutsTomorrow++;
    if (r.checkin_date === today) a.checkinsToday++;

    // Check-out atrasado: data de saída hoje (já passou do horário) ou anterior, sem "check"
    if (!doneCheckout.has(r.id) && r.checkout_date <= today) {
      const lateBy = r.checkout_date < today ? 24 * 60 : t.minutes - checkoutMin;
      if (lateBy > 0) {
        a.lateCheckouts++;
        if (a.lateCheckoutNames.length < 3) a.lateCheckoutNames.push(name);
        if (lateBy >= 120) a.criticalCheckouts++;
      }
    }

    // Check-in pendente: entrada hoje, já passou do horário oficial, sem "check"
    if (!doneCheckin.has(r.id) && r.checkin_date === today) {
      const lateBy = t.minutes - checkinMin;
      if (lateBy > 0) {
        a.pendingCheckins++;
        if (a.pendingCheckinNames.length < 3) a.pendingCheckinNames.push(name);
        if (lateBy >= 180) a.criticalCheckins++;
      }
    }
  }

  const slot30 = `${t.date}-${String(t.hour).padStart(2, "0")}${t.minute < 30 ? "00" : "30"}`;
  const slotHour = `${t.date}-${String(t.hour).padStart(2, "0")}`;
  const url = "/admin/dashboard";

  let notifications = 0;
  const owners = new Set<string>();

  for (const [ownerId, a] of byOwner) {
    const fire = async (kind: string, dedupeKey: string, payload: PushPayload) => {
      const r = await sendOpsPush(admin, { ownerId, kind, dedupeKey, payload });
      if (!r.skipped) {
        notifications++;
        owners.add(ownerId);
      }
    };

    // 1. 20h — check-outs de amanhã
    if (t.hour === 20 && a.checkoutsTomorrow > 0) {
      await fire("checkouts-tomorrow", `checkouts-tomorrow:${ownerId}:${today}`, {
        title: `Amanhã: ${a.checkoutsTomorrow} ${plural(a.checkoutsTomorrow, "check-out", "check-outs")}`,
        body: `Prepare a equipe: ${a.checkoutsTomorrow} ${plural(a.checkoutsTomorrow, "saída prevista", "saídas previstas")} para amanhã.`,
        data: { url, tag: "ops-checkouts-tomorrow" },
      });
    }

    // 2. 07h — check-ins de hoje
    if (t.hour === 7 && a.checkinsToday > 0) {
      await fire("checkins-today", `checkins-today:${ownerId}:${today}`, {
        title: `Hoje: ${a.checkinsToday} ${plural(a.checkinsToday, "check-in", "check-ins")}`,
        body: `${a.checkinsToday} ${plural(a.checkinsToday, "chegada prevista", "chegadas previstas")} para hoje. Confira a esteira de chegadas.`,
        data: { url, tag: "ops-checkins-today" },
      });
    }

    // 3. a cada 30min — check-outs atrasados
    if (a.lateCheckouts > 0) {
      await fire("checkouts-late", `checkouts-late:${ownerId}:${slot30}`, {
        title: `${a.lateCheckouts} ${plural(a.lateCheckouts, "check-out atrasado", "check-outs atrasados")}`,
        body: `${a.lateCheckoutNames.join(", ")}${a.lateCheckouts > a.lateCheckoutNames.length ? " e outros" : ""} passaram do horário de saída sem confirmação.`,
        data: { url, tag: "ops-checkouts-late" },
      });
    }

    // 4. a cada 1h após o horário de check-in — check-ins pendentes
    if (a.pendingCheckins > 0 && t.minute < 30) {
      await fire("checkins-pending", `checkins-pending:${ownerId}:${slotHour}`, {
        title: `${a.pendingCheckins} ${plural(a.pendingCheckins, "check-in pendente", "check-ins pendentes")}`,
        body: `${a.pendingCheckinNames.join(", ")}${a.pendingCheckins > a.pendingCheckinNames.length ? " e outros" : ""} já passaram do horário de entrada sem confirmação.`,
        data: { url, tag: "ops-checkins-pending" },
      });
    }

    // 5. alerta crítico (vermelho) para atrasos graves
    const critical = a.criticalCheckouts + a.criticalCheckins;
    if (critical > 0 && t.minute < 30) {
      const partes: string[] = [];
      if (a.criticalCheckouts > 0)
        partes.push(`${a.criticalCheckouts} ${plural(a.criticalCheckouts, "check-out", "check-outs")} +2h`);
      if (a.criticalCheckins > 0)
        partes.push(`${a.criticalCheckins} ${plural(a.criticalCheckins, "check-in", "check-ins")} +3h`);
      await fire("ops-critical", `ops-critical:${ownerId}:${slotHour}`, {
        title: `🔴 Atraso crítico: ${critical} ${plural(critical, "card", "cards")}`,
        body: `${partes.join(" • ")} sem confirmação. Ação imediata recomendada.`,
        data: { url, tag: "ops-critical", urgency: "high", critical: true },
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
