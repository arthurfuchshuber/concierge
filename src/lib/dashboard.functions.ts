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

async function accessiblePropertyIds(supabase: {
  from: (t: string) => {
    select: (s: string) => {
      order?: (c: string, o: { ascending: boolean }) => Promise<{ data: unknown[] | null }>;
    };
  };
}): Promise<string[]> {
  // RLS on properties already scopes to owner + active account members.
  const { data } = await (supabase as unknown as {
    from: (t: string) => { select: (s: string) => Promise<{ data: Array<{ id: string }> | null }> };
  })
    .from("properties")
    .select("id");
  return (data ?? []).map((r) => r.id);
}

// ----- KPIs -----

export const getDashboardKpis = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const propIds = await accessiblePropertyIds(context.supabase as never);
    if (propIds.length === 0) {
      return { checkinsToday: 0, checkinsTomorrow: 0, checkoutsToday: 0, checkoutsTomorrow: 0 };
    }
    const today = todayISO();
    const tomorrow = addDaysISO(today, 1);

    async function count(col: "checkin_date" | "checkout_date", date: string) {
      const { data } = await context.supabase
        .from("guide_access_logs")
        .select("id, property_id, guest_name")
        .in("property_id", propIds)
        .eq(col, date)
        .limit(1000);
      // dedupe by property_id + guest_name (case-insensitive)
      const seen = new Set<string>();
      for (const row of data ?? []) {
        const key = `${(row as { property_id: string }).property_id}|${((row as { guest_name: string }).guest_name || "").trim().toLowerCase()}`;
        seen.add(key);
      }
      return seen.size;
    }

    const [ciT, ciTo, coT, coTo] = await Promise.all([
      count("checkin_date", today),
      count("checkin_date", tomorrow),
      count("checkout_date", today),
      count("checkout_date", tomorrow),
    ]);
    return { checkinsToday: ciT, checkinsTomorrow: ciTo, checkoutsToday: coT, checkoutsTomorrow: coTo };
  });

// ----- Engagement -----

const EngagementInput = z.object({
  range: z.enum(["today", "7d", "30d"]).default("today"),
});

export const getGuideEngagement = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => EngagementInput.parse(i))
  .handler(async ({ data, context }) => {
    const propIds = await accessiblePropertyIds(context.supabase as never);
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
    const propIds = await accessiblePropertyIds(context.supabase as never);
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
    // Dedupe per (property_id + guest_name + date) — keep the most recent log
    const dedupMap = new Map<string, typeof rawLogs[number]>();
    for (const l of rawLogs) {
      const key = `${l.property_id}|${(l.guest_name || "").trim().toLowerCase()}|${data.kind === "checkin" ? l.checkin_date : l.checkout_date}`;
      const prev = dedupMap.get(key);
      if (!prev || new Date(l.created_at) > new Date(prev.created_at)) dedupMap.set(key, l);
    }
    const uniqueLogs = Array.from(dedupMap.values());

    const [{ data: props }, { data: statuses }, { data: reservations }, { data: sectionEvents }] = await Promise.all([
      context.supabase
        .from("properties")
        .select("id, name, address, maps_url, garage_maps_url, wifi_password, lock_code, gate_code, checkin_time, checkin_time_max, checkout_time, checkout_time_min, airbnb_ical_url")
        .in("id", propIds),
      uniqueLogs.length > 0
        ? context.supabase
            .from("guest_arrival_status")
            .select("log_id, kind, status, note, arrival_time_override, done_at")
            .in("log_id", uniqueLogs.map((l) => l.id))
            .eq("kind", data.kind)
        : Promise.resolve({ data: [] as Array<{ log_id: string; kind: string; status: "pending" | "done"; note: string | null; arrival_time_override: string | null; done_at: string | null }> }),
      context.supabase
        .from("property_reservations")
        .select("property_id, checkin_date, checkout_date")
        .in("property_id", propIds)
        .eq("source", "airbnb"),
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

    const statusMap = new Map<string, { status: "pending" | "done"; note: string | null; arrival_time_override: string | null; done_at: string | null }>();
    for (const s of (statuses ?? []) as Array<{ log_id: string; status: "pending" | "done"; note: string | null; arrival_time_override: string | null; done_at: string | null }>) {
      statusMap.set(s.log_id, { status: s.status, note: s.note, arrival_time_override: s.arrival_time_override, done_at: s.done_at });
    }

    const resByProp = new Map<string, Array<{ checkin: string; checkout: string }>>();
    for (const r of (reservations ?? []) as Array<{ property_id: string; checkin_date: string; checkout_date: string }>) {
      const arr = resByProp.get(r.property_id) ?? [];
      arr.push({ checkin: r.checkin_date, checkout: r.checkout_date });
      resByProp.set(r.property_id, arr);
    }

    const rows: ArrivalRow[] = uniqueLogs.map((l) => {
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
        ical: { hasIcal, matched, icalCheckin, icalCheckout },
      };
    });

    // Append synthetic "pending fill" rows: iCal reservations in-range with no matching filled log
    const filledKeys = new Set(
      uniqueLogs.map((l) => `${l.property_id}|${data.kind === "checkin" ? l.checkin_date : l.checkout_date}`),
    );
    for (const [pid, list] of resByProp.entries()) {
      const p = propMap.get(pid);
      if (!p) continue;
      for (const r of list) {
        const rd = data.kind === "checkin" ? r.checkin : r.checkout;
        if (from && rd < from) continue;
        if (to && rd > to) continue;
        const key = `${pid}|${rd}`;
        if (filledKeys.has(key)) continue;
        // Avoid duplicates within pending set
        filledKeys.add(key);
        rows.push({
          logId: `pending:${pid}:${r.checkin}:${r.checkout}`,
          propertyId: pid,
          propertyName: p.name,
          propertyAddress: p.address,
          mapsUrl: p.maps_url,
          garageMapsUrl: p.garage_maps_url,
          hasPasswords: p.hasPasswords,
          openedCheckin: false,
          viewedPasswords: false,
          guestName: "Hóspede pendente",
          guestPhone: null,
          guestPhoneCountry: null,
          guestArrivalTime: null,
          standardTime: data.kind === "checkin" ? p.checkin_time : p.checkout_time,
          standardTimeMax: data.kind === "checkin" ? p.checkin_time_max : p.checkout_time_min,
          date: rd,
          guestCheckin: r.checkin,
          guestCheckout: r.checkout,
          reservationCode: null,
          createdAt: new Date().toISOString(),
          status: "pending",
          note: null,
          arrivalTimeOverride: null,
          doneAt: null,
          pendingFill: true,
          ical: { hasIcal: true, matched: true, icalCheckin: r.checkin, icalCheckout: r.checkout },
        });
      }
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
