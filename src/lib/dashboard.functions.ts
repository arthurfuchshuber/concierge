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

/**
 * Some proprietário com cadastro CANCELADO (status "canceled" em
 * property_owners — diferente de "canceling", que ainda é um vínculo válido
 * em uso) some destes painéis operacionais (Dashboard/Kanban/Calendário),
 * embora o imóvel continue existindo e editável normalmente em "Guias".
 * Só o status terminal esconde; "canceling" continua aparecendo.
 */
async function excludeCanceledOwnerProperties(
  supabase: {
    from: (t: string) => unknown;
  },
  rows: Array<{ id: string; owner_contact_id: string | null }>,
  ids: string[],
): Promise<string[]> {
  const idSet = new Set(ids);
  const ownerByProp = new Map(rows.filter((r) => idSet.has(r.id)).map((r) => [r.id, r.owner_contact_id]));
  const ownerIds = Array.from(new Set(Array.from(ownerByProp.values()).filter((v): v is string => !!v)));
  if (ownerIds.length === 0) return ids;
  const { data: canceledOwners } = await (
    supabase as unknown as {
      from: (t: string) => {
        select: (s: string) => {
          in: (c: string, v: string[]) => {
            eq: (c: string, v: string) => Promise<{ data: Array<{ id: string }> | null }>;
          };
        };
      };
    }
  )
    .from("property_owners")
    .select("id")
    .in("id", ownerIds)
    .eq("status", "canceled");
  const canceledSet = new Set((canceledOwners ?? []).map((r) => r.id));
  if (canceledSet.size === 0) return ids;
  return ids.filter((pid) => {
    const oid = ownerByProp.get(pid);
    return !oid || !canceledSet.has(oid);
  });
}

export async function accessiblePropertyIds(
  supabase: {
    from: (t: string) => unknown;
  },
  ownerId?: string | null,
  userId?: string | null,
): Promise<string[]> {
  let authorizedOwnerId = ownerId ?? null;
  if (userId && ownerId) {
    const { resolveAuthorizedAccountOwnerId } = await import("@/lib/account-scope.server");
    authorizedOwnerId = await resolveAuthorizedAccountOwnerId(
      supabase as never,
      userId,
      ownerId,
    );
  }
  // RLS on properties already scopes to owner + active account members.
  const query = (
    supabase as unknown as {
      from: (t: string) => {
        select: (s: string) => {
          eq: (c: string, v: string) => Promise<{ data: Array<{ id: string; owner_contact_id: string | null }> | null }>;
        } & Promise<{ data: Array<{ id: string; owner_contact_id: string | null }> | null }>;
      };
    }
  )
    .from("properties")
    .select("id, owner_contact_id");
  const { data } = authorizedOwnerId ? await query.eq("owner_id", authorizedOwnerId) : await query;
  const rows = data ?? [];
  let ids = rows.map((r) => r.id);
  if (userId) {
    // Recorte por residências atendidas: sem vínculo, o membro não vê nada.
    const { filterVisiblePropertyIds } = await import("@/lib/permissions/property-scope.server");
    ids = await filterVisiblePropertyIds(userId, ids);
  }
  return await excludeCanceledOwnerProperties(supabase, rows, ids);
}


// ----- KPIs -----

