import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// ----- helpers -----

function todayISO(): string {
  // Operational day follows the properties' business timezone. Near midnight
  // UTC this avoids showing tomorrow's iCal reservations as "today" in Brazil.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}
function nowHHMMSaoPaulo(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${pick("hour")}:${pick("minute")}`;
}
function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

const ScopeInput = z.object({ ownerId: z.string().uuid().nullable().optional() }).optional();

function isPlaceholderGuest(name: string | null | undefined): boolean {
  return (name ?? "").trim().toLowerCase() === "hóspede pendente";
}

function isRealReservation(row: { status?: string | null; raw_summary?: string | null }): boolean {
  const status = (row.status ?? "").toLowerCase();
  const summary = (row.raw_summary ?? "").toLowerCase();
  if (status.includes("cancel")) return false;
  if (status.includes("block")) return false;
  if (summary.includes("not available") || summary.includes("unavailable") || summary.includes("bloqueado"))
    return false;
  return true;
}

async function accessiblePropertyIds(
  supabase: {
    from: (t: string) => unknown;
  },
  ownerId?: string | null,
): Promise<string[]> {
  // RLS on properties already scopes to owner + active account members.
  const query = (
    supabase as unknown as {
      from: (t: string) => {
        select: (s: string) => {
          eq: (c: string, v: string) => Promise<{ data: Array<{ id: string }> | null }>;
        } & Promise<{ data: Array<{ id: string }> | null }>;
      };
    }
  )
    .from("properties")
    .select("id");
  const { data } = ownerId ? await query.eq("owner_id", ownerId) : await query;
  return (data ?? []).map((r) => r.id);
}

// ----- KPIs -----

export const getDashboardKpis = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ScopeInput.parse(i) ?? {})
  .handler(async ({ data, context }) => {
    const propIds = await accessiblePropertyIds(context.supabase as never, data.ownerId ?? null);
    if (propIds.length === 0) {
      return { checkinsToday: 0, checkinsTomorrow: 0, checkoutsToday: 0, checkoutsTomorrow: 0 };
    }
    const today = todayISO();
    const tomorrow = addDaysISO(today, 1);
    // "Hoje" = tudo que ainda está pendente até hoje (inclui atrasados dos últimos 30 dias).
    const overdueFrom = "1970-01-01";

    const [{ data: props }, { data: logs }, { data: reservations }, { data: statuses }] = await Promise.all([
      context.supabase.from("properties").select("id, airbnb_ical_url").in("id", propIds),
      context.supabase
        .from("guide_access_logs")
        .select("id, property_id, guest_name, checkin_date, checkout_date")
        .in("property_id", propIds)
        .or(
          `and(checkin_date.gte.${overdueFrom},checkin_date.lte.${tomorrow}),and(checkout_date.gte.${overdueFrom},checkout_date.lte.${tomorrow})`,
        )
        .limit(2000),
      context.supabase
        .from("property_reservations")
        .select("id, property_id, checkin_date, checkout_date, status, raw_summary")
        .in("property_id", propIds)
        .eq("source", "airbnb")
        .or(
          `and(checkin_date.gte.${overdueFrom},checkin_date.lte.${tomorrow}),and(checkout_date.gte.${overdueFrom},checkout_date.lte.${tomorrow})`,
        )
        .limit(5000),
      context.supabase
        .from("guest_arrival_status")
        .select("log_id, reservation_id, kind, status")
        .in("property_id", propIds)
        .limit(5000),
    ]);

    type LogRow = {
      id: string;
      property_id: string;
      guest_name: string;
      checkin_date: string;
      checkout_date: string | null;
    };
    type ResRow = {
      id: string;
      property_id: string;
      checkin_date: string;
      checkout_date: string;
      status: string | null;
      raw_summary: string | null;
    };
    type StatusRow = {
      log_id: string | null;
      reservation_id: string | null;
      kind: "checkin" | "checkout";
      status: "pending" | "done";
    };
    const icalProps = new Set(
      ((props ?? []) as Array<{ id: string; airbnb_ical_url: string | null }>)
        .filter((p) => !!p.airbnb_ical_url?.trim())
        .map((p) => p.id),
    );
    const logRows = (logs ?? []) as LogRow[];
    const resRows = (reservations ?? []) as ResRow[];
    const doneLog = new Set<string>();
    const doneRes = new Set<string>();
    const touchedLog = new Set<string>();
    const touchedRes = new Set<string>();
    for (const s of (statuses ?? []) as StatusRow[]) {
      if (s.log_id) touchedLog.add(`${s.kind}|${s.log_id}`);
      if (s.reservation_id) touchedRes.add(`${s.kind}|${s.reservation_id}`);
      if (s.status !== "done") continue;
      if (s.log_id) doneLog.add(`${s.kind}|${s.log_id}`);
      if (s.reservation_id) doneRes.add(`${s.kind}|${s.reservation_id}`);
    }

    function countFor(col: "checkin_date" | "checkout_date", from: string, to: string) {
      const kind: "checkin" | "checkout" = col === "checkin_date" ? "checkin" : "checkout";
      const seen = new Set<string>();
      for (const r of resRows) {
        if (r[col] < from || r[col] > to) continue;
        if (!icalProps.has(r.property_id) || !isRealReservation(r)) continue;
        if (doneRes.has(`${kind}|${r.id}`)) continue;
        // Datas passadas só contam se já houve interação registrada.
        if (r[col] < today && !touchedRes.has(`${kind}|${r.id}`)) continue;
        seen.add(`ical|${r.id}`);
      }
      for (const row of logRows) {
        const v = row[col];
        if (!v || v < from || v > to) continue;
        if (icalProps.has(row.property_id) || isPlaceholderGuest(row.guest_name)) continue;
        if (doneLog.has(`${kind}|${row.id}`)) continue;
        if (v < today && !touchedLog.has(`${kind}|${row.id}`)) continue;
        seen.add(`log|${row.property_id}|${(row.guest_name || "").trim().toLowerCase()}|${v}`);
      }
      return seen.size;
    }

    return {
      checkinsToday: countFor("checkin_date", overdueFrom, today),
      checkinsTomorrow: countFor("checkin_date", tomorrow, tomorrow),
      checkoutsToday: countFor("checkout_date", overdueFrom, today),
      checkoutsTomorrow: countFor("checkout_date", tomorrow, tomorrow),
    };
  });

// ----- Engagement -----

const EngagementInput = z.object({
  range: z.enum(["today", "7d", "30d"]).default("today"),
});

export const getGuideEngagement = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => EngagementInput.merge(ScopeInput.unwrap()).parse(i))
  .handler(async ({ data, context }) => {
    const propIds = await accessiblePropertyIds(context.supabase as never, data.ownerId ?? null);
    if (propIds.length === 0) {
      return { guideOpens: 0, checkinTabOpens: 0, checkinsInPeriod: 0 };
    }
    const today = todayISO();
    let from = today;
    let to = today;
    if (data.range === "7d") {
      from = today;
      to = addDaysISO(today, 6);
    } else if (data.range === "30d") {
      from = today;
      to = addDaysISO(today, 29);
    }
    const [{ data: props }, { data: reservations }, { data: logs }] = await Promise.all([
      context.supabase.from("properties").select("id, airbnb_ical_url").in("id", propIds),
      context.supabase
        .from("property_reservations")
        .select("id, property_id, checkin_date, checkout_date, status, raw_summary")
        .in("property_id", propIds)
        .eq("source", "airbnb")
        .gte("checkin_date", from)
        .lte("checkin_date", to)
        .limit(5000),
      context.supabase
        .from("guide_access_logs")
        .select("id, property_id, guest_name, guest_phone, checkin_date")
        .in("property_id", propIds)
        .gte("checkin_date", from)
        .lte("checkin_date", to)
        .limit(2000),
    ]);

    const icalProps = new Set(
      ((props ?? []) as Array<{ id: string; airbnb_ical_url: string | null }>)
        .filter((p) => !!p.airbnb_ical_url?.trim())
        .map((p) => p.id),
    );

    const dedupKey = (r: {
      property_id: string;
      guest_name?: string | null;
      guest_phone?: string | null;
      checkin_date?: string | null;
    }) =>
      `${r.property_id}|${(r.guest_name || "").trim().toLowerCase()}|${(r.guest_phone || "").replace(/\D/g, "")}|${r.checkin_date ?? ""}`;

    const guests = new Set<string>();
    for (const row of logs ?? []) {
      const r = row as { property_id: string; guest_name: string | null; guest_phone: string | null };
      if (isPlaceholderGuest(r.guest_name)) continue;
      guests.add(dedupKey(r));
    }
    const icalCheckins = new Set<string>();
    for (const r of (reservations ?? []) as Array<{
      id: string;
      property_id: string;
      status: string | null;
      raw_summary: string | null;
    }>) {
      if (!icalProps.has(r.property_id) || !isRealReservation(r)) continue;
      icalCheckins.add(r.id);
    }
    const fallbackLogs = new Set<string>();
    for (const row of logs ?? []) {
      const r = row as { property_id: string; guest_name: string | null; guest_phone: string | null };
      if (icalProps.has(r.property_id) || isPlaceholderGuest(r.guest_name)) continue;
      fallbackLogs.add(dedupKey(r));
    }
    const checkinsInPeriod = icalCheckins.size + fallbackLogs.size;
    // Every filled log implies a guide open — the form is the entry point.
    const guideOpens = guests.size;

    // Check-in tab opens: count events registered in the window (created_at).
    const fromTs = `${from}T00:00:00.000Z`;
    const toTs = `${addDaysISO(to, 1)}T00:00:00.000Z`;
    const { data: evs } = await context.supabase
      .from("guide_section_events")
      .select("id")
      .in("property_id", propIds)
      .eq("section", "checkin")
      .gte("created_at", fromTs)
      .lt("created_at", toTs)
      .limit(5000);
    const checkinTabOpens = (evs ?? []).length;

    return { guideOpens, checkinTabOpens, checkinsInPeriod };
  });

// ----- Arrivals list -----

const ListInput = z.object({
  kind: z.enum(["checkin", "checkout"]).default("checkin"),
  range: z.enum(["today", "tomorrow", "7d", "all"]).default("today"),
  ownerId: z.string().uuid().nullable().optional(),
});

export type ArrivalRow = {
  logId: string;
  reservationId: string | null;
  propertyId: string;
  propertyName: string | null;
  propertyAddress: string | null;
  mapsUrl: string | null;
  garageMapsUrl: string | null;
  hasPasswords: boolean;
  openedCheckin: boolean;
  viewedPasswords: boolean;
  guestName: string;
  guestPhone: string | null;
  guestPhoneCountry: string | null;
  guestArrivalTime: string | null; // HH:mm informado pelo hóspede
  standardTime: string | null; // horário padrão da propriedade
  standardTimeMax: string | null;
  date: string; // data prevista (checkin ou checkout)
  guestCheckin: string;
  guestCheckout: string | null;
  reservationCode: string | null;
  createdAt: string;
  status: "pending" | "done";
  note: string | null;
  arrivalTimeOverride: string | null;
  doneAt: string | null;
  pendingFill: boolean; // true = reserva iCal sem formulário preenchido
  ical: { hasIcal: boolean; matched: boolean; icalCheckin: string | null; icalCheckout: string | null };
};

export const listDashboardArrivals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ListInput.parse(i))
  .handler(async ({ data, context }): Promise<{ rows: ArrivalRow[] }> => {
    const propIds = await accessiblePropertyIds(context.supabase as never, data.ownerId ?? null);
    if (propIds.length === 0) return { rows: [] };

    const dateCol = data.kind === "checkin" ? "checkin_date" : "checkout_date";
    const today = todayISO();
    let from: string | null = today;
    let to: string | null = today;
    if (data.range === "tomorrow") {
      from = addDaysISO(today, 1);
      to = from;
    } else if (data.range === "7d") {
      from = today;
      to = addDaysISO(today, 6);
    } else if (data.range === "all") {
      from = today;
      to = null;
    }
    // Para o filtro "Hoje", trazemos todos os atrasados (sem limite) para que
    // cards pendentes anteriores continuem visíveis com alerta.
    if (data.range === "today") {
      from = "1970-01-01";
    }

    if (data.kind === "checkin" && data.range === "today") {
      const { data: syncProps } = await context.supabase
        .from("properties")
        .select("id, airbnb_ical_url, airbnb_ical_last_sync_at")
        .in("id", propIds)
        .not("airbnb_ical_url", "is", null);
      const staleIcalProps = (
        (syncProps ?? []) as Array<{
          id: string;
          airbnb_ical_url: string | null;
          airbnb_ical_last_sync_at: string | null;
        }>
      )
        .filter((p) => {
          const url = p.airbnb_ical_url?.trim();
          if (!url) return false;
          if (!p.airbnb_ical_last_sync_at) return true;
          return Date.now() - new Date(p.airbnb_ical_last_sync_at).getTime() > 10 * 60 * 1000;
        })
        .slice(0, 8);
      if (staleIcalProps.length > 0) {
        const { isAllowedIcalUrl } = await import("@/lib/airbnb-ical-url");
        const { syncPropertyIcal } = await import("@/lib/airbnb-ical.server");
        await Promise.allSettled(
          staleIcalProps.map((p) => {
            const url = p.airbnb_ical_url?.trim();
            return url && isAllowedIcalUrl(url) ? syncPropertyIcal(p.id, url) : Promise.resolve(null);
          }),
        );
      }
    }

    let q = context.supabase
      .from("guide_access_logs")
      .select(
        "id, property_id, guest_name, guest_phone, guest_phone_country, guest_arrival_time, checkin_date, checkout_date, reservation_code, created_at",
      )
      .in("property_id", propIds)
      .gte(dateCol, from!);
    if (to) q = q.lte(dateCol, to);
    const { data: logs } = await q.order(dateCol, { ascending: true }).limit(500);

    const rawLogs = (logs ?? []) as Array<{
      id: string;
      property_id: string;
      guest_name: string;
      guest_phone: string | null;
      guest_phone_country: string | null;
      guest_arrival_time: string | null;
      checkin_date: string;
      checkout_date: string | null;
      reservation_code: string | null;
      created_at: string;
    }>;
    const placeholderLogs = rawLogs.filter((l) => isPlaceholderGuest(l.guest_name));
    const formLogs = rawLogs.filter((l) => !isPlaceholderGuest(l.guest_name));
    // Dedupe only truly repeated form submissions for the same stay. Never merge
    // adjacent back-to-back reservations in the same unit: checkout is part of
    // the identity, because one guest can leave on the same day another enters.
    const dedupMap = new Map<string, (typeof rawLogs)[number]>();
    for (const l of formLogs) {
      const key = `${l.property_id}|${(l.guest_name || "").trim().toLowerCase()}|${(l.guest_phone || "").replace(/\D/g, "")}|${l.checkin_date}|${l.checkout_date ?? ""}|${l.reservation_code ?? ""}`;
      const prev = dedupMap.get(key);
      if (!prev || new Date(l.created_at) > new Date(prev.created_at)) dedupMap.set(key, l);
    }
    const uniqueLogs = Array.from(dedupMap.values());

    const [{ data: props }, { data: statuses }, { data: reservations }, { data: sectionEvents }] = await Promise.all([
      context.supabase
        .from("properties")
        .select(
          "id, name, address, maps_url, garage_maps_url, wifi_password, lock_code, gate_code, checkin_time, checkin_time_max, checkout_time, checkout_time_min, airbnb_ical_url",
        )
        .in("id", propIds),
      context.supabase
        .from("guest_arrival_status")
        .select("log_id, reservation_id, kind, status, note, arrival_time_override, done_at, concluded_at")
        .in("property_id", propIds)
        .limit(5000),
      context.supabase
        .from("property_reservations")
        .select(
          "id, property_id, checkin_date, checkout_date, raw_summary, guest_hint, reservation_url, status, synced_at",
        )
        .in("property_id", propIds)
        .eq("source", "airbnb")
        .limit(5000),
      uniqueLogs.length > 0
        ? context.supabase
            .from("guide_section_events")
            .select("property_id, section, guest_name, guest_phone")
            .in("property_id", propIds)
            .in("section", ["checkin", "senhas"])
            .limit(5000)
        : Promise.resolve({
            data: [] as Array<{
              property_id: string;
              section: string;
              guest_name: string | null;
              guest_phone: string | null;
            }>,
          }),
    ]);

    const propMap = new Map<
      string,
      {
        name: string | null;
        address: string | null;
        maps_url: string | null;
        garage_maps_url: string | null;
        hasPasswords: boolean;
        checkin_time: string | null;
        checkin_time_max: string | null;
        checkout_time: string | null;
        checkout_time_min: string | null;
        airbnb_ical_url: string | null;
      }
    >();
    for (const p of (props ?? []) as Array<{
      id: string;
      name: string | null;
      address: string | null;
      maps_url: string | null;
      garage_maps_url: string | null;
      wifi_password: string | null;
      lock_code: string | null;
      gate_code: string | null;
      checkin_time: string | null;
      checkin_time_max: string | null;
      checkout_time: string | null;
      checkout_time_min: string | null;
      airbnb_ical_url: string | null;
    }>) {
      propMap.set(p.id, {
        name: p.name,
        address: p.address,
        maps_url: p.maps_url,
        garage_maps_url: p.garage_maps_url,
        hasPasswords: !!(p.wifi_password || p.lock_code || p.gate_code),
        checkin_time: p.checkin_time,
        checkin_time_max: p.checkin_time_max,
        checkout_time: p.checkout_time,
        checkout_time_min: p.checkout_time_min,
        airbnb_ical_url: p.airbnb_ical_url,
      });
    }

    // Index section events by property_id + normalized guest identity
    const eventKey = (pid: string, name: string | null, phone: string | null) =>
      `${pid}|${(name || "").trim().toLowerCase()}|${(phone || "").replace(/\D/g, "")}`;
    const openedCheckinSet = new Set<string>();
    const viewedPasswordsSet = new Set<string>();
    for (const ev of (sectionEvents ?? []) as Array<{
      property_id: string;
      section: string;
      guest_name: string | null;
      guest_phone: string | null;
    }>) {
      const k = eventKey(ev.property_id, ev.guest_name, ev.guest_phone);
      if (ev.section === "checkin") openedCheckinSet.add(k);
      else if (ev.section === "senhas") viewedPasswordsSet.add(k);
    }

    type StatusRow = {
      log_id: string | null;
      reservation_id: string | null;
      kind: "checkin" | "checkout";
      status: "pending" | "done";
      note: string | null;
      arrival_time_override: string | null;
      done_at: string | null;
      concluded_at: string | null;
    };
    const statusMap = new Map<string, Omit<StatusRow, "log_id" | "reservation_id">>();
    const reservationStatusMap = new Map<string, Omit<StatusRow, "log_id" | "reservation_id">>();
    // Regra da esteira: um card só pode existir em UMA coluna por vez.
    // Para saber se um checkout já pode "entrar" (Checkouts/Em Limpeza) precisamos
    // conhecer o status do check-in correspondente — se check-in ainda não foi
    // marcado como feito, o card fica retido em Check-ins (mesmo atrasado).
    const checkinDoneLogs = new Set<string>();
    const checkinDoneReservations = new Set<string>();
    for (const s of (statuses ?? []) as StatusRow[]) {
      if (s.kind === "checkin" && (s.status === "done" || !!s.done_at)) {
        if (s.log_id) checkinDoneLogs.add(s.log_id);
        if (s.reservation_id) checkinDoneReservations.add(s.reservation_id);
      }
      if (s.kind !== data.kind) continue;
      const value = {
        kind: s.kind,
        status: s.status,
        note: s.note,
        arrival_time_override: s.arrival_time_override,
        done_at: s.done_at,
        concluded_at: s.concluded_at,
      };
      if (s.log_id) statusMap.set(s.log_id, value);
      if (s.reservation_id) reservationStatusMap.set(s.reservation_id, value);
    }


    const placeholderStatus = new Map<
      string,
      {
        status: "pending" | "done";
        note: string | null;
        arrival_time_override: string | null;
        done_at: string | null;
        concluded_at: string | null;
      }
    >();
    const placeholderKey = (
      propertyId: string,
      checkin: string,
      checkout: string | null,
      kind: "checkin" | "checkout",
    ) => `${propertyId}|${checkin}|${checkout ?? ""}|${kind}`;
    for (const l of placeholderLogs) {
      const s = statusMap.get(l.id);
      if (!s) continue;
      placeholderStatus.set(placeholderKey(l.property_id, l.checkin_date, l.checkout_date, s.kind), s);
    }

    type ReservationRow = {
      id: string;
      property_id: string;
      checkin_date: string;
      checkout_date: string;
      raw_summary: string | null;
      guest_hint: string | null;
      reservation_url: string | null;
      status: string | null;
      synced_at: string | null;
    };
    const resByProp = new Map<
      string,
      Array<{ id: string; checkin: string; checkout: string; raw_summary: string | null; status: string | null }>
    >();
    const reservationRows = ((reservations ?? []) as ReservationRow[]).filter(isRealReservation);
    for (const r of reservationRows) {
      const arr = resByProp.get(r.property_id) ?? [];
      arr.push({
        id: r.id,
        checkin: r.checkin_date,
        checkout: r.checkout_date,
        raw_summary: r.raw_summary,
        status: r.status,
      });
      resByProp.set(r.property_id, arr);
    }

    function reservationInRange(r: ReservationRow): boolean {
      const date = data.kind === "checkin" ? r.checkin_date : r.checkout_date;
      if (date < (from ?? today)) return false;
      if (to && date > to) return false;
      return true;
    }

    function findBestLogForReservation(r: ReservationRow) {
      return (
        uniqueLogs.find(
          (l) =>
            l.property_id === r.property_id && l.checkin_date === r.checkin_date && l.checkout_date === r.checkout_date,
        ) ?? null
      );
    }

    // Auto-promoção para "Em Estadia": quando uma reserva é importada (ou
    // criada manualmente) e o período de estadia já está em andamento — ou
    // seja, a data de check-in já passou, OU é hoje mas o horário padrão de
    // entrada da propriedade já chegou — e o checkout ainda é no futuro,
    // consideramos o check-in como concluído virtualmente. Isso evita que o
    // hóspede apareça em "Check-ins" quando na verdade já está hospedado.
    const nowHM = nowHHMMSaoPaulo();
    function autoStayDone(checkinDate: string, checkoutDate: string | null, standardCheckinTime: string | null): boolean {
      if (data.kind !== "checkin") return false;
      if (!checkoutDate || checkoutDate <= today) return false; // precisa estar em estadia (checkout no futuro)
      if (checkinDate < today) return true;
      if (checkinDate === today) {
        if (!standardCheckinTime) return false;
        return nowHM >= standardCheckinTime;
      }
      return false;
    }

    function rowFromLog(
      l: (typeof uniqueLogs)[number],
      forceIcal?: { hasIcal: boolean; matched: boolean; icalCheckin: string | null; icalCheckout: string | null },
    ): ArrivalRow | null {
      const p = propMap.get(l.property_id);
      const s = statusMap.get(l.id);
      if (s?.concluded_at) return null;
      const date = data.kind === "checkin" ? l.checkin_date : (l.checkout_date ?? l.checkin_date);
      // Cards com data anterior a hoje só aparecem se houver interação registrada
      // (status row). Importações novas de datas passadas nunca criam cards.
      if (date < today && !s) return null;
      const hasIcal = !!p?.airbnb_ical_url;
      let matched = false;
      let icalCheckin: string | null = null;
      let icalCheckout: string | null = null;
      if (hasIcal) {
        const list = resByProp.get(l.property_id) ?? [];
        // Always anchor the iCal match on the log's CHECK-IN date — guests are
        // reliable about arrival, but often mistype checkout. Trying to match
        // by checkout can snap to the previous/next reservation when the guest
        // typed the wrong departure day.
        const anchor = l.checkin_date;
        const exact = list.find((r) => r.checkin === anchor);
        const near =
          exact ?? list.find((r) => r.checkin === addDaysISO(anchor, -1) || r.checkin === addDaysISO(anchor, 1));
        if (near) {
          matched = true;
          icalCheckin = near.checkin;
          icalCheckout = near.checkout;
        }
      }
      const evK = eventKey(l.property_id, l.guest_name, l.guest_phone);
      return {
        logId: l.id,
        reservationId: null,
        propertyId: l.property_id,
        propertyName: p?.name ?? null,
        propertyAddress: p?.address ?? null,
        mapsUrl: p?.maps_url ?? null,
        garageMapsUrl: p?.garage_maps_url ?? null,
        hasPasswords: !!p?.hasPasswords,
        openedCheckin: openedCheckinSet.has(evK),
        viewedPasswords: viewedPasswordsSet.has(evK),
        guestName: l.guest_name,
        guestPhone: l.guest_phone,
        guestPhoneCountry: l.guest_phone_country,
        guestArrivalTime: l.guest_arrival_time,
        standardTime: data.kind === "checkin" ? (p?.checkin_time ?? null) : (p?.checkout_time ?? null),
        standardTimeMax: data.kind === "checkin" ? (p?.checkin_time_max ?? null) : (p?.checkout_time_min ?? null),
        date,
        guestCheckin: l.checkin_date,
        guestCheckout: l.checkout_date ?? null,
        reservationCode: l.reservation_code,
        createdAt: l.created_at,
        // Segurança: check-ins com data futura NUNCA podem estar como "done" no kanban.
        // Se por engano foram marcados, voltam a aparecer como pendentes.
        status:
          data.kind === "checkin" && l.checkin_date > today && s?.status === "done"
            ? "pending"
            : s
              ? s.status
              : autoStayDone(l.checkin_date, l.checkout_date ?? null, p?.checkin_time ?? null)
                ? "done"
                : "pending",
        note: s?.note ?? null,
        arrivalTimeOverride: s?.arrival_time_override ?? null,
        doneAt: s?.done_at ?? null,
        pendingFill: false,
        ical: forceIcal ?? { hasIcal, matched, icalCheckin, icalCheckout },
      };
    }

    function rowFromReservation(r: ReservationRow, matchedLog: (typeof uniqueLogs)[number] | null): ArrivalRow | null {
      const p = propMap.get(r.property_id);
      const legacy = placeholderStatus.get(placeholderKey(r.property_id, r.checkin_date, r.checkout_date, data.kind));
      const logStatus = matchedLog ? statusMap.get(matchedLog.id) : undefined;
      const s = reservationStatusMap.get(r.id) ?? legacy ?? logStatus;
      if (s?.concluded_at) return null;
      const date = data.kind === "checkin" ? r.checkin_date : r.checkout_date;
      // Datas passadas só entram no kanban se já houver interação (status row);
      // reservas iCal recém-importadas para o passado ficam de fora.
      if (date < today && !s) return null;
      const evK = matchedLog ? eventKey(matchedLog.property_id, matchedLog.guest_name, matchedLog.guest_phone) : "";

      return {
        logId: matchedLog?.id ?? `ical:${r.id}`,
        reservationId: r.id,
        propertyId: r.property_id,
        propertyName: p?.name ?? null,
        propertyAddress: p?.address ?? null,
        mapsUrl: p?.maps_url ?? null,
        garageMapsUrl: p?.garage_maps_url ?? null,
        hasPasswords: !!p?.hasPasswords,
        openedCheckin: matchedLog ? openedCheckinSet.has(evK) : false,
        viewedPasswords: matchedLog ? viewedPasswordsSet.has(evK) : false,
        guestName: matchedLog?.guest_name ?? r.guest_hint ?? "Reserva Airbnb",
        guestPhone: matchedLog?.guest_phone ?? null,
        guestPhoneCountry: matchedLog?.guest_phone_country ?? null,
        guestArrivalTime: matchedLog?.guest_arrival_time ?? null,
        standardTime: data.kind === "checkin" ? (p?.checkin_time ?? null) : (p?.checkout_time ?? null),
        standardTimeMax: data.kind === "checkin" ? (p?.checkin_time_max ?? null) : (p?.checkout_time_min ?? null),
        date,
        guestCheckin: matchedLog?.checkin_date ?? r.checkin_date,
        guestCheckout: matchedLog?.checkout_date ?? r.checkout_date,
        reservationCode: matchedLog?.reservation_code ?? r.guest_hint ?? null,
        createdAt: matchedLog?.created_at ?? r.synced_at ?? new Date().toISOString(),
        status:
          data.kind === "checkin" && r.checkin_date > today && s?.status === "done"
            ? "pending"
            : (s?.status ?? "pending"),
        note: s?.note ?? null,
        arrivalTimeOverride: s?.arrival_time_override ?? null,
        doneAt: s?.done_at ?? null,
        pendingFill: !matchedLog,
        ical: { hasIcal: true, matched: true, icalCheckin: r.checkin_date, icalCheckout: r.checkout_date },
      };
    }

    const rows: ArrivalRow[] = [];
    const usedLogIds = new Set<string>();

    for (const r of reservationRows.filter(reservationInRange)) {
      const p = propMap.get(r.property_id);
      if (!p?.airbnb_ical_url) continue;
      const matchedLog = findBestLogForReservation(r);
      if (matchedLog) {
        usedLogIds.add(matchedLog.id);
      }
      const row = rowFromReservation(r, matchedLog);
      if (row) rows.push(row);
    }

    for (const l of uniqueLogs) {
      if (usedLogIds.has(l.id)) continue;
      const p = propMap.get(l.property_id);
      if (p?.airbnb_ical_url) continue;
      const row = rowFromLog(l);
      if (row) rows.push(row);
    }

    // Esteira: um card só pode aparecer em Checkouts/Em Limpeza depois que o
    // check-in correspondente foi marcado como feito. Enquanto o check-in
    // estiver pendente (mesmo atrasado), o card fica retido em Check-ins.
    const gatedRows =
      data.kind === "checkout"
        ? rows.filter((r) => {
            const logDone = !!(r.logId && !r.logId.startsWith("ical:") && checkinDoneLogs.has(r.logId));
            const resDone = !!(r.reservationId && checkinDoneReservations.has(r.reservationId));
            return logDone || resDone;
          })
        : rows;
    const finalRows = gatedRows;
    finalRows.length; // keep var used below
    rows.length = 0;
    rows.push(...finalRows);

    // Prioridade: data → horário previsto (override do anfitrião ou informado pelo
    // hóspede) → ordem alfabética da residência. O horário padrão da propriedade
    // NÃO entra na chave de ordenação — só o previsto/manual manda.
    const effTime = (r: ArrivalRow): string => r.arrivalTimeOverride ?? r.guestArrivalTime ?? "99:99";
    rows.sort((a, b) => {
      // Mais recente primeiro (data DESC). Empate: horário previsto DESC → residência A→Z.
      const d = b.date.localeCompare(a.date);
      if (d !== 0) return d;
      const t = effTime(b).localeCompare(effTime(a));
      if (t !== 0) return t;
      return (a.propertyName ?? "").localeCompare(b.propertyName ?? "", "pt-BR");
    });

    return { rows };
  });

// ----- Mutations -----

const UpsertInput = z
  .object({
    logId: z.string().uuid().optional(),
    reservationId: z.string().uuid().optional(),
    kind: z.enum(["checkin", "checkout"]),
    status: z.enum(["pending", "done"]).optional(),
    note: z.string().max(500).nullable().optional(),
    arrivalTimeOverride: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .nullable()
      .optional(),
  })
  .refine((v) => !!v.logId || !!v.reservationId, { message: "Informe a reserva ou o registro do hóspede." });

export const upsertArrivalStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UpsertInput.parse(i))
  .handler(async ({ data, context }) => {
    let propertyId: string | null = null;
    if (data.reservationId) {
      const { data: reservation, error: reservationErr } = await context.supabase
        .from("property_reservations")
        .select("id, property_id")
        .eq("id", data.reservationId)
        .maybeSingle();
      if (reservationErr || !reservation) throw new Error("Reserva não encontrada.");
      propertyId = (reservation as { property_id: string }).property_id;
    } else if (data.logId) {
      const { data: log, error: logErr } = await context.supabase
        .from("guide_access_logs")
        .select("id, property_id")
        .eq("id", data.logId)
        .maybeSingle();
      if (logErr || !log) throw new Error("Registro não encontrado.");
      propertyId = (log as { property_id: string }).property_id;
    }
    if (!propertyId) throw new Error("Registro não encontrado.");

    const patch: {
      log_id?: string;
      reservation_id?: string;
      property_id: string;
      kind: "checkin" | "checkout";
      status?: "pending" | "done";
      done_at?: string | null;
      note?: string | null;
      arrival_time_override?: string | null;
    } = {
      property_id: propertyId,
      kind: data.kind,
    };
    if (data.logId) patch.log_id = data.logId;
    if (data.reservationId) patch.reservation_id = data.reservationId;
    if (typeof data.status !== "undefined") {
      patch.status = data.status;
      patch.done_at = data.status === "done" ? new Date().toISOString() : null;
    }
    if (typeof data.note !== "undefined") patch.note = data.note;
    if (typeof data.arrivalTimeOverride !== "undefined") patch.arrival_time_override = data.arrivalTimeOverride;

    let existingId: string | undefined;
    if (data.reservationId) {
      const { data: existingByReservation } = await context.supabase
        .from("guest_arrival_status")
        .select("id")
        .eq("reservation_id", data.reservationId)
        .eq("kind", data.kind)
        .limit(1);
      existingId = (existingByReservation?.[0] as { id: string } | undefined)?.id;
    }
    if (!existingId && data.logId) {
      const { data: existingByLog } = await context.supabase
        .from("guest_arrival_status")
        .select("id")
        .eq("log_id", data.logId)
        .eq("kind", data.kind)
        .limit(1);
      existingId = (existingByLog?.[0] as { id: string } | undefined)?.id;
    }
    const { error } = existingId
      ? await context.supabase.from("guest_arrival_status").update(patch).eq("id", existingId)
      : await context.supabase.from("guest_arrival_status").insert(patch);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ----- Inline edit: correct stay dates on a guest access log -----

const UpdateStayDatesInput = z.object({
  logId: z.string().uuid(),
  checkinDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  checkoutDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

export const updateGuestStayDates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UpdateStayDatesInput.parse(i))
  .handler(async ({ data, context }) => {
    if (typeof data.checkinDate === "undefined" && typeof data.checkoutDate === "undefined") {
      return { ok: true };
    }
    if (data.checkinDate && data.checkoutDate && data.checkoutDate < data.checkinDate) {
      throw new Error("Data de saída não pode ser anterior à de entrada.");
    }
    const patch: { checkin_date?: string; checkout_date?: string | null } = {};
    if (typeof data.checkinDate !== "undefined") patch.checkin_date = data.checkinDate;
    if (typeof data.checkoutDate !== "undefined") patch.checkout_date = data.checkoutDate;

    const { error } = await context.supabase.from("guide_access_logs").update(patch).eq("id", data.logId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ----- Inline edit: correct arrival time on the guide access log -----

const UpdateArrivalTimeInput = z.object({
  logId: z.string().uuid(),
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable(),
});

export const updateGuestArrivalTime = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UpdateArrivalTimeInput.parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("guide_access_logs")
      .update({ guest_arrival_time: data.time })
      .eq("id", data.logId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ----- Mark a pending iCal reservation as done (no guest form yet) -----

const MarkPendingInput = z.object({
  reservationId: z.string().uuid().optional(),
  propertyId: z.string().uuid(),
  kind: z.enum(["checkin", "checkout"]),
  checkinDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkoutDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  status: z.enum(["pending", "done"]).default("done"),
});

export const markPendingReservationStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => MarkPendingInput.parse(i))
  .handler(async ({ data, context }) => {
    // Confirm the caller can access this property (RLS on properties).
    const { data: prop, error: propErr } = await context.supabase
      .from("properties")
      .select("id")
      .eq("id", data.propertyId)
      .maybeSingle();
    if (propErr || !prop) throw new Error("Propriedade não encontrada.");

    let reservationId = data.reservationId ?? null;
    if (!reservationId) {
      const query = context.supabase
        .from("property_reservations")
        .select("id")
        .eq("property_id", data.propertyId)
        .eq("checkin_date", data.checkinDate)
        .eq("source", "airbnb")
        .limit(1);
      const { data: matches } = data.checkoutDate ? await query.eq("checkout_date", data.checkoutDate) : await query;
      reservationId = (matches?.[0] as { id: string } | undefined)?.id ?? null;
    }
    if (!reservationId) throw new Error("Reserva iCal não encontrada.");

    const { data: existing } = await context.supabase
      .from("guest_arrival_status")
      .select("id")
      .eq("reservation_id", reservationId)
      .eq("kind", data.kind)
      .limit(1);
    const existingId = (existing?.[0] as { id: string } | undefined)?.id;

    const patch = {
      reservation_id: reservationId,
      property_id: data.propertyId,
      kind: data.kind,
      status: data.status,
      done_at: data.status === "done" ? new Date().toISOString() : null,
    };
    const { error: upErr } = existingId
      ? await context.supabase.from("guest_arrival_status").update(patch).eq("id", existingId)
      : await context.supabase.from("guest_arrival_status").insert(patch);
    if (upErr) throw new Error(upErr.message);
    return { ok: true, reservationId };
  });

// ----- Advance an arrival card through the funnel -----
// Funnel: Checkin -> Em Estadia -> Checkout -> Em Limpeza -> Concluído
// Given the bucket the card is currently in and its stay dates, the server
// upserts the correct status rows so late cards jump straight to the funnel
// stage that matches today's date.

const AdvanceInput = z
  .object({
    logId: z.string().uuid().optional(),
    reservationId: z.string().uuid().optional(),
    from: z.enum(["checkin", "stay", "checkout", "cleaning"]),
  })
  .refine((v) => !!v.logId || !!v.reservationId, { message: "Informe a reserva ou o registro do hóspede." });

export const advanceArrival = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => AdvanceInput.parse(i))
  .handler(async ({ data, context }) => {
    // Resolve property + stay dates from the source record.
    let propertyId: string | null = null;
    let checkinDate: string | null = null;
    let checkoutDate: string | null = null;

    if (data.logId) {
      const { data: log } = await context.supabase
        .from("guide_access_logs")
        .select("property_id, checkin_date, checkout_date")
        .eq("id", data.logId)
        .maybeSingle();
      if (log) {
        propertyId = (log as { property_id: string }).property_id;
        checkinDate = (log as { checkin_date: string }).checkin_date;
        checkoutDate = (log as { checkout_date: string | null }).checkout_date ?? null;
      }
    }
    if (!propertyId && data.reservationId) {
      const { data: res } = await context.supabase
        .from("property_reservations")
        .select("property_id, checkin_date, checkout_date")
        .eq("id", data.reservationId)
        .maybeSingle();
      if (res) {
        propertyId = (res as { property_id: string }).property_id;
        checkinDate = (res as { checkin_date: string }).checkin_date;
        checkoutDate = (res as { checkout_date: string | null }).checkout_date ?? null;
      }
    }
    if (!propertyId) throw new Error("Registro não encontrado.");

    const nowIso = new Date().toISOString();
    const today = todayISO();

    async function upsertStatus(
      kind: "checkin" | "checkout",
      patch: {
        status?: "pending" | "done";
        done_at?: string | null;
        concluded_at?: string | null;
      },
    ) {
      // Find existing row for (log|reservation, kind)
      let existingId: string | undefined;
      if (data.reservationId) {
        const { data: existing } = await context.supabase
          .from("guest_arrival_status")
          .select("id")
          .eq("reservation_id", data.reservationId)
          .eq("kind", kind)
          .limit(1);
        existingId = (existing?.[0] as { id: string } | undefined)?.id;
      }
      if (!existingId && data.logId) {
        const { data: existing } = await context.supabase
          .from("guest_arrival_status")
          .select("id")
          .eq("log_id", data.logId)
          .eq("kind", kind)
          .limit(1);
        existingId = (existing?.[0] as { id: string } | undefined)?.id;
      }

      const body: {
        property_id: string;
        kind: "checkin" | "checkout";
        log_id?: string;
        reservation_id?: string;
        status?: "pending" | "done";
        done_at?: string | null;
        concluded_at?: string | null;
      } = { property_id: propertyId!, kind, ...patch };
      if (data.logId) body.log_id = data.logId;
      if (data.reservationId) body.reservation_id = data.reservationId;

      const { error } = existingId
        ? await context.supabase.from("guest_arrival_status").update(body).eq("id", existingId)
        : await context.supabase.from("guest_arrival_status").insert(body);
      if (error) throw new Error(error.message);
    }

    // If checkout is more than 1 day past, cleaning window is over → conclude directly.
    function daysBetween(a: string, b: string) {
      const da = new Date(a + "T00:00:00Z").getTime();
      const db = new Date(b + "T00:00:00Z").getTime();
      return Math.round((da - db) / 86400000);
    }
    const cleaningStale = !!(checkoutDate && daysBetween(today, checkoutDate) > 1);

    // Bucket-aware progression.
    if (data.from === "checkin") {
      await upsertStatus("checkin", { status: "done", done_at: nowIso });
      // Só pula estadia/limpeza quando o checkout já ficou no PASSADO
      // (today > checkoutDate). Quando checkout é hoje, o hóspede ainda
      // está no imóvel — precisa aparecer em Checkouts como pendente.
      if (checkoutDate && today > checkoutDate) {
        // Guest already left → also mark checkout done and hide checkin from Estadia.
        await upsertStatus("checkout", { status: "done", done_at: nowIso });
        await upsertStatus("checkin", { concluded_at: nowIso });
        if (cleaningStale) {
          // Cleaning window (checkout + 1d) is over → go straight to Concluído.
          await upsertStatus("checkout", { concluded_at: nowIso });
        }
      }
    } else if (data.from === "stay" || data.from === "checkout") {
      await upsertStatus("checkout", { status: "done", done_at: nowIso });
      await upsertStatus("checkin", { concluded_at: nowIso });
      if (cleaningStale) {
        // Skip Em Limpeza entirely if checkout was more than 1 day ago.
        await upsertStatus("checkout", { concluded_at: nowIso });
      }
    } else if (data.from === "cleaning") {
      // Em Limpeza → conclude the stay (hidden from all kanbans).
      // status:'done' evita que um upsert-insert (sem linha prévia) grave
      // 'pending' e faça o card reaparecer em Checkouts.
      await upsertStatus("checkout", { status: "done", done_at: nowIso, concluded_at: nowIso });
      await upsertStatus("checkin", { status: "done", concluded_at: nowIso });
    }

    return { ok: true };
  });

// ----- Undo a check-advance (from destination list) -----
// Reverts a card one step back in the funnel: stay → Chegadas,
// cleaning → Saídas.
const RevertInput = z
  .object({
    logId: z.string().uuid().optional(),
    reservationId: z.string().uuid().optional(),
    from: z.enum(["stay", "cleaning"]),
  })
  .refine((v) => !!v.logId || !!v.reservationId, { message: "Informe a reserva ou o registro do hóspede." });

export const revertArrival = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => RevertInput.parse(i))
  .handler(async ({ data, context }) => {
    async function findId(kind: "checkin" | "checkout"): Promise<string | undefined> {
      if (data.reservationId) {
        const { data: r } = await context.supabase
          .from("guest_arrival_status")
          .select("id")
          .eq("reservation_id", data.reservationId)
          .eq("kind", kind)
          .limit(1);
        const id = (r?.[0] as { id: string } | undefined)?.id;
        if (id) return id;
      }
      if (data.logId) {
        const { data: r } = await context.supabase
          .from("guest_arrival_status")
          .select("id")
          .eq("log_id", data.logId)
          .eq("kind", kind)
          .limit(1);
        return (r?.[0] as { id: string } | undefined)?.id;
      }
      return undefined;
    }

    if (data.from === "stay") {
      // Back to Chegadas: undo checkin.done.
      const id = await findId("checkin");
      if (id) {
        const { error } = await context.supabase
          .from("guest_arrival_status")
          .update({ status: "pending", done_at: null, concluded_at: null })
          .eq("id", id);
        if (error) throw new Error(error.message);
      }
    } else if (data.from === "cleaning") {
      // Back to Saídas: undo checkout.done and un-conclude the checkin row
      // (which had been hidden when the checkout was marked).
      const coId = await findId("checkout");
      if (coId) {
        const { error } = await context.supabase
          .from("guest_arrival_status")
          .update({ status: "pending", done_at: null, concluded_at: null })
          .eq("id", coId);
        if (error) throw new Error(error.message);
      }
      const ciId = await findId("checkin");
      if (ciId) {
        const { error } = await context.supabase
          .from("guest_arrival_status")
          .update({ concluded_at: null })
          .eq("id", ciId);
        if (error) throw new Error(error.message);
      }
    }
    return { ok: true };
  });
