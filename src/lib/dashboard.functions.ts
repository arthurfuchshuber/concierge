import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// ----- helpers -----

function todayISO(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
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
  if (summary.includes("not available") || summary.includes("unavailable") || summary.includes("bloqueado")) return false;
  return true;
}

async function accessiblePropertyIds(supabase: {
  from: (t: string) => unknown;
}, ownerId?: string | null): Promise<string[]> {
  // RLS on properties already scopes to owner + active account members.
  const query = (supabase as unknown as {
    from: (t: string) => {
      select: (s: string) => {
        eq: (c: string, v: string) => Promise<{ data: Array<{ id: string }> | null }>;
      } & Promise<{ data: Array<{ id: string }> | null }>;
    };
  })
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

    // Airbnb/iCal is the canonical operational source when connected. Guest
    // forms are only a fallback for properties without iCal to avoid inflated
    // counts from duplicate or mistyped forms.
    const [{ data: props }, { data: logs }, { data: reservations }] = await Promise.all([
      context.supabase
        .from("properties")
        .select("id, airbnb_ical_url")
        .in("id", propIds),
      context.supabase
        .from("guide_access_logs")
        .select("property_id, guest_name, checkin_date, checkout_date")
        .in("property_id", propIds)
        .or(
          `checkin_date.in.(${today},${tomorrow}),checkout_date.in.(${today},${tomorrow})`,
        )
        .limit(2000),
      context.supabase
        .from("property_reservations")
        .select("id, property_id, checkin_date, checkout_date, status, raw_summary")
        .in("property_id", propIds)
        .eq("source", "airbnb")
        .or(
          `checkin_date.in.(${today},${tomorrow}),checkout_date.in.(${today},${tomorrow})`,
        )
        .limit(5000),
    ]);

    type LogRow = { property_id: string; guest_name: string; checkin_date: string; checkout_date: string | null };
    type ResRow = { id: string; property_id: string; checkin_date: string; checkout_date: string; status: string | null; raw_summary: string | null };
    const icalProps = new Set(
      ((props ?? []) as Array<{ id: string; airbnb_ical_url: string | null }>)
        .filter((p) => !!p.airbnb_ical_url?.trim())
        .map((p) => p.id),
    );
    const logRows = (logs ?? []) as LogRow[];
    const resRows = (reservations ?? []) as ResRow[];

    function countFor(col: "checkin_date" | "checkout_date", date: string) {
      const seen = new Set<string>();
      for (const r of resRows) {
        if (r[col] !== date) continue;
        if (!icalProps.has(r.property_id) || !isRealReservation(r)) continue;
        seen.add(`ical|${r.id}`);
      }
      for (const row of logRows) {
        if (row[col] !== date) continue;
        if (icalProps.has(row.property_id) || isPlaceholderGuest(row.guest_name)) continue;
        seen.add(`log|${row.property_id}|${(row.guest_name || "").trim().toLowerCase()}|${date}`);
      }
      return seen.size;
    }

    return {
      checkinsToday: countFor("checkin_date", today),
      checkinsTomorrow: countFor("checkin_date", tomorrow),
      checkoutsToday: countFor("checkout_date", today),
      checkoutsTomorrow: countFor("checkout_date", tomorrow),
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
    // Guests with check-in in [from, to]
    const { data: logs } = await context.supabase
      .from("guide_access_logs")
      .select("id, property_id, guest_name, guest_phone, checkin_date")
      .in("property_id", propIds)
      .gte("checkin_date", from)
      .lte("checkin_date", to)
      .limit(2000);

    const dedupKey = (r: { property_id: string; guest_name?: string | null; guest_phone?: string | null }) =>
      `${r.property_id}|${(r.guest_name || "").trim().toLowerCase()}|${(r.guest_phone || "").replace(/\D/g, "")}`;

    const guests = new Set<string>();
    for (const row of logs ?? []) {
      const r = row as { property_id: string; guest_name: string | null; guest_phone: string | null };
      guests.add(dedupKey(r));
    }
    const checkinsInPeriod = guests.size;
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
  standardTime: string | null;     // horário padrão da propriedade
  standardTimeMax: string | null;
  date: string;                    // data prevista (checkin ou checkout)
  guestCheckin: string;
  guestCheckout: string | null;
  reservationCode: string | null;
  createdAt: string;
  status: "pending" | "done";
  note: string | null;
  arrivalTimeOverride: string | null;
  doneAt: string | null;
  pendingFill: boolean;            // true = reserva iCal sem formulário preenchido
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

    let q = context.supabase
      .from("guide_access_logs")
      .select("id, property_id, guest_name, guest_phone, guest_phone_country, guest_arrival_time, checkin_date, checkout_date, reservation_code, created_at")
      .in("property_id", propIds)
      .gte(dateCol, from!);
    if (to) q = q.lte(dateCol, to);
    const { data: logs } = await q.order(dateCol, { ascending: true }).limit(500);

    const rawLogs = (logs ?? []) as Array<{
      id: string; property_id: string; guest_name: string; guest_phone: string | null;
      guest_phone_country: string | null; guest_arrival_time: string | null;
      checkin_date: string; checkout_date: string | null;
      reservation_code: string | null; created_at: string;
    }>;
    const placeholderLogs = rawLogs.filter((l) => isPlaceholderGuest(l.guest_name));
    const formLogs = rawLogs.filter((l) => !isPlaceholderGuest(l.guest_name));
    // Dedupe per (property_id + guest_name + date) — keep the most recent log
    const dedupMap = new Map<string, typeof rawLogs[number]>();
    for (const l of formLogs) {
      const key = `${l.property_id}|${(l.guest_name || "").trim().toLowerCase()}|${data.kind === "checkin" ? l.checkin_date : l.checkout_date}`;
      const prev = dedupMap.get(key);
      if (!prev || new Date(l.created_at) > new Date(prev.created_at)) dedupMap.set(key, l);
    }
    const uniqueLogs = Array.from(dedupMap.values());
    const statusLogIds = [...uniqueLogs, ...placeholderLogs].map((l) => l.id);

    const [{ data: props }, { data: statuses }, { data: reservations }, { data: sectionEvents }] = await Promise.all([
      context.supabase
        .from("properties")
        .select("id, name, address, maps_url, garage_maps_url, wifi_password, lock_code, gate_code, checkin_time, checkin_time_max, checkout_time, checkout_time_min, airbnb_ical_url")
        .in("id", propIds),
      statusLogIds.length > 0
        ? context.supabase
            .from("guest_arrival_status")
            .select("log_id, kind, status, note, arrival_time_override, done_at")
            .in("log_id", statusLogIds)
            .eq("kind", data.kind)
        : Promise.resolve({ data: [] as Array<{ log_id: string; kind: string; status: "pending" | "done"; note: string | null; arrival_time_override: string | null; done_at: string | null }> }),
      context.supabase
        .from("property_reservations")
        .select("id, property_id, checkin_date, checkout_date, raw_summary, guest_hint, reservation_url, status, synced_at")
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
        : Promise.resolve({ data: [] as Array<{ property_id: string; section: string; guest_name: string | null; guest_phone: string | null }> }),
    ]);

    const propMap = new Map<string, { name: string | null; address: string | null; maps_url: string | null; garage_maps_url: string | null; hasPasswords: boolean; checkin_time: string | null; checkin_time_max: string | null; checkout_time: string | null; checkout_time_min: string | null; airbnb_ical_url: string | null }>();
    for (const p of (props ?? []) as Array<{ id: string; name: string | null; address: string | null; maps_url: string | null; garage_maps_url: string | null; wifi_password: string | null; lock_code: string | null; gate_code: string | null; checkin_time: string | null; checkin_time_max: string | null; checkout_time: string | null; checkout_time_min: string | null; airbnb_ical_url: string | null }>) {
      propMap.set(p.id, {
        name: p.name, address: p.address, maps_url: p.maps_url, garage_maps_url: p.garage_maps_url,
        hasPasswords: !!(p.wifi_password || p.lock_code || p.gate_code),
        checkin_time: p.checkin_time, checkin_time_max: p.checkin_time_max,
        checkout_time: p.checkout_time, checkout_time_min: p.checkout_time_min,
        airbnb_ical_url: p.airbnb_ical_url,
      });
    }

    // Index section events by property_id + normalized guest identity
    const eventKey = (pid: string, name: string | null, phone: string | null) =>
      `${pid}|${(name || "").trim().toLowerCase()}|${(phone || "").replace(/\D/g, "")}`;
    const openedCheckinSet = new Set<string>();
    const viewedPasswordsSet = new Set<string>();
    for (const ev of (sectionEvents ?? []) as Array<{ property_id: string; section: string; guest_name: string | null; guest_phone: string | null }>) {
      const k = eventKey(ev.property_id, ev.guest_name, ev.guest_phone);
      if (ev.section === "checkin") openedCheckinSet.add(k);
      else if (ev.section === "senhas") viewedPasswordsSet.add(k);
    }

    const statusMap = new Map<string, { kind: "checkin" | "checkout"; status: "pending" | "done"; note: string | null; arrival_time_override: string | null; done_at: string | null }>();
    for (const s of (statuses ?? []) as Array<{ log_id: string; kind: "checkin" | "checkout"; status: "pending" | "done"; note: string | null; arrival_time_override: string | null; done_at: string | null }>) {
      statusMap.set(s.log_id, { kind: s.kind, status: s.status, note: s.note, arrival_time_override: s.arrival_time_override, done_at: s.done_at });
    }

    const placeholderStatus = new Map<string, { status: "pending" | "done"; note: string | null; arrival_time_override: string | null; done_at: string | null }>();
    const placeholderKey = (propertyId: string, checkin: string, checkout: string | null, kind: "checkin" | "checkout") =>
      `${propertyId}|${checkin}|${checkout ?? ""}|${kind}`;
    for (const l of placeholderLogs) {
      const s = statusMap.get(l.id);
      if (!s) continue;
      placeholderStatus.set(placeholderKey(l.property_id, l.checkin_date, l.checkout_date, s.kind), s);
    }

    type ReservationRow = { id: string; property_id: string; checkin_date: string; checkout_date: string; raw_summary: string | null; guest_hint: string | null; reservation_url: string | null; status: string | null; synced_at: string | null };
    const resByProp = new Map<string, Array<{ id: string; checkin: string; checkout: string; raw_summary: string | null; status: string | null }>>();
    const reservationRows = ((reservations ?? []) as ReservationRow[]).filter(isRealReservation);
    for (const r of reservationRows) {
      const arr = resByProp.get(r.property_id) ?? [];
      arr.push({ id: r.id, checkin: r.checkin_date, checkout: r.checkout_date, raw_summary: r.raw_summary, status: r.status });
      resByProp.set(r.property_id, arr);
    }

    function reservationInRange(r: ReservationRow): boolean {
      const date = data.kind === "checkin" ? r.checkin_date : r.checkout_date;
      if (date < (from ?? today)) return false;
      if (to && date > to) return false;
      return true;
    }

    function findBestLogForReservation(r: ReservationRow) {
      const exactStay = uniqueLogs.find((l) =>
        l.property_id === r.property_id && l.checkin_date === r.checkin_date && l.checkout_date === r.checkout_date,
      );
      if (exactStay) return exactStay;
      if (data.kind === "checkin") {
        return uniqueLogs.find((l) => l.property_id === r.property_id && l.checkin_date === r.checkin_date) ?? null;
      }
      return uniqueLogs.find((l) => l.property_id === r.property_id && l.checkout_date === r.checkout_date) ?? null;
    }

    function rowFromLog(l: typeof uniqueLogs[number], forceIcal?: { hasIcal: boolean; matched: boolean; icalCheckin: string | null; icalCheckout: string | null }): ArrivalRow {
      const p = propMap.get(l.property_id);
      const s = statusMap.get(l.id);
      const date = data.kind === "checkin" ? l.checkin_date : (l.checkout_date ?? l.checkin_date);
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
          exact ??
          list.find((r) => r.checkin === addDaysISO(anchor, -1) || r.checkin === addDaysISO(anchor, 1));
        if (near) {
          matched = true;
          icalCheckin = near.checkin;
          icalCheckout = near.checkout;
        }
      }
      const evK = eventKey(l.property_id, l.guest_name, l.guest_phone);
      return {
        logId: l.id,
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
        status: s?.status ?? "pending",
        note: s?.note ?? null,
        arrivalTimeOverride: s?.arrival_time_override ?? null,
        doneAt: s?.done_at ?? null,
        pendingFill: false,
        ical: forceIcal ?? { hasIcal, matched, icalCheckin, icalCheckout },
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
        rows.push(rowFromLog(matchedLog, { hasIcal: true, matched: true, icalCheckin: r.checkin_date, icalCheckout: r.checkout_date }));
        continue;
      }

      const s = placeholderStatus.get(placeholderKey(r.property_id, r.checkin_date, r.checkout_date, data.kind));
      const date = data.kind === "checkin" ? r.checkin_date : r.checkout_date;
      rows.push({
        logId: `ical:${r.id}`,
        propertyId: r.property_id,
        propertyName: p.name ?? null,
        propertyAddress: p.address ?? null,
        mapsUrl: p.maps_url ?? null,
        garageMapsUrl: p.garage_maps_url ?? null,
        hasPasswords: !!p.hasPasswords,
        openedCheckin: false,
        viewedPasswords: false,
        guestName: r.guest_hint || "Reserva Airbnb",
        guestPhone: null,
        guestPhoneCountry: null,
        guestArrivalTime: null,
        standardTime: data.kind === "checkin" ? (p.checkin_time ?? null) : (p.checkout_time ?? null),
        standardTimeMax: data.kind === "checkin" ? (p.checkin_time_max ?? null) : (p.checkout_time_min ?? null),
        date,
        guestCheckin: r.checkin_date,
        guestCheckout: r.checkout_date,
        reservationCode: r.guest_hint ?? null,
        createdAt: r.synced_at ?? new Date().toISOString(),
        status: s?.status ?? "pending",
        note: s?.note ?? null,
        arrivalTimeOverride: s?.arrival_time_override ?? null,
        doneAt: s?.done_at ?? null,
        pendingFill: true,
        ical: { hasIcal: true, matched: true, icalCheckin: r.checkin_date, icalCheckout: r.checkout_date },
      });
    }

    for (const l of uniqueLogs) {
      if (usedLogIds.has(l.id)) continue;
      const p = propMap.get(l.property_id);
      if (p?.airbnb_ical_url) continue;
      rows.push(rowFromLog(l));
    }

    rows.sort((a, b) => a.date.localeCompare(b.date));

    return { rows };
  });