export const getDashboardKpis = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ScopeInput.parse(i) ?? {})
  .handler(async ({ data, context }) => {
    const propIds = await accessiblePropertyIds(context.supabase as never, data.ownerId ?? null, context.userId);
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
        .select("log_id, reservation_id, kind, status, arrival_date_override, concluded_at")
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
      status: "pending" | "done" | "no_show";
      arrival_date_override: string | null;
      concluded_at: string | null;
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
    // Previsão informada pelo anfitrião manda no dia contado — mesma regra que
    // o Kanban usa (arrival_date_override em arrival-board.server.ts), senão o
    // número do card diverge da lista.
    const overrideLog = new Map<string, string>();
    const overrideRes = new Map<string, string>();
    for (const s of (statuses ?? []) as StatusRow[]) {
      if (s.log_id) touchedLog.add(`${s.kind}|${s.log_id}`);
      if (s.reservation_id) touchedRes.add(`${s.kind}|${s.reservation_id}`);
      if (s.arrival_date_override) {
        if (s.log_id) overrideLog.set(`${s.kind}|${s.log_id}`, s.arrival_date_override);
        if (s.reservation_id) overrideRes.set(`${s.kind}|${s.reservation_id}`, s.arrival_date_override);
      }
      // Concluído/Não compareceu saem da esteira, como no Kanban.
      if (s.status !== "done" && s.status !== "no_show" && !s.concluded_at) continue;
      if (s.log_id) doneLog.add(`${s.kind}|${s.log_id}`);
      if (s.reservation_id) doneRes.add(`${s.kind}|${s.reservation_id}`);
    }

    function countFor(col: "checkin_date" | "checkout_date", from: string, to: string) {
      const kind: "checkin" | "checkout" = col === "checkin_date" ? "checkin" : "checkout";
      const seen = new Set<string>();
      for (const r of resRows) {
        const date = overrideRes.get(`${kind}|${r.id}`) ?? r[col];
        if (date < from || date > to) continue;
        if (!icalProps.has(r.property_id) || !isRealReservation(r)) continue;
        if (doneRes.has(`${kind}|${r.id}`)) continue;
        // Datas passadas só contam se já houve interação registrada.
        if (date < today && !touchedRes.has(`${kind}|${r.id}`)) continue;
        seen.add(`ical|${r.id}`);
      }
      for (const row of logRows) {
        const v = overrideLog.get(`${kind}|${row.id}`) ?? row[col];
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

// ----- Estatísticas de limpeza (cards "Limpezas Realizadas" / "Custo Total Limpeza") -----
// Padrão "Hoje" (fuso de São Paulo), reinicia diariamente — mesmo padrão dos
// outros KPIs "tempo real" do dashboard — mas aceita um período e uma lista
// de imóveis explícitos: os filtros de Período/Proprietário/Cidade do
// dashboard também recalculam estes 2 cards, não só a agenda de ocupação.
// Conta limpezas concluídas (guest_arrival_status.kind="checkout" com
// cleaning_type preenchido) cujo "concluded_at" caiu dentro do intervalo, e
// soma o snapshot de preço gravado no momento da conclusão de cada uma.
export type CleaningBreakdownItem = {
  propertyId: string;
  propertyName: string;
  ownerName: string | null;
  propertyAddress: string | null;
  mapsUrl: string | null;
  garageMapsUrl: string | null;
  count: number;
  totalCents: number;
};
export type CleaningDailyPoint = { date: string; count: number; totalCents: number };

const CleaningStatsInput = z.object({
  ownerId: z.string().uuid().nullable().optional(),
  // ids já resolvidos no cliente a partir do filtro de Proprietário/Cidade
  // (ver ownerOptions/cityOptions em OperationWorkspace) — ausente quando
  // nenhum dos dois filtros está ativo (aí conta todos os imóveis acessíveis).
  propertyIds: z.array(z.string().uuid()).optional(),
  rangeStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  rangeEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const getCleaningStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CleaningStatsInput.parse(i ?? {}))
  .handler(async ({ data, context }) => {
    let propIds = await accessiblePropertyIds(context.supabase as never, data.ownerId ?? null, context.userId);
    if (data.propertyIds && data.propertyIds.length > 0) {
      const allowed = new Set(data.propertyIds);
      propIds = propIds.filter((id) => allowed.has(id));
    }
    const day0 = data.rangeStart ?? todayISO();
    const day1 = data.rangeEnd ?? day0;
    // Lista de dias do intervalo, pré-preenchida com zero — assim o gráfico
    // de tendência mostra todo dia do período, mesmo os sem limpeza.
    const emptyDaily: CleaningDailyPoint[] = [];
    for (let d = day0; d <= day1; d = addDaysISO(d, 1)) {
      emptyDaily.push({ date: d, count: 0, totalCents: 0 });
      if (emptyDaily.length > 366) break; // segurança: nunca itera indefinidamente
    }
    if (propIds.length === 0) {
      return { cleaningsDone: 0, totalCents: 0, breakdown: [] as CleaningBreakdownItem[], daily: emptyDaily };
    }
    // Brasil não observa mais horário de verão (abolido em 2019) — São Paulo
    // é sempre UTC-3, então "dia 00:00 SP" = "dia 03:00 UTC".
    const rangeStart = `${day0}T03:00:00.000Z`;
    const rangeEnd = `${addDaysISO(day1, 1)}T03:00:00.000Z`;

    const { data: rows, error } = await context.supabase
      .from("guest_arrival_status")
      .select("property_id, cleaning_type, cleaning_price_cents, concluded_at")
      .in("property_id", propIds)
      .eq("kind", "checkout")
      .not("cleaning_type", "is", null)
      .gte("concluded_at", rangeStart)
      .lt("concluded_at", rangeEnd)
      .limit(5000);
    if (error) throw new Error(error.message);

    type Row = {
      property_id: string;
      cleaning_type: string | null;
      cleaning_price_cents: number | null;
      concluded_at: string | null;
    };
    const list = (rows ?? []) as Row[];
    const cleaningsDone = list.length;
    const totalCents = list.reduce((sum, r) => sum + (r.cleaning_price_cents ?? 0), 0);

    // Série diária (gráficos "Limpezas por dia"/"Custo total por dia") — cada
    // registro cai no dia local (SP, UTC-3) do momento em que foi concluído.
    const dailyByDate = new Map(emptyDaily.map((p) => [p.date, p]));
    for (const r of list) {
      if (!r.concluded_at) continue;
      const localDate = new Date(new Date(r.concluded_at).getTime() - 3 * 3600_000).toISOString().slice(0, 10);
      const point = dailyByDate.get(localDate);
      if (point) {
        point.count += 1;
        point.totalCents += r.cleaning_price_cents ?? 0;
      }
    }
    const daily = Array.from(dailyByDate.values());

    // Detalhe por imóvel — alimenta o tooltip "quais imóveis foram
    // executados" nos cards "Limpezas Realizadas"/"Custo Total Limpeza"
    // (mesmo padrão do tooltip de engajamento) e o ranking "Top imóveis".
    const byProperty = new Map<string, { count: number; cents: number }>();
    for (const r of list) {
      const cur = byProperty.get(r.property_id) ?? { count: 0, cents: 0 };
      cur.count += 1;
      cur.cents += r.cleaning_price_cents ?? 0;
      byProperty.set(r.property_id, cur);
    }
    let breakdown: CleaningBreakdownItem[] = [];
    if (byProperty.size > 0) {
      const { data: props } = await context.supabase
        .from("properties")
        .select("id, name, address, maps_url, garage_maps_url, owner_contact_id")
        .in("id", Array.from(byProperty.keys()));
      type PropRow = {
        id: string;
        name: string | null;
        address: string | null;
        maps_url: string | null;
        garage_maps_url: string | null;
        owner_contact_id: string | null;
      };
      const propArr = (props ?? []) as PropRow[];
      const propById = new Map(propArr.map((p) => [p.id, p]));
      const ownerIds = Array.from(new Set(propArr.map((p) => p.owner_contact_id).filter((v): v is string => !!v)));
      const ownerNameById = new Map<string, string>();
      if (ownerIds.length > 0) {
        const { data: owners } = await context.supabase
          .from("property_owners")
          .select("id, name, trade_name")
          .in("id", ownerIds);
        for (const o of (owners ?? []) as Array<{ id: string; name: string | null; trade_name: string | null }>) {
          const label = (o.trade_name || o.name || "").trim();
          if (label) ownerNameById.set(o.id, label);
        }
      }
      breakdown = Array.from(byProperty.entries())
        .map(([propertyId, v]) => {
          const p = propById.get(propertyId);
          return {
            propertyId,
            propertyName: p?.name ?? "Imóvel",
            ownerName: p?.owner_contact_id ? (ownerNameById.get(p.owner_contact_id) ?? null) : null,
            propertyAddress: p?.address ?? null,
            mapsUrl: p?.maps_url ?? null,
            garageMapsUrl: p?.garage_maps_url ?? null,
            count: v.count,
            totalCents: v.cents,
          };
        })
        .sort((a, b) => b.count - a.count || a.propertyName.localeCompare(b.propertyName, "pt-BR"));
    }
    return { cleaningsDone, totalCents, breakdown, daily };
  });

// ----- Engagement -----

type EventRow = { property_id: string; guest_name: string | null; guest_phone: string | null };
type GuestMark = { name: string; property: string; owner?: string; time?: string | null };

const EngagementInput = z.object({
  range: z.enum(["today", "tomorrow", "7d", "30d"]).default("today"),
});

export const getGuideEngagement = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => EngagementInput.merge(ScopeInput.unwrap()).parse(i))
  .handler(async ({ data, context }) => {
    const propIds = await accessiblePropertyIds(context.supabase as never, data.ownerId ?? null, context.userId);
    if (propIds.length === 0) {
      return { guideOpens: 0, checkinTabOpens: 0, checkinsInPeriod: 0, codesTabOpens: 0, checkinsWithCodes: 0, checkinBreakdown: { viewed: [] as GuestMark[], notViewed: [] as GuestMark[] }, codesBreakdown: { viewed: [] as GuestMark[], notViewed: [] as GuestMark[] } };
    }
    const today = todayISO();
    let from = today;
    let to = today;
    // "Hoje" espelha o Kanban: inclui os check-ins ATRASADOS ainda pendentes
    // dentro da mesma janela operacional de 30 dias usada pelos cards.
    const overdueFrom = addDaysISO(today, -30);
    if (data.range === "today") {
      from = overdueFrom;
      to = today;
    } else if (data.range === "tomorrow") {
      from = addDaysISO(today, 1);
      to = from;
    } else if (data.range === "7d") {
      from = today;
      to = addDaysISO(today, 6);
    } else if (data.range === "30d") {
      from = today;
      to = addDaysISO(today, 29);
    }
    // Janela alargada: a previsão informada pelo anfitrião
    // (arrival_date_override) pode mover um check-in para dentro ou para fora
    // do período, então buscamos uma margem e filtramos em memória pela data
    // efetiva — exatamente como o Kanban e os cards de KPI fazem.
    const fetchFrom = addDaysISO(from, -30);
    const fetchTo = addDaysISO(to, 30);
    const [{ data: props }, { data: reservations }, { data: logs }, { data: allStatuses }] = await Promise.all([
      context.supabase
        .from("properties")
        .select("id, name, airbnb_ical_url, lock_code, gate_code, owner_contact_id, guide_created, checkin_instructions")
        .in("id", propIds),
      context.supabase
        .from("property_reservations")
        .select("id, property_id, checkin_date, checkout_date, status, raw_summary, guest_hint")
        .in("property_id", propIds)
        .eq("source", "airbnb")
        .gte("checkin_date", fetchFrom)
        .lte("checkin_date", fetchTo)
        .gte("checkout_date", today)
        .limit(5000),
      context.supabase
        .from("guide_access_logs")
        .select(
          "id, property_id, guest_name, guest_phone, guest_arrival_time, checkin_date, checkout_date, reservation_code, created_at",
        )
        .in("property_id", propIds)
        .gte("checkin_date", fetchFrom)
        .lte("checkin_date", fetchTo)
        .order("created_at", { ascending: true })
        .limit(2000),
      context.supabase
        .from("guest_arrival_status")
        .select("reservation_id, log_id, kind, status, arrival_date_override, concluded_at")
        .in("property_id", propIds)
        .eq("kind", "checkin")
        .limit(5000),
    ]);

    // Check-ins já concluídos (ou marcados como "não compareceu") saem da base
    // de engajamento — o quadrante segue apenas os check-ins PENDENTES, igual
    // aos cards do Kanban. Guardamos também a previsão de data informada e
    // quais registros já tiveram alguma interação: check-in de data passada só
    // continua contando quando alguém mexeu nele (mesma regra dos KPIs).
    const doneReservations = new Set<string>();
    const doneLogs = new Set<string>();
    const touchedReservations = new Set<string>();
    const touchedLogs = new Set<string>();
    const overrideReservation = new Map<string, string>();
    const overrideLog = new Map<string, string>();
    for (const s of (allStatuses ?? []) as Array<{
      reservation_id: string | null;
      log_id: string | null;
      status: string;
      arrival_date_override: string | null;
      concluded_at: string | null;
    }>) {
      if (s.reservation_id) touchedReservations.add(s.reservation_id);
      if (s.log_id) touchedLogs.add(s.log_id);
      if (s.arrival_date_override) {
        if (s.reservation_id) overrideReservation.set(s.reservation_id, s.arrival_date_override);
        if (s.log_id) overrideLog.set(s.log_id, s.arrival_date_override);
      }
      if (s.status !== "done" && s.status !== "no_show" && !s.concluded_at) continue;
      if (s.reservation_id) doneReservations.add(s.reservation_id);
      if (s.log_id) doneLogs.add(s.log_id);
    }

    // Data efetiva do check-in + regra de janela (inclui atrasados só quando
    // já houve interação registrada).
    function inWindow(date: string | null | undefined, touched: boolean): boolean {
      if (!date) return false;
      if (date < from || date > to) return false;
      if (date < today && !touched) return false;
      return true;
    }



    const icalProps = new Set(
      ((props ?? []) as Array<{ id: string; airbnb_ical_url: string | null }>)
        .filter((p) => !!p.airbnb_ical_url?.trim())
        .map((p) => p.id),
    );

    // Sem guia criado, não existe "instruções" nem "senhas" pra ninguém ver —
    // o imóvel nem deveria contar como candidato aos dois quadrantes abaixo.
    // "Viram instruções de check-in" só faz sentido para quem TEM guia criado
    // E instruções de check-in preenchidas — sem isso não há o que ver.
    const checkinInstructionsProps = new Set(
      ((props ?? []) as Array<{ id: string; guide_created?: boolean | null; checkin_instructions?: string | null }>)
        .filter((p) => !!p.guide_created && !!p.checkin_instructions?.trim())
        .map((p) => p.id),
    );

    type LogRow = {
      id: string;
      property_id: string;
      guest_name: string | null;
      guest_phone: string | null;
      guest_arrival_time?: string | null;
      checkin_date: string;
      checkout_date: string | null;
      reservation_code: string | null;
      created_at: string;
    };
    const allLogs = ((logs ?? []) as LogRow[]).filter((r) => !isPlaceholderGuest(r.guest_name));
    // Casamento reserva→hóspede (código HM + datas), a MESMA lógica usada
    // pelo Kanban (import dinâmico: arrival-board.server é server-only) —
    // sem isso, este agregado podia atribuir a reserva a um hóspede diferente
    // do que aparece no card, fazendo a barra do topo do Dashboard divergir
    // do "ENGAJAMENTO" mostrado no card daquele check-in.
    const { dedupeFormLogs, findLogsForReservation } = await import("@/lib/arrival-board.server");
    const uniqueLogs = dedupeFormLogs(allLogs);

    // Uma entrada por check-in PENDENTE do período (mesma base usada no contador).
    type Entry = { property_id: string; name: string; phone: string | null; time: string | null };
    const entries: Entry[] = [];

    for (const r of (reservations ?? []) as Array<{
      id: string;
      property_id: string;
      checkin_date: string | null;
      checkout_date: string | null;
      status: string | null;
      raw_summary: string | null;
      guest_hint: string | null;
    }>) {
      if (!icalProps.has(r.property_id) || !isRealReservation(r)) continue;
      const matched: LogRow | null =
        r.checkin_date && r.checkout_date
          ? findLogsForReservation(
              uniqueLogs,
              { property_id: r.property_id, checkin_date: r.checkin_date, checkout_date: r.checkout_date, guest_hint: r.guest_hint },
              "checkin",
            ).primary
          : null;
      if (doneReservations.has(r.id) || (matched && doneLogs.has(matched.id))) continue;
      const resTouched = touchedReservations.has(r.id) || (matched ? touchedLogs.has(matched.id) : false);
      const resDate =
        overrideReservation.get(r.id) ??
        (matched ? overrideLog.get(matched.id) : undefined) ??
        r.checkin_date;
      if (!inWindow(resDate, resTouched)) continue;
      entries.push({
        property_id: r.property_id,
        name: (matched?.guest_name || "").trim() || "Hóspede pendente",
        phone: matched?.guest_phone ?? null,
        time: matched?.guest_arrival_time ?? null,
      });
    }

    // Check-ins sem iCal (apenas logs de acesso), deduplicados.
    const seenFallback = new Set<string>();
    for (const l of allLogs) {
      if (icalProps.has(l.property_id)) continue;
      if (doneLogs.has(l.id)) continue;
      const logDate = overrideLog.get(l.id) ?? l.checkin_date;
      if (!inWindow(logDate, touchedLogs.has(l.id))) continue;
      const key = `${l.property_id}|${(l.guest_name || "").trim().toLowerCase()}|${(l.guest_phone || "").replace(/\D/g, "")}|${logDate ?? ""}`;

      if (seenFallback.has(key)) continue;
      seenFallback.add(key);
      entries.push({
        property_id: l.property_id,
        name: (l.guest_name || "").trim() || "Hóspede pendente",
        phone: l.guest_phone,
        time: l.guest_arrival_time ?? null,
      });
    }

    // "Viram instruções de check-in": só entram check-ins de imóveis com guia
    // criado E com as instruções de check-in de fato preenchidas.
    const checkinEntries = entries.filter((e) => checkinInstructionsProps.has(e.property_id));
    const checkinsInPeriod = checkinEntries.length;
    const guideOpens = allLogs.length;

    // Guias com senha de acesso (fechadura ou portão) configurada — e, como
    // acima, só conta quem já tem guia criado.
    const codesProps = new Set(
      ((props ?? []) as Array<{ id: string; guide_created?: boolean | null; lock_code: string | null; gate_code: string | null }>)
        .filter((p) => !!p.guide_created && !!(p.lock_code?.trim() || p.gate_code?.trim()))
        .map((p) => p.id),
    );
    const codeEntries = entries.filter((e) => codesProps.has(e.property_id));
    const checkinsWithCodes = codeEntries.length;

    // Aberturas por seção — sem janela de tempo: o hóspede costuma abrir o guia
    // dias antes do check-in, então filtrar por created_at zerava o engajamento.
    const { fetchEngagementSectionEvents } = await import("@/lib/engagement-events.server");
    const engagementEvents = await fetchEngagementSectionEvents(context.supabase, propIds, [
      "checkin-lido",
      "senhas",
      "senhas:lock",
      "senhas:gate",
    ]);
    // "Leu" = permaneceu ao menos 5s na aba Chegada (mesma regra dos cards).
    const evs = engagementEvents.filter((event) => event.section === "checkin-lido");
    const codeEvs = engagementEvents.filter((event) =>
      event.section === "senhas" || event.section === "senhas:lock" || event.section === "senhas:gate",
    );

    // Quem viu / quem não viu.
    const propRows = (props ?? []) as Array<{ id: string; name?: string | null; owner_contact_id?: string | null }>;
    const propName = new Map(propRows.map((p) => [p.id, p.name ?? ""]));
    // Nome do proprietário — usado para espelhar a ordenação dos cards do Kanban.
    const ownerIds = Array.from(new Set(propRows.map((p) => p.owner_contact_id).filter((v): v is string => !!v)));
    const ownerByProp = new Map<string, string>();
    if (ownerIds.length > 0) {
      const { data: owners } = await context.supabase
        .from("property_owners")
        .select("id, name, trade_name")
        .in("id", ownerIds);
      const label = new Map(
        ((owners ?? []) as Array<{ id: string; name: string | null; trade_name: string | null }>).map((o) => [
          o.id,
          (o.trade_name || o.name || "").trim(),
        ]),
      );
      for (const p of propRows) {
        if (p.owner_contact_id) ownerByProp.set(p.id, label.get(p.owner_contact_id) ?? "");
      }
    }
    const identity = (propertyId: string, name?: string | null, phone?: string | null) =>
      `${propertyId}|${(name || "").trim().toLowerCase()}|${(phone || "").replace(/\D/g, "")}`;
    const looseIdentity = (propertyId: string, name?: string | null) =>
      `${propertyId}|${(name || "").trim().toLowerCase()}`;

    function seenSets(rows: EventRow[] | null | undefined) {
      const strict = new Set<string>();
      const loose = new Set<string>();
      const phones = new Set<string>();
      for (const e of (rows ?? []) as EventRow[]) {
        if (!e.property_id) continue;
        strict.add(identity(e.property_id, e.guest_name, e.guest_phone));
        if ((e.guest_name || "").trim()) loose.add(looseIdentity(e.property_id, e.guest_name));
        const digits = (e.guest_phone || "").replace(/\D/g, "");
        if (digits.length >= 8) phones.add(`${e.property_id}|${digits.slice(-8)}`);
      }
      return { strict, loose, phones };
    }
    const checkinSeen = seenSets(evs as EventRow[] | null);
    // Senhas: só conta como "viu" quem abriu TODAS as senhas de acesso
    // configuradas no imóvel (fechadura e/ou portão). Wi-Fi não entra.
    const codeEvRows = codeEvs as Array<EventRow & { section?: string }>;
    const codesSeen = seenSets(codeEvRows);
    const lockSeen = seenSets(codeEvRows.filter((e) => e.section === "senhas:lock"));
    const gateSeen = seenSets(codeEvRows.filter((e) => e.section === "senhas:gate"));
    const accessCodesByProp = new Map<string, Array<"lock" | "gate">>();
    for (const p of (props ?? []) as Array<{ id: string; lock_code: string | null; gate_code: string | null }>) {
      const codes: Array<"lock" | "gate"> = [];
      if (p.lock_code?.trim()) codes.push("lock");
      if (p.gate_code?.trim()) codes.push("gate");
      accessCodesByProp.set(p.id, codes);
    }

    type Seen = { strict: Set<string>; loose: Set<string>; phones: Set<string> };
    const seenHas = (seen: Seen, propertyId: string, name: string, phone: string | null) => {
      const digits = (phone || "").replace(/\D/g, "");
      return (
        seen.strict.has(identity(propertyId, name, phone)) ||
        seen.loose.has(looseIdentity(propertyId, name)) ||
        (digits.length >= 8 && seen.phones.has(`${propertyId}|${digits.slice(-8)}`))
      );
    };
    /** Viu todas as senhas de acesso configuradas no imóvel. */
    const sawAllCodes = (propertyId: string, name: string, phone: string | null) => {
      const codes = accessCodesByProp.get(propertyId) ?? [];
      if (codes.length === 0) return true;
      // Eventos antigos gravavam apenas "senhas" (sem detalhar qual).
      if (codes.length === 1 && seenHas(codesSeen, propertyId, name, phone)) return true;
      return codes.every((c) => seenHas(c === "lock" ? lockSeen : gateSeen, propertyId, name, phone));
    };

    function breakdown(
      seen: { strict: Set<string>; loose: Set<string>; phones: Set<string> },
      list: Entry[],
      hitFn?: (propertyId: string, name: string, phone: string | null) => boolean,
    ) {
      type Item = { mark: GuestMark; propertyId: string };
      const viewed: Item[] = [];
      const notViewed: Item[] = [];
      for (const e of list) {
        const mark: GuestMark = {
          name: e.name,
          property: propName.get(e.property_id) || "",
          owner: ownerByProp.get(e.property_id) || "",
          time: e.time ?? null,
        };
        const hit =
          e.name !== "Hóspede pendente" &&
          (hitFn ? hitFn(e.property_id, e.name, e.phone) : seenHas(seen, e.property_id, e.name, e.phone));
        (hit ? viewed : notViewed).push({ mark, propertyId: e.property_id });
      }
      // Mesma ordenação dos cards do Kanban: horário previsto (mais cedo
      // primeiro, sem horário por último) → proprietário A→Z → anúncio A→Z.
      // Dentro do imóvel mantém a ordem de acesso (1º a acessar = principal).
      const txt = (a?: string | null, b?: string | null) =>
        (a ?? "").localeCompare(b ?? "", "pt-BR", { sensitivity: "base" });
      const sortMarks = (items: Item[]) => {
        const earliest = new Map<string, string | null>();
        items.forEach(({ mark, propertyId }, i) => {
          const cur = earliest.get(propertyId);
          if (!earliest.has(propertyId) || (mark.time && (!cur || mark.time < cur))) {
            earliest.set(propertyId, mark.time ?? cur ?? null);
          }
          void i;
        });
        return items
          .map((it, i) => ({ it, i }))
          .sort((a, b) => {
            const ta = earliest.get(a.it.propertyId) ?? null;
            const tb = earliest.get(b.it.propertyId) ?? null;
            if (ta && tb && ta !== tb) return ta.localeCompare(tb);
            if (!!ta !== !!tb) return ta ? -1 : 1;
            return (
              txt(a.it.mark.owner, b.it.mark.owner) || txt(a.it.mark.property, b.it.mark.property) || a.i - b.i
            );
          })
          .map((x) => x.it.mark);
      };
      return { viewed: sortMarks(viewed), notViewed: sortMarks(notViewed) };
    }

    const checkinBreakdown = breakdown(checkinSeen, checkinEntries);
    const codesBreakdown = breakdown(codesSeen, codeEntries, sawAllCodes);

    return {
      guideOpens,
      checkinTabOpens: checkinBreakdown.viewed.length,
      checkinsInPeriod,
      codesTabOpens: codesBreakdown.viewed.length,
      checkinsWithCodes,
      checkinBreakdown,
      codesBreakdown,
    };
  });




// ----- Arrivals list -----

const ListInput = z.object({
  kind: z.enum(["checkin", "checkout"]).default("checkin"),
  range: z.enum(["today", "tomorrow", "7d", "all"]).default("today"),
  ownerId: z.string().uuid().nullable().optional(),
});

export type { ArrivalRow } from "@/lib/dashboard-arrival-types";
import type { ArrivalRow } from "@/lib/dashboard-arrival-types";


export const listDashboardArrivals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ListInput.parse(i))
  .handler(async ({ data, context }): Promise<{ rows: ArrivalRow[] }> => {
    const propIds = await accessiblePropertyIds(context.supabase as never, data.ownerId ?? null, context.userId);
    if (propIds.length === 0) return { rows: [] };
    const { buildArrivalRows } = await import("@/lib/arrival-board.server");
    return await buildArrivalRows(context.supabase as never, { kind: data.kind, range: data.range, propIds });
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
    arrivalDateOverride: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    mutedUntil: z.string().datetime().nullable().optional(),
  })
  .refine((v) => !!v.logId || !!v.reservationId, { message: "Informe a reserva ou o registro do hóspede." });

export const upsertArrivalStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UpsertInput.parse(i))
  .handler(async ({ data, context }) => {
    let propertyId: string | null = null;
    // Datas confirmadas da estadia (reserva quando disponível, senão o
    // registro do guia) — usadas abaixo pra validar a previsão no servidor,
    // não só no seletor do navegador (que dá pra contornar). Pedido
    // explícito, 04/09/2026: checkin nunca antes da reserva; checkout nunca
    // depois da reserva confirmada.
    let stayCheckinDate: string | null = null;
    let stayCheckoutDate: string | null = null;
    if (data.reservationId) {
      const { data: reservation, error: reservationErr } = await context.supabase
        .from("property_reservations")
        .select("id, property_id, checkin_date, checkout_date")
        .eq("id", data.reservationId)
        .maybeSingle();
      if (reservationErr || !reservation) throw new Error("Reserva não encontrada.");
      const res = reservation as { property_id: string; checkin_date: string; checkout_date: string };
      propertyId = res.property_id;
      stayCheckinDate = res.checkin_date;
      stayCheckoutDate = res.checkout_date;
    } else if (data.logId) {
      const { data: log, error: logErr } = await context.supabase
        .from("guide_access_logs")
        .select("id, property_id, checkin_date, checkout_date")
        .eq("id", data.logId)
        .maybeSingle();
      if (logErr || !log) throw new Error("Registro não encontrado.");
      const l = log as { property_id: string; checkin_date: string; checkout_date: string | null };
      propertyId = l.property_id;
      stayCheckinDate = l.checkin_date;
      stayCheckoutDate = l.checkout_date;
    }
    if (!propertyId) throw new Error("Registro não encontrado.");

    // Trava no servidor a mesma regra do seletor de data no Kanban (não é só
    // enfeite do navegador — sem isso, nada impede um bypass): checkin não
    // pode ser previsto ANTES da data confirmada da reserva (chegar depois é
    // permitido); checkout não pode ser previsto DEPOIS da data confirmada
    // (sair antes é permitido, mas "esticar" a estadia sozinho por aqui não).
    if (typeof data.arrivalDateOverride === "string" && stayCheckinDate) {
      if (data.kind === "checkin" && data.arrivalDateOverride < stayCheckinDate) {
        throw new Error("A previsão de check-in não pode ser antes da data confirmada da reserva.");
      }
      if (data.kind === "checkout" && data.arrivalDateOverride < stayCheckinDate) {
        throw new Error("A previsão de check-out não pode ser antes do check-in.");
      }
      if (data.kind === "checkout" && stayCheckoutDate && data.arrivalDateOverride > stayCheckoutDate) {
        throw new Error("A previsão de check-out não pode ser depois da data confirmada da reserva.");
      }
      // Mesmo teto já aplicado no seletor do Kanban: check-in não pode cair
      // no dia do check-out (ou depois) — não faz sentido entrar e sair no
      // mesmo dia previsto como check-out.
      if (data.kind === "checkin" && stayCheckoutDate && data.arrivalDateOverride >= stayCheckoutDate) {
        throw new Error("A previsão de check-in não pode ser no dia do check-out ou depois.");
      }
    }

    const patch: {
      log_id?: string;
      reservation_id?: string;
      property_id: string;
      kind: "checkin" | "checkout";
      status?: "pending" | "done";
      done_at?: string | null;
      note?: string | null;
      arrival_time_override?: string | null;
      arrival_date_override?: string | null;
      muted_until?: string | null;
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
    if (typeof data.arrivalDateOverride !== "undefined") patch.arrival_date_override = data.arrivalDateOverride;
    if (typeof data.mutedUntil !== "undefined") patch.muted_until = data.mutedUntil;


    // Upsert atômico direto no banco quando só 1 identificador está
    // disponível (o caso mais comum) — em vez de "buscar se existe, depois
    // decidir insert ou update", que tinha uma janela de corrida real: dois
    // cliques quase simultâneos podiam os dois "não encontrar" a linha
    // existente e os dois tentarem inserir, criando duplicata.
    //
    // Quando os DOIS identificadores estão disponíveis (reserva iCal já
    // casada com um log de acesso), um upsert atômico mirando só UM
    // onConflict não é seguro: a linha já pode existir criada ANTES do
    // casamento, com só um dos dois IDs setado — mirar só reservation_id
    // (ou só log_id) não encontra essa linha e tenta inserir de novo,
    // violando a constraint única do OUTRO identificador. Foi exatamente
    // isso que causou o erro real "duplicate key value violates unique
    // constraint guest_arrival_status_log_id_kind_key" ao concluir uma
    // limpeza. Nesse caso (só quando os dois IDs coexistem) vale a consulta
    // extra pra buscar por QUALQUER um dos dois antes de decidir.
    if (data.logId && data.reservationId) {
      const { data: existing, error: findErr } = await context.supabase
        .from("guest_arrival_status")
        .select("id")
        .eq("kind", data.kind)
        .or(`log_id.eq.${data.logId},reservation_id.eq.${data.reservationId}`)
        .limit(1);
      if (findErr) throw new Error(findErr.message);
      const existingId = (existing?.[0] as { id: string } | undefined)?.id;
      const { error } = existingId
        ? await context.supabase.from("guest_arrival_status").update(patch).eq("id", existingId)
        : await context.supabase.from("guest_arrival_status").insert(patch);
      if (error) throw new Error(error.message);
      return { ok: true };
    }

    const { error } = data.reservationId
      ? await context.supabase
          .from("guest_arrival_status")
          .upsert(patch, { onConflict: "reservation_id,kind" })
      : await context.supabase
          .from("guest_arrival_status")
          .upsert(patch, { onConflict: "log_id,kind" });
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
    // Tipo de limpeza escolhido pela pessoa no momento em que conclui a
    // faxina (pergunta feita na hora do avanço "cleaning" → "Concluído").
    // Opcional para não quebrar chamadas antigas/outros "from"; quando
    // ausente no avanço de limpeza, cai no fallback "normal".
    cleaningType: z.enum(["normal", "completa"]).optional(),
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
    // A reserva do iCal é a fonte AUTORITATIVA das datas da estadia: o
    // formulário do hóspede (guide_access_logs) frequentemente traz a data de
    // saída errada/desatualizada. Quando os dois existem, as datas da reserva
    // mandam — sem isso, um checkout de HOJE casado com um log antigo era
    // tratado como "limpeza vencida" e o card ia direto para Concluídos,
    // sumindo da Fila de Limpeza.
    if (data.reservationId) {
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
        cleaning_type?: "normal" | "completa" | null;
        cleaning_price_cents?: number | null;
      },
    ) {
      const body: {
        property_id: string;
        kind: "checkin" | "checkout";
        log_id?: string;
        reservation_id?: string;
        status?: "pending" | "done";
        done_at?: string | null;
        concluded_at?: string | null;
        cleaning_type?: "normal" | "completa" | null;
        cleaning_price_cents?: number | null;
      } = { property_id: propertyId!, kind, ...patch };
      if (data.logId) body.log_id = data.logId;
      if (data.reservationId) body.reservation_id = data.reservationId;

      // Ver upsertArrivalStatus (mais acima neste arquivo) para a explicação
      // completa: upsert atômico quando só 1 identificador existe (evita a
      // janela de corrida de "buscar depois decidir" entre 2 cliques quase
      // simultâneos); quando os DOIS coexistem (reserva iCal já casada com
      // um log), busca por QUALQUER um dos dois antes de decidir — um
      // onConflict só não é seguro nesse caso (bug real: "duplicate key
      // value violates unique constraint guest_arrival_status_log_id_kind_key"
      // ao concluir limpeza de um card já casado com log + reserva).
      if (data.logId && data.reservationId) {
        const { data: existing, error: findErr } = await context.supabase
          .from("guest_arrival_status")
          .select("id")
          .eq("kind", kind)
          .or(`log_id.eq.${data.logId},reservation_id.eq.${data.reservationId}`)
          .limit(1);
        if (findErr) throw new Error(findErr.message);
        const existingId = (existing?.[0] as { id: string } | undefined)?.id;
        const { error } = existingId
          ? await context.supabase.from("guest_arrival_status").update(body).eq("id", existingId)
          : await context.supabase.from("guest_arrival_status").insert(body);
        if (error) throw new Error(error.message);
        return;
      }

      const { error } = data.reservationId
        ? await context.supabase
            .from("guest_arrival_status")
            .upsert(body, { onConflict: "reservation_id,kind" })
        : await context.supabase
            .from("guest_arrival_status")
            .upsert(body, { onConflict: "log_id,kind" });
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
      // Trava operacional: não é possível dar check-in num imóvel que ainda
      // tem a estadia anterior em aberto (checkout pendente ou limpeza não
      // concluída). Isso já é bloqueado na tela, mas a tela só enxerga os
      // cards do filtro atual — a regra precisa valer no servidor.
      const { data: openCheckouts } = await context.supabase
        .from("guest_arrival_status")
        .select("log_id, reservation_id, status, concluded_at")
        .eq("property_id", propertyId)
        .eq("kind", "checkout")
        .is("concluded_at", null);

      const others = (openCheckouts ?? []).filter((r) => {
        const row = r as { log_id: string | null; reservation_id: string | null };
        if (data.logId && row.log_id === data.logId) return false;
        if (data.reservationId && row.reservation_id === data.reservationId) return false;
        return true;
      }) as Array<{ log_id: string | null; reservation_id: string | null; status: string }>;

      if (others.length > 0) {
        // Qualquer estadia anterior ainda em aberto (hóspede no imóvel ou
        // limpeza não concluída) bloqueia o novo check-in — a esteira é
        // sequencial: chegada → estadia → saída → limpeza → concluído.
        const blocking = others[0];



        if (blocking) {
          throw new Error(
            blocking.status === "done"
              ? "Este imóvel ainda está em limpeza. Conclua a limpeza da estadia anterior antes de liberar o check-in."
              : "Este imóvel ainda tem um check-out pendente. Finalize a saída e a limpeza antes de liberar o check-in.",
          );
        }
      }

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
      //
      // Snapshot do tipo/valor de limpeza: a pessoa é questionada na tela no
      // momento do avanço sobre qual limpeza foi realizada (normal/completa).
      // Gravamos o preço vigente do imóvel NAQUELE momento — se o valor
      // configurado mudar depois, os totais já registrados não se alteram.
      const cleaningType = data.cleaningType ?? "normal";
      const { data: propPrices } = await context.supabase
        .from("properties")
        .select("cleaning_price_normal_cents, cleaning_price_full_cents")
        .eq("id", propertyId)
        .maybeSingle();
      const cleaningPriceCents =
        cleaningType === "completa"
          ? ((propPrices as { cleaning_price_full_cents: number | null } | null)?.cleaning_price_full_cents ?? null)
          : ((propPrices as { cleaning_price_normal_cents: number | null } | null)?.cleaning_price_normal_cents ?? null);

      await upsertStatus("checkout", {
        status: "done",
        done_at: nowIso,
        concluded_at: nowIso,
        cleaning_type: cleaningType,
        cleaning_price_cents: cleaningPriceCents,
      });
      await upsertStatus("checkin", { status: "done", concluded_at: nowIso });
    }

    // Notificações de limpeza (não bloqueiam a resposta em caso de falha).
    try {
      const refKey = data.reservationId ?? data.logId ?? today;
      const isCheckoutConfirmed =
        data.from === "stay" ||
        data.from === "checkout" ||
        (data.from === "checkin" && !!checkoutDate && today > checkoutDate);
      if ((isCheckoutConfirmed && !cleaningStale) || data.from === "cleaning") {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { notifyCleaningReady, notifyCleaningDone } = await import("@/lib/ops-push.server");
        if (data.from === "cleaning") {
          await notifyCleaningDone(supabaseAdmin as never, {
            propertyId,
            refKey,
            byUserId: context.userId,
          });
        } else {
          await notifyCleaningReady(supabaseAdmin as never, { propertyId, refKey });
        }
      }
    } catch (err) {
      console.error("[advanceArrival] falha ao enviar push de limpeza:", err);
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
    // "no_show" desfaz o "Não Compareceu" (ver markNoShow logo abaixo) — o
    // card volta pra Chegadas, mesmo racional de "stay"/"checkout" (undo do
    // checkin.done), só que aqui a linha nunca tinha status "done" pra
    // começo de conversa: era "no_show".
    from: z.enum(["checkout", "stay", "cleaning", "done", "no_show"]),
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

    if (data.from === "stay" || data.from === "checkout" || data.from === "no_show") {
      // Back to Chegadas: undo checkin.done (ou checkin.no_show).
      const id = await findId("checkin");
      if (id) {
        const { error } = await context.supabase
          .from("guest_arrival_status")
          .update({ status: "pending", done_at: null, concluded_at: null })
          .eq("id", id);
        if (error) throw new Error(error.message);
      } else {
        // Sem status persistido (o card foi promovido virtualmente a "Em Estadia"
        // porque a estadia já estava em andamento na importação). Grava uma
        // linha pending para que o "voltar" fique efetivo e não seja
        // sobrescrito pela auto-promoção na próxima leitura.
        let propertyId: string | null = null;
        if (data.reservationId) {
          const { data: res } = await context.supabase
            .from("property_reservations")
            .select("property_id")
            .eq("id", data.reservationId)
            .maybeSingle();
          propertyId = (res as { property_id: string } | null)?.property_id ?? null;
        }
        if (!propertyId && data.logId) {
          const { data: log } = await context.supabase
            .from("guide_access_logs")
            .select("property_id")
            .eq("id", data.logId)
            .maybeSingle();
          propertyId = (log as { property_id: string } | null)?.property_id ?? null;
        }
        if (propertyId) {
          const body: {
            property_id: string;
            kind: "checkin";
            status: "pending";
            log_id?: string;
            reservation_id?: string;
          } = { property_id: propertyId, kind: "checkin", status: "pending" };
          if (data.logId) body.log_id = data.logId;
          if (data.reservationId) body.reservation_id = data.reservationId;
          const { error } = await context.supabase
            .from("guest_arrival_status")
            .upsert(body, {
              onConflict: data.reservationId ? "reservation_id,kind" : "log_id,kind",
            });
          if (error) throw new Error(error.message);
        }
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
    } else if (data.from === "done") {
      // Concluído → volta para Em Limpeza: mantém o check-out como feito,
      // apenas remove a conclusão da esteira.
      for (const kind of ["checkout", "checkin"] as const) {
        const id = await findId(kind);
        if (!id) continue;
        const { error } = await context.supabase
          .from("guest_arrival_status")
          .update({ concluded_at: null })
          .eq("id", id);
        if (error) throw new Error(error.message);
      }
    }
    return { ok: true };
  });

// ----- "Não Compareceu" (no-show) -----
// Pedido explícito, 05/09/2026: um card de Check-ins pode ser marcado como
// "Não Compareceu" pelo menu "⋮". Ele sai da esteira normal (nunca mais
// aparece em Check-ins/Estadia/Checkouts/Limpeza) e passa a viver numa
// coluna própria (ver listNoShowArrivals). Importante: como isso NUNCA cria
// uma linha kind="checkout", a trava operacional de advanceArrival (que só
// enxerga checkout aberto do mesmo imóvel) não tem o que bloquear — o imóvel
// já fica liberado pro próximo check-in imediatamente, sem precisar de
// nenhuma lógica extra de "pular limpeza".
const NoShowInput = z
  .object({
    logId: z.string().uuid().optional(),
    reservationId: z.string().uuid().optional(),
  })
  .refine((v) => !!v.logId || !!v.reservationId, { message: "Informe a reserva ou o registro do hóspede." });

export const markNoShow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => NoShowInput.parse(i))
  .handler(async ({ data, context }) => {
    let propertyId: string | null = null;
    if (data.logId) {
      const { data: log } = await context.supabase
        .from("guide_access_logs")
        .select("property_id")
        .eq("id", data.logId)
        .maybeSingle();
      propertyId = (log as { property_id: string } | null)?.property_id ?? null;
    }
    if (!propertyId && data.reservationId) {
      const { data: res } = await context.supabase
        .from("property_reservations")
        .select("property_id")
        .eq("id", data.reservationId)
        .maybeSingle();
      propertyId = (res as { property_id: string } | null)?.property_id ?? null;
    }
    if (!propertyId) throw new Error("Registro não encontrado.");

    const nowIso = new Date().toISOString();
    // IMPORTANTE: NÃO gravar done_at aqui. Vários lugares do sistema tratam
    // "done_at preenchido" como sinônimo de "check-in de verdade aconteceu"
    // (ex.: src/lib/ai/context.server.ts e a checagem que o próprio hóspede
    // usa no guia, em guide-access.functions.ts — ambos fazem
    // `status === "done" || !!done_at`). Se gravássemos done_at aqui, um
    // hóspede que nunca chegou passaria a aparecer como "check-in
    // confirmado" pro assistente de IA e até pro próprio guia do hóspede —
    // exatamente o oposto do que "Não Compareceu" significa. concluded_at
    // sozinho já basta pra ordenar a lista (ver listNoShowArrivals) e pra
    // tirar o card de qualquer lista "em aberto".
    const body: {
      property_id: string;
      kind: "checkin";
      log_id?: string;
      reservation_id?: string;
      status: string;
      concluded_at: string;
    } = { property_id: propertyId, kind: "checkin", status: "no_show", concluded_at: nowIso };
    if (data.logId) body.log_id = data.logId;
    if (data.reservationId) body.reservation_id = data.reservationId;

    // Mesmo racional de upsertStatus (advanceArrival, mais acima): quando os
    // DOIS identificadores coexistem, busca por QUALQUER um dos dois antes de
    // decidir insert/update — um onConflict só não é seguro nesse caso (ver
    // comentário completo lá em cima).
    if (data.logId && data.reservationId) {
      const { data: existing, error: findErr } = await context.supabase
        .from("guest_arrival_status")
        .select("id")
        .eq("kind", "checkin")
        .or(`log_id.eq.${data.logId},reservation_id.eq.${data.reservationId}`)
        .limit(1);
      if (findErr) throw new Error(findErr.message);
      const existingId = (existing?.[0] as { id: string } | undefined)?.id;
      const { error } = existingId
        ? await context.supabase.from("guest_arrival_status").update(body).eq("id", existingId)
        : await context.supabase.from("guest_arrival_status").insert(body);
      if (error) throw new Error(error.message);
    } else {
      const { error } = data.reservationId
        ? await context.supabase.from("guest_arrival_status").upsert(body, { onConflict: "reservation_id,kind" })
        : await context.supabase.from("guest_arrival_status").upsert(body, { onConflict: "log_id,kind" });
      if (error) throw new Error(error.message);
    }

    return { ok: true };
  });

// ----- Agenda macro de ocupação (visão de todos os imóveis) -----

export type OccupancyStay = {
  propertyId: string;
  checkin: string;
  checkout: string | null;
  guest: string | null;
  // Check-in já confirmado (guest_arrival_status kind="checkin" status="done")?
  // Usado só pra colorir a agenda: pendente = azul claro, confirmado = verde.
  checkinDone: boolean;
  // Mesma ideia para o checkout (guest_arrival_status kind="checkout" status="done").
  checkoutDone: boolean;
};

export const getOccupancyBoard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        ownerId: z.string().uuid().nullable().optional(),
        days: z.number().int().min(3).max(90).optional(),
        start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
      .optional()
      .parse(i) ?? {},
  )
  .handler(async ({ data, context }) => {
    const days = data.days ?? 14;
    const start = data.start ?? todayISO();
    const end = addDaysISO(start, days - 1);
    const propIds = await accessiblePropertyIds(context.supabase as never, data.ownerId ?? null, context.userId);
    if (propIds.length === 0) {
      return { start, days, properties: [], stays: [] as OccupancyStay[], freeToday: [] as Array<{ id: string; name: string }> };
    }

    // Mesma fonte da verdade do Kanban: garante que alterações de reserva no
    // iCal (ex.: checkout adiado) apareçam também no calendário de ocupação.
    const { syncStaleIcals } = await import("@/lib/arrival-board.server");
    await syncStaleIcals(context.supabase as never, propIds);

    const [
      { data: props },
      { data: reservations },
      { data: logs },
      { data: checkinStatuses },
      { data: checkoutStatuses },
    ] = await Promise.all([
      context.supabase.from("properties").select("id, name, city, owner_contact_id").in("id", propIds).order("name"),
      context.supabase
        .from("property_reservations")
        .select("id, property_id, checkin_date, checkout_date, guest_hint, status, raw_summary")
        .in("property_id", propIds)
        .eq("source", "airbnb")
        .lte("checkin_date", end)
        .gte("checkout_date", start)
        .limit(5000),
      context.supabase
        .from("guide_access_logs")
        .select("id, property_id, checkin_date, checkout_date, guest_name, reservation_code")
        .in("property_id", propIds)
        .lte("checkin_date", end)
        .gte("checkout_date", start)
        .limit(5000),
      // Status de check-in (pendente/confirmado) — usado só pra colorir a
      // agenda (azul claro = pendente, verde = confirmado), mesma lógica do
      // Kanban/getDashboardKpis.
      context.supabase
        .from("guest_arrival_status")
        .select("log_id, reservation_id, status")
        .eq("kind", "checkin")
        .in("property_id", propIds)
        .limit(5000),
      // Status de checkout (pendente/confirmado) — mesma ideia, agora também
      // usado pra colorir a agenda com os 3 estados de checkout.
      context.supabase
        .from("guest_arrival_status")
        .select("log_id, reservation_id, status")
        .eq("kind", "checkout")
        .in("property_id", propIds)
        .limit(5000),
    ]);

    const doneCheckinRes = new Set<string>();
    const doneCheckinLog = new Set<string>();
    for (const s of (checkinStatuses ?? []) as Array<{
      log_id: string | null;
      reservation_id: string | null;
      status: string;
    }>) {
      if (s.status !== "done") continue;
      if (s.reservation_id) doneCheckinRes.add(s.reservation_id);
      if (s.log_id) doneCheckinLog.add(s.log_id);
    }

    const doneCheckoutRes = new Set<string>();
    const doneCheckoutLog = new Set<string>();
    for (const s of (checkoutStatuses ?? []) as Array<{
      log_id: string | null;
      reservation_id: string | null;
      status: string;
    }>) {
      if (s.status !== "done") continue;
      if (s.reservation_id) doneCheckoutRes.add(s.reservation_id);
      if (s.log_id) doneCheckoutLog.add(s.log_id);
    }

    const normalizeCode = (s: string | null | undefined): string | null => {
      if (!s) return null;
      const m = String(s).match(/HM[A-Z0-9]{6,}/i);
      return m ? m[0].toUpperCase() : null;
    };

    const logRows = ((logs ?? []) as Array<{
      id: string;
      property_id: string;
      checkin_date: string;
      checkout_date: string | null;
      guest_name: string | null;
      reservation_code: string | null;
    }>).filter((l) => (l.guest_name ?? "").trim().toLowerCase() !== "hóspede pendente");

    const stays: OccupancyStay[] = [];
    const reservationRows = ((reservations ?? []) as Array<{
      id: string;
      property_id: string;
      checkin_date: string;
      checkout_date: string | null;
      guest_hint: string | null;
      status: string | null;
      raw_summary: string | null;
    }>).filter(isRealReservation);

    const consumedLogs = new Set<(typeof logRows)[number]>();
    for (const r of reservationRows) {
      const resCode = normalizeCode(r.guest_hint);
      // A reserva manda nas DATAS; o log só contribui com o nome do hóspede.
      const match =
        logRows.find(
          (l) =>
            l.property_id === r.property_id && !!resCode && normalizeCode(l.reservation_code) === resCode,
        ) ??
        logRows.find(
          (l) =>
            l.property_id === r.property_id &&
            l.checkin_date === r.checkin_date &&
            l.checkout_date === r.checkout_date,
        ) ??
        logRows.find((l) => l.property_id === r.property_id && l.checkin_date === r.checkin_date);
      if (match) consumedLogs.add(match);
      stays.push({
        propertyId: r.property_id,
        checkin: r.checkin_date,
        checkout: r.checkout_date,
        guest: match?.guest_name ?? r.guest_hint,
        checkinDone: doneCheckinRes.has(r.id) || (!!match && doneCheckinLog.has(match.id)),
        checkoutDone: doneCheckoutRes.has(r.id) || (!!match && doneCheckoutLog.has(match.id)),
      });
    }

    for (const l of logRows) {
      if (consumedLogs.has(l)) continue;
      // Ignora logs cujo período se sobrepõe a uma reserva já mapeada — a
      // reserva (iCal) é sempre a versão atual do período.
      const overlaps = reservationRows.some(
        (r) =>
          r.property_id === l.property_id &&
          r.checkin_date < (l.checkout_date ?? l.checkin_date) &&
          (r.checkout_date ?? r.checkin_date) > l.checkin_date,
      );
      if (overlaps) continue;
      stays.push({
        propertyId: l.property_id,
        checkin: l.checkin_date,
        checkout: l.checkout_date,
        guest: l.guest_name,
        checkinDone: doneCheckinLog.has(l.id),
        checkoutDone: doneCheckoutLog.has(l.id),
      });
    }


    const propsRaw = (props ?? []) as Array<{
      id: string;
      name: string | null;
      city: string | null;
      owner_contact_id?: string | null;
    }>;
    const occOwnerIds = Array.from(
      new Set(propsRaw.map((p) => p.owner_contact_id).filter((v): v is string => !!v)),
    );
    const occOwnerName = new Map<string, string>();
    if (occOwnerIds.length > 0) {
      const { data: owners } = await context.supabase
        .from("property_owners")
        .select("id, name, trade_name")
        .in("id", occOwnerIds);
      for (const o of (owners ?? []) as Array<{ id: string; name: string | null; trade_name: string | null }>) {
        const label = (o.trade_name || o.name || "").trim();
        if (label) occOwnerName.set(o.id, label);
      }
    }

    const properties = propsRaw.map((p) => ({
      id: p.id,
      name: p.name ?? "Sem nome",
      city: p.city ?? null,
      ownerName: p.owner_contact_id ? (occOwnerName.get(p.owner_contact_id) ?? null) : null,
    }));

    // Um imóvel cujo checkout é hoje só passa a contar como "livre" após o horário
    // padrão de checkout (11h no fuso local). Antes disso, ele ainda está ocupado.
    const nowHour = Number(
      new Intl.DateTimeFormat("pt-BR", {
        hour: "2-digit",
        hour12: false,
        timeZone: "America/Sao_Paulo",
      }).format(new Date()),
    );
    const beforeCheckoutHour = Number.isFinite(nowHour) ? nowHour < 11 : true;
    const occupiedToday = new Set(
      stays
        .filter((s) => {
          const out = s.checkout ?? s.checkin;
          if (s.checkin <= start && out > start) return true;
          // checkout marcado para hoje: ainda ocupado até o horário padrão de saída
          return s.checkin <= start && out === start && beforeCheckoutHour;
        })
        .map((s) => s.propertyId),
    );
    const freeToday = properties
      .filter((p) => !occupiedToday.has(p.id))
      .map((p) => ({ id: p.id, name: p.name }));

    return { start, days, properties, stays, freeToday };
  });

// ----- Concluídos: cards que já percorreram toda a esteira -----

// Igual ao ScopeInput, só que com um campo de busca a mais: por padrão a
// lista de Concluídos só traz os 200 mais recentes (evita carregar a conta
// inteira sempre que a tela abre) — só que, numa operação com muitas
// limpezas por dia, um card concluído há mais tempo simplesmente some da
// lista sem nenhum aviso, mesmo estando lá no banco. Quando `q` vem
// preenchido, soltamos esse limite (até um teto bem mais folgado) e
// filtramos por hóspede/imóvel/proprietário/código da reserva, pra sempre
// ser possível achar um card específico e usar o "Desfazer".
const ConcludedInput = z
  .object({
    ownerId: z.string().uuid().nullable().optional(),
    q: z.string().trim().max(120).optional(),
  })
  .optional();

export const listConcludedArrivals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ConcludedInput.parse(i))
  .handler(async ({ data, context }): Promise<{ rows: ArrivalRow[] }> => {
    const propIds = await accessiblePropertyIds(context.supabase as never, data?.ownerId ?? null, context.userId);
    if (propIds.length === 0) return { rows: [] };

    const searching = !!data?.q && data.q.trim().length > 0;

    const { data: statuses } = await context.supabase
      .from("guest_arrival_status")
      .select("log_id, reservation_id, property_id, note, arrival_time_override, done_at, concluded_at")
      .in("property_id", propIds)
      .eq("kind", "checkout")
      .not("concluded_at", "is", null)
      .order("concluded_at", { ascending: false })
      .limit(searching ? 3000 : 200);

    const rowsIn = (statuses ?? []) as Array<{
      log_id: string | null;
      reservation_id: string | null;
      property_id: string;
      note: string | null;
      arrival_time_override: string | null;
      done_at: string | null;
      concluded_at: string | null;
    }>;
    if (rowsIn.length === 0) return { rows: [] };

    const logIds = rowsIn.map((r) => r.log_id).filter((v): v is string => !!v);
    const resIds = rowsIn.map((r) => r.reservation_id).filter((v): v is string => !!v);

    const [{ data: props }, logsRes, resRes] = await Promise.all([
      context.supabase.from("properties").select("id, name, address, owner_contact_id, maps_url, garage_maps_url, lat, lng").in("id", propIds),
      logIds.length
        ? context.supabase
            .from("guide_access_logs")
            .select("id, property_id, guest_name, guest_phone, guest_phone_country, guest_arrival_time, checkin_date, checkout_date, reservation_code, created_at")
            .in("id", logIds)
        : Promise.resolve({ data: [] as never[] }),
      resIds.length
        ? context.supabase
            .from("property_reservations")
            .select("id, property_id, checkin_date, checkout_date, guest_hint, created_at")
            .in("id", resIds)
        : Promise.resolve({ data: [] as never[] }),
    ]);

    const propArr = (props ?? []) as Array<{
      id: string;
      name: string | null;
      address: string | null;
      owner_contact_id: string | null;
      maps_url: string | null;
      garage_maps_url: string | null;
      lat: number | null;
      lng: number | null;
    }>;
    const ownerIds = Array.from(new Set(propArr.map((p) => p.owner_contact_id).filter((v): v is string => !!v)));
    const ownerNameById = new Map<string, string>();
    const ownerPhoneById = new Map<string, { phone: string | null; country: string | null }>();
    if (ownerIds.length > 0) {
      const { data: owners } = await context.supabase
        .from("property_owners")
        .select("id, name, trade_name, phone, phone_country")
        .in("id", ownerIds);
      for (const o of (owners ?? []) as Array<{ id: string; name: string | null; trade_name: string | null; phone: string | null; phone_country: string | null }>) {
        const label = (o.trade_name || o.name || "").trim();
        if (label) ownerNameById.set(o.id, label);
        ownerPhoneById.set(o.id, { phone: o.phone ?? null, country: o.phone_country ?? null });
      }
    }
    const propById = new Map(propArr.map((p) => [p.id, p]));
    const logById = new Map(
      ((logsRes.data ?? []) as Array<Record<string, unknown>>).map((l) => [l["id"] as string, l]),
    );
    const resById = new Map(
      ((resRes.data ?? []) as Array<Record<string, unknown>>).map((r) => [r["id"] as string, r]),
    );

    const out: ArrivalRow[] = [];
    const seen = new Set<string>();
    for (const s of rowsIn) {
      const log = s.log_id ? logById.get(s.log_id) : undefined;
      const res = s.reservation_id ? resById.get(s.reservation_id) : undefined;
      if (!log && !res) continue;
      const p = propById.get(s.property_id);
      const checkin = (log?.["checkin_date"] as string) ?? (res?.["checkin_date"] as string) ?? "";
      const checkout = (log?.["checkout_date"] as string) ?? (res?.["checkout_date"] as string) ?? null;
      const key = `${s.property_id}|${checkin}|${checkout ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        logId: (log?.["id"] as string) ?? `ical:${s.reservation_id}`,
        reservationId: s.reservation_id,
        mutedUntil: null,
        propertyId: s.property_id,
        propertyName: p?.name ?? null,
        ownerName: p?.owner_contact_id ? (ownerNameById.get(p.owner_contact_id) ?? null) : null,
        ownerPhone: p?.owner_contact_id ? (ownerPhoneById.get(p.owner_contact_id)?.phone ?? null) : null,
        ownerPhoneCountry: p?.owner_contact_id ? (ownerPhoneById.get(p.owner_contact_id)?.country ?? null) : null,
        propertyAddress: p?.address ?? null,
        mapsUrl: p?.maps_url ?? null,
        garageMapsUrl: p?.garage_maps_url ?? null,
        lat: p?.lat ?? null,
        lng: p?.lng ?? null,
        hasPasswords: false,
        openedCheckin: true,
        openedGuide: true,
        readInstructions: true,
        viewedPasswords: true,
        guestName: (log?.["guest_name"] as string) ?? (res?.["guest_hint"] as string) ?? "Reserva Airbnb",
        guestPhone: (log?.["guest_phone"] as string) ?? null,
        guestPhoneCountry: (log?.["guest_phone_country"] as string) ?? null,
        guestArrivalTime: (log?.["guest_arrival_time"] as string) ?? null,
        standardTime: null,
        standardTimeMax: null,
        cleaningPriceNormalCents: null,
        cleaningPriceFullCents: null,
        date: checkout ?? checkin,
        guestCheckin: checkin,
        guestCheckout: checkout,
        reservationCode: (log?.["reservation_code"] as string) ?? (res?.["guest_hint"] as string) ?? null,
        createdAt: (log?.["created_at"] as string) ?? (res?.["created_at"] as string) ?? new Date().toISOString(),
        status: "done",
        note: s.note,
        arrivalTimeOverride: s.arrival_time_override,
        arrivalDateOverride: null,
        doneAt: s.done_at,
        pendingFill: false,
        ical: { hasIcal: !!res, matched: !!res, icalCheckin: null, icalCheckout: null },
        additionalGuests: [],
        concludedAt: s.concluded_at,
      });
    }

    if (!searching) return { rows: out };

    // Busca (sem acento, sem caixa) por hóspede, imóvel, proprietário ou
    // código da reserva — só entra em ação quando `q` vem preenchido, então
    // não muda em nada o comportamento padrão da tela.
    const { normalize } = await import("@/lib/clicksign.server");
    const term = normalize(data!.q);
    const filtered = out.filter((r) =>
      [r.guestName, r.propertyName, r.ownerName, r.reservationCode].some(
        (v) => v && normalize(v).includes(term),
      ),
    );
    return { rows: filtered };
  });

// ----- Não Compareceu: cards marcados como no-show (coluna própria, depois
// de "Concluídos") -----
// Espelha listConcludedArrivals quase linha por linha (mesmo racional: busca
// por padrão só os 200 mais recentes, solta o limite quando `q` vem
// preenchido) — só troca o filtro (kind="checkin" + status="no_show") e a
// ordenação (concluded_at, o timestamp gravado por markNoShow — NUNCA
// done_at: ver comentário em markNoShow sobre por que done_at fica de fora).
export const listNoShowArrivals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ConcludedInput.parse(i))
  .handler(async ({ data, context }): Promise<{ rows: ArrivalRow[] }> => {
    const propIds = await accessiblePropertyIds(context.supabase as never, data?.ownerId ?? null, context.userId);
    if (propIds.length === 0) return { rows: [] };

    const searching = !!data?.q && data.q.trim().length > 0;

    const { data: statuses } = await context.supabase
      .from("guest_arrival_status")
      .select("log_id, reservation_id, property_id, note, arrival_time_override, concluded_at")
      .in("property_id", propIds)
      .eq("kind", "checkin")
      .eq("status", "no_show")
      .order("concluded_at", { ascending: false })
      .limit(searching ? 3000 : 200);

    const rowsIn = (statuses ?? []) as Array<{
      log_id: string | null;
      reservation_id: string | null;
      property_id: string;
      note: string | null;
      arrival_time_override: string | null;
      concluded_at: string | null;
    }>;
    if (rowsIn.length === 0) return { rows: [] };

    const logIds = rowsIn.map((r) => r.log_id).filter((v): v is string => !!v);
    const resIds = rowsIn.map((r) => r.reservation_id).filter((v): v is string => !!v);

    const [{ data: props }, logsRes, resRes] = await Promise.all([
      context.supabase.from("properties").select("id, name, address, owner_contact_id, maps_url, garage_maps_url, lat, lng").in("id", propIds),
      logIds.length
        ? context.supabase
            .from("guide_access_logs")
            .select("id, property_id, guest_name, guest_phone, guest_phone_country, guest_arrival_time, checkin_date, checkout_date, reservation_code, created_at")
            .in("id", logIds)
        : Promise.resolve({ data: [] as never[] }),
      resIds.length
        ? context.supabase
            .from("property_reservations")
            .select("id, property_id, checkin_date, checkout_date, guest_hint, created_at")
            .in("id", resIds)
        : Promise.resolve({ data: [] as never[] }),
    ]);

    const propArr = (props ?? []) as Array<{
      id: string;
      name: string | null;
      address: string | null;
      owner_contact_id: string | null;
      maps_url: string | null;
      garage_maps_url: string | null;
      lat: number | null;
      lng: number | null;
    }>;
    const ownerIds = Array.from(new Set(propArr.map((p) => p.owner_contact_id).filter((v): v is string => !!v)));
    const ownerNameById = new Map<string, string>();
    const ownerPhoneById = new Map<string, { phone: string | null; country: string | null }>();
    if (ownerIds.length > 0) {
      const { data: owners } = await context.supabase
        .from("property_owners")
        .select("id, name, trade_name, phone, phone_country")
        .in("id", ownerIds);
      for (const o of (owners ?? []) as Array<{ id: string; name: string | null; trade_name: string | null; phone: string | null; phone_country: string | null }>) {
        const label = (o.trade_name || o.name || "").trim();
        if (label) ownerNameById.set(o.id, label);
        ownerPhoneById.set(o.id, { phone: o.phone ?? null, country: o.phone_country ?? null });
      }
    }
    const propById = new Map(propArr.map((p) => [p.id, p]));
    const logById = new Map(
      ((logsRes.data ?? []) as Array<Record<string, unknown>>).map((l) => [l["id"] as string, l]),
    );
    const resById = new Map(
      ((resRes.data ?? []) as Array<Record<string, unknown>>).map((r) => [r["id"] as string, r]),
    );

    const out: ArrivalRow[] = [];
    const seen = new Set<string>();
    for (const s of rowsIn) {
      const log = s.log_id ? logById.get(s.log_id) : undefined;
      const res = s.reservation_id ? resById.get(s.reservation_id) : undefined;
      if (!log && !res) continue;
      const p = propById.get(s.property_id);
      const checkin = (log?.["checkin_date"] as string) ?? (res?.["checkin_date"] as string) ?? "";
      const checkout = (log?.["checkout_date"] as string) ?? (res?.["checkout_date"] as string) ?? null;
      const key = `${s.property_id}|${checkin}|${checkout ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        logId: (log?.["id"] as string) ?? `ical:${s.reservation_id}`,
        reservationId: s.reservation_id,
        mutedUntil: null,
        propertyId: s.property_id,
        propertyName: p?.name ?? null,
        ownerName: p?.owner_contact_id ? (ownerNameById.get(p.owner_contact_id) ?? null) : null,
        ownerPhone: p?.owner_contact_id ? (ownerPhoneById.get(p.owner_contact_id)?.phone ?? null) : null,
        ownerPhoneCountry: p?.owner_contact_id ? (ownerPhoneById.get(p.owner_contact_id)?.country ?? null) : null,
        propertyAddress: p?.address ?? null,
        mapsUrl: p?.maps_url ?? null,
        garageMapsUrl: p?.garage_maps_url ?? null,
        lat: p?.lat ?? null,
        lng: p?.lng ?? null,
        hasPasswords: false,
        openedCheckin: true,
        openedGuide: true,
        readInstructions: true,
        viewedPasswords: true,
        guestName: (log?.["guest_name"] as string) ?? (res?.["guest_hint"] as string) ?? "Reserva Airbnb",
        guestPhone: (log?.["guest_phone"] as string) ?? null,
        guestPhoneCountry: (log?.["guest_phone_country"] as string) ?? null,
        guestArrivalTime: (log?.["guest_arrival_time"] as string) ?? null,
        standardTime: null,
        standardTimeMax: null,
        cleaningPriceNormalCents: null,
        cleaningPriceFullCents: null,
        date: checkin,
        guestCheckin: checkin,
        guestCheckout: checkout,
        reservationCode: (log?.["reservation_code"] as string) ?? (res?.["guest_hint"] as string) ?? null,
        createdAt: (log?.["created_at"] as string) ?? (res?.["created_at"] as string) ?? new Date().toISOString(),
        // Não existe um status "no_show" no tipo ArrivalRow (de propósito —
        // ver comentário no topo deste bloco): igual a "Concluídos", esta
        // lista já é dedicada e não compete com os filtros "pending" das
        // outras colunas, então "done" aqui só serve pra a UI (ArrivalCard)
        // tratar o card como um card "fechado" (mostra o selo, esconde o
        // botão de ação) — o valor real gravado no banco é "no_show".
        status: "done",
        note: s.note,
        arrivalTimeOverride: s.arrival_time_override,
        arrivalDateOverride: null,
        // doneAt fica null de propósito: o check-in nunca aconteceu de
        // verdade (ver comentário em markNoShow) — concludedAt é o único
        // timestamp real gravado por essa marcação.
        doneAt: null,
        pendingFill: false,
        ical: { hasIcal: !!res, matched: !!res, icalCheckin: null, icalCheckout: null },
        additionalGuests: [],
        concludedAt: s.concluded_at,
      });
    }

    if (!searching) return { rows: out };

    const { normalize } = await import("@/lib/clicksign.server");
    const term = normalize(data!.q);
    const filtered = out.filter((r) =>
      [r.guestName, r.propertyName, r.ownerName, r.reservationCode].some(
        (v) => v && normalize(v).includes(term),
      ),
    );
    return { rows: filtered };
  });
