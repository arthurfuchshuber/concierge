// Server-only: construtor da esteira (Kanban) de chegadas/saídas.
// Fonte única de verdade compartilhada entre o dashboard e as notificações push.
import type { ArrivalRow } from "@/lib/dashboard-arrival-types";

export type { ArrivalRow };

type AnyClient = { from: (t: string) => any };

function todayISO(): string {
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

/**
 * Ressincroniza iCals desatualizados (>10min) para que qualquer superfície
 * (Kanban, KPIs, calendário de ocupação) leia sempre a reserva mais recente.
 */
export async function syncStaleIcals(supabase: AnyClient, propIds: string[]): Promise<void> {
  if (propIds.length === 0) return;
  const { data: syncProps } = await (supabase as any)
    .from("properties")
    .select("id, airbnb_ical_url, airbnb_ical_last_sync_at")
    .in("id", propIds)
    .not("airbnb_ical_url", "is", null);
  const stale = (
    (syncProps ?? []) as Array<{ id: string; airbnb_ical_url: string | null; airbnb_ical_last_sync_at: string | null }>
  )
    .filter((p) => {
      const url = p.airbnb_ical_url?.trim();
      if (!url) return false;
      if (!p.airbnb_ical_last_sync_at) return true;
      return Date.now() - new Date(p.airbnb_ical_last_sync_at).getTime() > 10 * 60 * 1000;
    })
    .slice(0, 8);
  if (stale.length === 0) return;
  const { isAllowedIcalUrl } = await import("@/lib/airbnb-ical-url");
  const { syncPropertyIcal } = await import("@/lib/airbnb-ical.server");
  await Promise.allSettled(
    stale.map((p) => {
      const url = p.airbnb_ical_url?.trim();
      return url && isAllowedIcalUrl(url) ? syncPropertyIcal(p.id, url) : Promise.resolve(null);
    }),
  );
}

/**
 * Monta exatamente as mesmas linhas exibidas no Kanban do dashboard.
 * `supabase` pode ser o client do usuário (RLS) ou o admin (cron).
 */
export async function buildArrivalRows(
  supabase: AnyClient,
  opts: { kind: "checkin" | "checkout"; range: "today" | "tomorrow" | "7d" | "all"; propIds: string[] },
): Promise<{ rows: ArrivalRow[] }> {
  const data = { kind: opts.kind, range: opts.range };
  const propIds = opts.propIds;
  const context = { supabase } as { supabase: any };
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
      await syncStaleIcals(supabase, propIds);
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

    const reservationWindowStart = data.range === "tomorrow" ? addDaysISO(today, 1) : today;
    const reservationWindowEnd =
      data.range === "tomorrow" ? reservationWindowStart : data.range === "7d" ? addDaysISO(today, 6) : null;
    let reservationsQuery = context.supabase
      .from("property_reservations")
      .select(
        "id, property_id, checkin_date, checkout_date, raw_summary, guest_hint, reservation_url, status, synced_at, created_at",
      )
      .in("property_id", propIds)
      .eq("source", "airbnb");
    if (data.kind === "checkin") {
      if (data.range === "tomorrow") {
        reservationsQuery = reservationsQuery.gte("checkin_date", reservationWindowStart).lte("checkin_date", reservationWindowStart);
      } else {
        // Check-in lists also feed "Em Estadia". Fetch by interval overlap so
        // active stays whose check-in happened before today are not silently
        // dropped; reservationInRange below still decides the exact stage.
        reservationsQuery = reservationsQuery.gte("checkout_date", today);
        if (data.range !== "all") reservationsQuery = reservationsQuery.lte("checkin_date", reservationWindowEnd ?? today);
        if (reservationWindowEnd) reservationsQuery = reservationsQuery.lte("checkin_date", reservationWindowEnd);
      }
    } else {
      // Check-outs pendentes anteriores (atrasados) precisam continuar visíveis
      // no dashboard e no KPI "Checkouts Pendentes". Para tomorrow mantemos a
      // janela exata; nos demais casos removemos o piso para não descartar
      // reservas de dias anteriores que ainda não foram concluídas.
      if (data.range === "tomorrow") {
        reservationsQuery = reservationsQuery.gte("checkout_date", reservationWindowStart);
      }
      if (reservationWindowEnd) reservationsQuery = reservationsQuery.lte("checkout_date", reservationWindowEnd);
    }

    const [{ data: props }, { data: statuses }, { data: reservations }, { data: sectionEvents }] = await Promise.all([
      context.supabase
        .from("properties")
        .select(
          "id, name, address, owner_contact_id, maps_url, garage_maps_url, wifi_password, lock_code, gate_code, checkin_time, checkin_time_max, checkout_time, checkout_time_min, airbnb_ical_url",
        )

        .in("id", propIds),
      context.supabase
        .from("guest_arrival_status")
        .select("log_id, reservation_id, kind, status, note, arrival_time_override, done_at, concluded_at")
        .in("property_id", propIds)
        .limit(5000),
      reservationsQuery.order(data.kind === "checkin" ? "checkin_date" : "checkout_date", { ascending: true }).limit(10000),
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

    const ownerIdsForProps = Array.from(
      new Set(
        ((props ?? []) as Array<{ owner_contact_id: string | null }>)
          .map((p) => p.owner_contact_id)
          .filter((v): v is string => !!v),
      ),
    );
    const ownerNameById = new Map<string, string>();
    const ownerPhoneById = new Map<string, { phone: string | null; country: string | null }>();
    if (ownerIdsForProps.length > 0) {
      const { data: owners } = await context.supabase
        .from("property_owners")
        .select("id, name, trade_name, phone, phone_country")
        .in("id", ownerIdsForProps);
      for (const o of (owners ?? []) as Array<{ id: string; name: string | null; trade_name: string | null; phone: string | null; phone_country: string | null }>) {
        const label = (o.trade_name || o.name || "").trim();
        if (label) ownerNameById.set(o.id, label);
        ownerPhoneById.set(o.id, { phone: o.phone ?? null, country: o.phone_country ?? null });
      }
    }

    const propMap = new Map<
      string,
      {
        name: string | null;
        ownerName: string | null;
        ownerPhone: string | null;
        ownerPhoneCountry: string | null;
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
      owner_contact_id: string | null;
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
        ownerName: p.owner_contact_id ? (ownerNameById.get(p.owner_contact_id) ?? null) : null,
        ownerPhone: p.owner_contact_id ? (ownerPhoneById.get(p.owner_contact_id)?.phone ?? null) : null,
        ownerPhoneCountry: p.owner_contact_id ? (ownerPhoneById.get(p.owner_contact_id)?.country ?? null) : null,
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
    const checkinPendingLogs = new Set<string>();
    const checkinPendingReservations = new Set<string>();
    for (const s of (statuses ?? []) as StatusRow[]) {
      if (s.kind === "checkin" && (s.status === "done" || !!s.done_at)) {
        if (s.log_id) checkinDoneLogs.add(s.log_id);
        if (s.reservation_id) checkinDoneReservations.add(s.reservation_id);
      }
      if (s.kind === "checkin" && s.status === "pending" && !s.done_at) {
        if (s.log_id) checkinPendingLogs.add(s.log_id);
        if (s.reservation_id) checkinPendingReservations.add(s.reservation_id);
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
      created_at: string | null;
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

    function isCurrentStay(checkinDate: string, checkoutDate: string | null): boolean {
      return !!checkoutDate && checkinDate <= today && checkoutDate > today;
    }

    // Janela máxima para manter um check-in atrasado visível (evita reimportar
    // histórico antigo, mas nunca "some" com pendências recentes).
    const OVERDUE_WINDOW_DAYS = 30;
    function withinOverdueWindow(checkinDate: string): boolean {
      return checkinDate >= addDaysISO(today, -OVERDUE_WINDOW_DAYS);
    }

    function logCheckinDone(logId: string | null | undefined): boolean {
      return !!logId && checkinDoneLogs.has(logId);
    }
    function reservationCheckinDone(r: ReservationRow): boolean {
      if (checkinDoneReservations.has(r.id)) return true;
      const legacy = placeholderStatus.get(placeholderKey(r.property_id, r.checkin_date, r.checkout_date, "checkin"));
      if (legacy && (legacy.status === "done" || !!legacy.done_at)) return true;
      const { primary, extras } = findLogsForReservation(r);
      return [primary, ...extras].some((l) => logCheckinDone(l?.id));
    }

    // Regra da esteira: uma reserva só pode aparecer em UM estágio, mas a
    // passagem de Check-ins para Checkouts/Em Limpeza SÓ acontece depois do
    // check manual. Enquanto o check-in estiver pendente, o card fica retido em
    // Check-ins (como atrasado), mesmo que a data de checkout já tenha chegado.
    function belongsToCheckoutStage(
      checkinDate: string,
      checkoutDate: string | null,
      checkinDone: boolean,
    ): boolean {
      if (!checkoutDate) return false;
      if (!checkinDone) return false;
      return checkinDate <= today && checkoutDate <= today;
    }

    function reservationInRange(r: ReservationRow): boolean {
      const resCheckinDone = data.kind === "checkin" ? reservationCheckinDone(r) : false;
      if (data.kind === "checkin") {
        if (belongsToCheckoutStage(r.checkin_date, r.checkout_date, resCheckinDone)) return false;
      }
      const date = data.kind === "checkin" ? r.checkin_date : r.checkout_date;
      if (date < (from ?? today)) {
        if (data.kind === "checkin" && data.range !== "tomorrow") {
          // Estadia em andamento continua visível para alimentar "Em Estadia".
          if (isCurrentStay(r.checkin_date, r.checkout_date)) return true;
          // Check-in atrasado sem check permanece na lista de Check-ins.
          if (!resCheckinDone && withinOverdueWindow(r.checkin_date)) return true;
        }
        return false;
      }
      if (to && date > to) return false;
      return true;
    }


    function normalizeCode(s: string | null | undefined): string | null {
      if (!s) return null;
      const m = String(s).match(/HM[A-Z0-9]{6,}/i);
      return m ? m[0].toUpperCase() : null;
    }
    // Retorna todos os logs que representam hóspedes da MESMA reserva iCal
    // (primário + acompanhantes). Ordenados por prioridade (código HM bate mais
    // forte que datas), o primeiro vira o hóspede exibido; os demais ficam como
    // "additionalGuests" no mesmo card — grupos que digitaram o formulário no
    // mesmo período para a mesma residência.
    function findLogsForReservation(r: ReservationRow): { primary: (typeof uniqueLogs)[number] | null; extras: (typeof uniqueLogs)[number][] } {
      const resCode = normalizeCode(r.guest_hint);
      const matched: (typeof uniqueLogs)[number][] = [];
      const seen = new Set<string>();
      const push = (l: (typeof uniqueLogs)[number]) => {
        if (seen.has(l.id)) return;
        seen.add(l.id);
        matched.push(l);
      };
      if (resCode) {
        for (const l of uniqueLogs) {
          if (l.property_id !== r.property_id) continue;
          if (normalizeCode(l.reservation_code) === resCode) push(l);
        }
      }
      // Datas exatas — só quando é seguro (mesma trava do antigo findBest).
      for (const l of uniqueLogs) {
        if (l.property_id !== r.property_id) continue;
        if (l.checkin_date !== r.checkin_date || l.checkout_date !== r.checkout_date) continue;
        const logCode = normalizeCode(l.reservation_code);
        if (resCode && logCode && logCode !== resCode) continue;
        if (resCode && !logCode && data.kind === "checkin") continue;
        push(l);
      }
      if (matched.length === 0) return { primary: null, extras: [] };
      // Ordena: com código HM primeiro, depois datas exatas, depois created_at desc.
      matched.sort((a, b) => {
        const aCode = resCode && normalizeCode(a.reservation_code) === resCode ? 1 : 0;
        const bCode = resCode && normalizeCode(b.reservation_code) === resCode ? 1 : 0;
        if (aCode !== bCode) return bCode - aCode;
        const aExact = a.checkin_date === r.checkin_date && a.checkout_date === r.checkout_date ? 1 : 0;
        const bExact = b.checkin_date === r.checkin_date && b.checkout_date === r.checkout_date ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      return { primary: matched[0], extras: matched.slice(1) };
    }


    const nowHM = nowHHMMSaoPaulo();
    // Auto-distribuição APENAS na importação: quando uma reserva/registro é
    // criado DEPOIS que a estadia já começou (integração nova sincronizando o
    // histórico corrente), o card já nasce em "Em Estadia". Cards que já
    // existiam quando o check-in chegou NUNCA mudam de lista sozinhos — só
    // saem de "Check-ins" quando o usuário marca o check manualmente.
    function isoDateSP(ts: string | null | undefined): string | null {
      if (!ts) return null;
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) return null;
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(d);
      const pick = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
      return `${pick("year")}-${pick("month")}-${pick("day")}`;
    }
    function autoStayDone(checkinDate: string, checkoutDate: string | null, createdAt: string | null): boolean {
      if (data.kind !== "checkin") return false;
      if (!checkoutDate || checkoutDate <= today) return false; // precisa estar em estadia (checkout no futuro)
      if (checkinDate >= today) return false; // estadia precisa já ter começado
      const created = isoDateSP(createdAt);
      // Só promove automaticamente se o card foi criado depois do início da estadia.
      return !!created && created > checkinDate;
    }


    function rowFromLog(
      l: (typeof uniqueLogs)[number],
      forceIcal?: { hasIcal: boolean; matched: boolean; icalCheckin: string | null; icalCheckout: string | null },
      extras: (typeof uniqueLogs)[number][] = [],
    ): ArrivalRow | null {
      const p = propMap.get(l.property_id);
      const s = statusMap.get(l.id);
      if (s?.concluded_at) return null;
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
          exact ?? list.find((r) => r.checkin === addDaysISO(anchor, -1) || r.checkin === addDaysISO(anchor, 1));
        if (near) {
          matched = true;
          icalCheckin = near.checkin;
          icalCheckout = near.checkout;
        }
      }
      const virtualStay = autoStayDone(l.checkin_date, l.checkout_date ?? null, l.created_at ?? null);
      const logDone = logCheckinDone(l.id) || virtualStay;
      const overduePending = data.kind === "checkin" && !logDone && withinOverdueWindow(l.checkin_date);
      if (data.kind === "checkin" && belongsToCheckoutStage(l.checkin_date, l.checkout_date ?? null, logDone)) {
        return null;
      }
      if (
        data.kind === "checkin" &&
        date < (from ?? today) &&
        !(
          data.range !== "tomorrow" &&
          (isCurrentStay(l.checkin_date, l.checkout_date ?? null) || overduePending)
        )
      ) {
        return null;
      }
      // Cards com data anterior a hoje só aparecem sem interação quando a estadia
      // ainda está em andamento ou quando o check-in continua pendente (atrasado).
      if (date < today && !s && !virtualStay && !(overduePending && data.range !== "tomorrow")) return null;

      const evK = eventKey(l.property_id, l.guest_name, l.guest_phone);
      return {
        logId: l.id,
        reservationId: null,
        propertyId: l.property_id,
        propertyName: p?.name ?? null,
        ownerName: p?.ownerName ?? null,
        ownerPhone: p?.ownerPhone ?? null,
        ownerPhoneCountry: p?.ownerPhoneCountry ?? null,
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
                : virtualStay
                ? "done"
                : "pending",
        note: s?.note ?? null,
        mutedUntil: s?.muted_until ?? null,
        arrivalTimeOverride: s?.arrival_time_override ?? null,
        doneAt: s?.done_at ?? null,
        pendingFill: false,
        ical: forceIcal ?? { hasIcal, matched, icalCheckin, icalCheckout },
        additionalGuests: extras.map((e) => ({
          logId: e.id,
          name: e.guest_name,
          phone: e.guest_phone,
          phoneCountry: e.guest_phone_country,
          reservationCode: e.reservation_code,
          arrivalTime: e.guest_arrival_time,
        })),
      };
    }

    function rowFromReservation(
      r: ReservationRow,
      matchedLog: (typeof uniqueLogs)[number] | null,
      extras: (typeof uniqueLogs)[number][] = [],
    ): ArrivalRow | null {
      const p = propMap.get(r.property_id);
      const legacy = placeholderStatus.get(placeholderKey(r.property_id, r.checkin_date, r.checkout_date, data.kind));
      const logStatus = matchedLog ? statusMap.get(matchedLog.id) : undefined;
      const s = reservationStatusMap.get(r.id) ?? legacy ?? logStatus;
      if (s?.concluded_at) return null;
      const date = data.kind === "checkin" ? r.checkin_date : r.checkout_date;
      // IMPORTANTE: nunca usar `synced_at` aqui — ele é reescrito a cada sync do iCal,
      // o que promoveria toda estadia em curso automaticamente. Só a data real de
      // criação do registro (integração nova) pode disparar a auto-distribuição.
      const virtualStay = autoStayDone(r.checkin_date, r.checkout_date, matchedLog?.created_at ?? r.created_at ?? null);
      const overduePending =
        data.kind === "checkin" &&
        data.range !== "tomorrow" &&
        !reservationCheckinDone(r) &&
        !virtualStay &&
        withinOverdueWindow(r.checkin_date);
      // Datas passadas só entram sem interação quando representam uma estadia
      // vigente ou um check-in ainda pendente (atrasado).
      if (date < today && !s && !virtualStay && !overduePending) return null;

      const evK = matchedLog ? eventKey(matchedLog.property_id, matchedLog.guest_name, matchedLog.guest_phone) : "";

      return {
        logId: matchedLog?.id ?? `ical:${r.id}`,
        reservationId: r.id,
        propertyId: r.property_id,
        propertyName: p?.name ?? null,
        ownerName: p?.ownerName ?? null,
        ownerPhone: p?.ownerPhone ?? null,
        ownerPhoneCountry: p?.ownerPhoneCountry ?? null,
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
        guestCheckin: r.checkin_date,
        guestCheckout: r.checkout_date,
        reservationCode: r.guest_hint ?? matchedLog?.reservation_code ?? null,
        createdAt: matchedLog?.created_at ?? r.created_at ?? r.synced_at ?? new Date().toISOString(),
        status:
          data.kind === "checkin" && r.checkin_date > today && s?.status === "done"
            ? "pending"
            : s
              ? s.status
              : virtualStay
                ? "done"
                : "pending",
        note: s?.note ?? null,
        arrivalTimeOverride: s?.arrival_time_override ?? null,
        doneAt: s?.done_at ?? null,
        pendingFill: !matchedLog,
        ical: { hasIcal: true, matched: true, icalCheckin: r.checkin_date, icalCheckout: r.checkout_date },
        additionalGuests: extras.map((e) => ({
          logId: e.id,
          name: e.guest_name,
          phone: e.guest_phone,
          phoneCountry: e.guest_phone_country,
          reservationCode: e.reservation_code,
          arrivalTime: e.guest_arrival_time,
        })),
      };
    }

    const rows: ArrivalRow[] = [];
    const usedLogIds = new Set<string>();

    const _filtered = reservationRows.filter(reservationInRange);
    for (const r of _filtered) {
      const p = propMap.get(r.property_id);
      if (!p?.airbnb_ical_url) continue;
      const { primary: matchedLog, extras } = findLogsForReservation(r);
      if (matchedLog) usedLogIds.add(matchedLog.id);
      for (const e of extras) usedLogIds.add(e.id);
      const row = rowFromReservation(r, matchedLog, extras);
      if (row) rows.push(row);
    }
    // Não-iCal: agrupa logs manuais do mesmo grupo (mesmo imóvel + período +
    // código) num único card, com os demais como acompanhantes.
    const nonIcalGroups = new Map<string, (typeof uniqueLogs)[number][]>();
    for (const l of uniqueLogs) {
      if (usedLogIds.has(l.id)) continue;
      const p = propMap.get(l.property_id);
      if (p?.airbnb_ical_url) continue;
      const code = normalizeCode(l.reservation_code);
      const key = code
        ? `${l.property_id}|code|${code}`
        : `${l.property_id}|dates|${l.checkin_date}|${l.checkout_date ?? ""}`;
      const arr = nonIcalGroups.get(key) ?? [];
      arr.push(l);
      nonIcalGroups.set(key, arr);
    }
    for (const group of nonIcalGroups.values()) {
      group.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      const [primary, ...extras] = group;
      const row = rowFromLog(primary, undefined, extras);
      if (row) rows.push(row);
    }

    // Esteira: um card só pode aparecer em Checkouts/Em Limpeza depois que o
    // check-in correspondente foi marcado como feito. Enquanto o check-in
    // estiver pendente (mesmo atrasado), o card fica retido em Check-ins.
    // Auto-promoção virtual: se a estadia já está em andamento (checkin no
    // passado, ou hoje após o horário padrão de entrada), o check-in é
    // considerado feito virtualmente para efeito da esteira — assim o card
    // avança para Checkouts/Em Limpeza sem precisar de clique manual.
    function virtualCheckinDone(r: ArrivalRow): boolean {
      // Só há promoção automática quando o registro nasceu DEPOIS do início da
      // estadia (integração nova importando histórico corrente). Cards que já
      // existiam quando a data chegou exigem o check manual.
      const ci = r.guestCheckin;
      if (!ci) return false;
      const created = isoDateSP(r.createdAt);
      return !!created && created > ci;
    }

    const gatedRows =
      data.kind === "checkout"
        ? rows.filter((r) => {
            const logDone = !!(r.logId && !r.logId.startsWith("ical:") && checkinDoneLogs.has(r.logId));
            const resDone = !!(r.reservationId && checkinDoneReservations.has(r.reservationId));
            const logExplicitlyPending = !!(r.logId && !r.logId.startsWith("ical:") && checkinPendingLogs.has(r.logId));
            const resExplicitlyPending = !!(r.reservationId && checkinPendingReservations.has(r.reservationId));
            if (data.range === "tomorrow") return true;
            const vDone = virtualCheckinDone(r);
            // Estadia com check-in no passado (ou hoje após o horário padrão) já
            // está em curso fisicamente — o card precisa aparecer em Checkouts
            // mesmo que exista um status de check-in "pending" legado.
            if (!logDone && !resDone && !vDone && (logExplicitlyPending || resExplicitlyPending)) return false;
            return logDone || resDone || vDone;
          })
        : rows;
    function isBetterOperationalRow(candidate: ArrivalRow, current: ArrivalRow): boolean {
      const score = (r: ArrivalRow) => {
        let v = 0;
        if (r.status === "done") v += 100;
        if (!r.pendingFill && r.guestName && r.guestName !== r.reservationCode) v += 40;
        if (r.reservationCode) v += 20;
        if (r.ical.matched) v += 10;
        if (r.openedCheckin) v += 4;
        if (r.viewedPasswords) v += 2;
        return v;
      };
      const scoreDiff = score(candidate) - score(current);
      if (scoreDiff !== 0) return scoreDiff > 0;
      return new Date(candidate.createdAt).getTime() > new Date(current.createdAt).getTime();
    }

    function dedupeCheckoutRows(input: ArrivalRow[]): ArrivalRow[] {
      if (data.kind !== "checkout") return [...input];
      // Deduplica apenas a MESMA reserva quando ela chegou por caminhos
      // diferentes (status por log legado + status por reservation_id). Não
      // deduplicamos por imóvel+data: back-to-back e correções do iCal precisam
      // continuar fiéis à identidade da reserva HM….
      const byPropertyAndCheckout = new Map<string, ArrivalRow>();
      for (const row of input) {
        const key = `${row.reservationCode ?? row.reservationId ?? row.logId}|${row.propertyId}|${row.guestCheckin}|${row.guestCheckout ?? ""}|${row.date}`;
        const current = byPropertyAndCheckout.get(key);
        if (!current || isBetterOperationalRow(row, current)) {
          byPropertyAndCheckout.set(key, row);
        }
      }
      return Array.from(byPropertyAndCheckout.values());
    }

    const finalRows = dedupeCheckoutRows(gatedRows);
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
}