// ----- Mutations -----

const UpsertInput = z.object({
  logId: z.string().uuid(),
  kind: z.enum(["checkin", "checkout"]),
  status: z.enum(["pending", "done"]).optional(),
  note: z.string().max(500).nullable().optional(),
  arrivalTimeOverride: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .optional(),
});

export const upsertArrivalStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UpsertInput.parse(i))
  .handler(async ({ data, context }) => {
    // Resolve property_id via the log (RLS on guide_access_logs will scope it)
    const { data: log, error: logErr } = await context.supabase
      .from("guide_access_logs")
      .select("id, property_id")
      .eq("id", data.logId)
      .maybeSingle();
    if (logErr || !log) throw new Error("Registro não encontrado.");

    const patch: {
      log_id: string;
      property_id: string;
      kind: "checkin" | "checkout";
      status?: "pending" | "done";
      done_at?: string | null;
      note?: string | null;
      arrival_time_override?: string | null;
    } = {
      log_id: data.logId,
      property_id: (log as { property_id: string }).property_id,
      kind: data.kind,
    };
    if (typeof data.status !== "undefined") {
      patch.status = data.status;
      patch.done_at = data.status === "done" ? new Date().toISOString() : null;
    }
    if (typeof data.note !== "undefined") patch.note = data.note;
    if (typeof data.arrivalTimeOverride !== "undefined") patch.arrival_time_override = data.arrivalTimeOverride;

    const { error } = await context.supabase
      .from("guest_arrival_status")
      .upsert(patch, { onConflict: "log_id,kind" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ----- Inline edit: correct stay dates on a guest access log -----

const UpdateStayDatesInput = z.object({
  logId: z.string().uuid(),
  checkinDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  checkoutDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
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

    const { error } = await context.supabase
      .from("guide_access_logs")
      .update(patch)
      .eq("id", data.logId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ----- Inline edit: correct arrival time on the guide access log -----

const UpdateArrivalTimeInput = z.object({
  logId: z.string().uuid(),
  time: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
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
  propertyId: z.string().uuid(),
  kind: z.enum(["checkin", "checkout"]),
  checkinDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkoutDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
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

    // Look for an existing placeholder log for the same date so we don't duplicate.
    const { data: existing } = await context.supabase
      .from("guide_access_logs")
      .select("id")
      .eq("property_id", data.propertyId)
      .eq("checkin_date", data.checkinDate)
      .ilike("guest_name", "Hóspede pendente")
      .limit(1);

    let logId = (existing?.[0] as { id: string } | undefined)?.id;

    if (!logId) {
      // Client insert is blocked by RLS; use the admin client to create the placeholder.
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: created, error: insErr } = await supabaseAdmin
        .from("guide_access_logs")
        .insert({
          property_id: data.propertyId,
          guest_name: "Hóspede pendente",
          checkin_date: data.checkinDate,
          checkout_date: data.checkoutDate ?? null,
        })
        .select("id")
        .single();
      if (insErr || !created) throw new Error(insErr?.message || "Falha ao criar registro.");
      logId = (created as { id: string }).id;
    }

    const { error: upErr } = await context.supabase
      .from("guest_arrival_status")
      .upsert(
        {
          log_id: logId,
          property_id: data.propertyId,
          kind: data.kind,
          status: data.status,
          done_at: data.status === "done" ? new Date().toISOString() : null,
        },
        { onConflict: "log_id,kind" },
      );
    if (upErr) throw new Error(upErr.message);
    return { ok: true, logId };
  });

