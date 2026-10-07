/**
 * Motor ARI (Availability, Rates & Restrictions) de saída para a Channex.
 *
 * Fluxo: alteração no calendário interno → diff (só o que mudou) → outbox
 * (deduplicada) → lote único por tipo → limitador 20 ARI/min → Channex,
 * com retry exponencial para 429/5xx/rede e log de cada tentativa.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

const CHANNEX_BASE = "https://app.channex.io/api/v1";
const ARI_LIMIT_PER_MINUTE = 20;
const MAX_INLINE_ATTEMPTS = 3;
const MAX_OUTBOX_ATTEMPTS = 6;

async function db(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- HTTP + logs

export type ChannexCall = {
  operation: string;
  method: "GET" | "POST" | "PUT";
  path: string;
  body?: unknown;
  isAri?: boolean;
  batchId?: string;
};

export type ChannexResult = {
  ok: boolean;
  status: number | null;
  json: any;
  taskId: string | null;
  retriable: boolean;
  error: string | null;
};

/** Espera por uma vaga no limite de 20 chamadas ARI por minuto (contado no banco, vale entre instâncias). */
async function acquireAriSlot(maxWaitMs = 25_000): Promise<boolean> {
  const sb = await db();
  const started = Date.now();
  for (;;) {
    const since = new Date(Date.now() - 60_000).toISOString();
    const { data } = await sb
      .from("channex_api_logs")
      .select("created_at")
      .eq("is_ari", true)
      .gte("created_at", since)
      .order("created_at", { ascending: true });
    const rows = (data ?? []) as Array<{ created_at: string }>;
    if (rows.length < ARI_LIMIT_PER_MINUTE) return true;
    const freeAt = new Date(rows[0]!.created_at).getTime() + 60_000;
    const wait = Math.max(250, freeAt - Date.now());
    if (Date.now() - started + wait > maxWaitMs) return false;
    await sleep(wait);
  }
}

export async function channexRequest(call: ChannexCall): Promise<ChannexResult> {
  const key = (process.env["CHANNEX_API_KEY"] ?? process.env["CHANNEX_STAGING_API_KEY"]);
  if (!key) return { ok: false, status: null, json: null, taskId: null, retriable: false, error: "Chave Channex ausente." };
  const sb = await db();
  let last: ChannexResult = { ok: false, status: null, json: null, taskId: null, retriable: true, error: null };

  for (let attempt = 1; attempt <= MAX_INLINE_ATTEMPTS; attempt++) {
    if (call.isAri && !(await acquireAriSlot())) {
      return { ...last, ok: false, retriable: true, error: "Limite local de 20 ARI/min atingido; reagendado." };
    }
    let status: number | null = null;
    let json: any = null;
    let error: string | null = null;
    let retryAfterMs = 0;
    try {
      const res = await fetch(`${CHANNEX_BASE}${call.path}`, {
        method: call.method,
        headers: { "user-api-key": key, "Content-Type": "application/json", Accept: "application/json" },
        ...(call.body !== undefined ? { body: JSON.stringify(call.body) } : {}),
      });
      status = res.status;
      const text = await res.text();
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { raw: text.slice(0, 2000) };
      }
      if (!res.ok) error = `HTTP ${res.status}`;
      const ra = Number(res.headers.get("retry-after"));
      if (Number.isFinite(ra) && ra > 0) retryAfterMs = Math.min(ra * 1000, 10_000);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const ok = status != null && status >= 200 && status < 300;
    const retriable = !ok && (status == null || status === 429 || status >= 500);
    const taskId = ok ? extractTaskId(json) : null;
    const backoff = retryAfterMs || 1000 * 2 ** (attempt - 1);
    const willRetry = retriable && attempt < MAX_INLINE_ATTEMPTS;

    await sb.from("channex_api_logs").insert({
      operation: call.operation,
      method: call.method,
      endpoint: call.path,
      is_ari: !!call.isAri,
      batch_id: call.batchId ?? null,
      attempt,
      http_status: status,
      request: (call.body ?? null) as never,
      response: json as never,
      task_id: taskId,
      error,
      next_retry_at: willRetry ? new Date(Date.now() + backoff).toISOString() : null,
    });

    last = { ok, status, json, taskId, retriable, error };
    if (ok || !retriable) return last;
    if (willRetry) await sleep(backoff);
  }
  return last;
}

function extractTaskId(json: any): string | null {
  const d = json?.data;
  if (Array.isArray(d)) return d.find((x: any) => x?.type === "task")?.id ?? null;
  return d?.type === "task" ? d.id : null;
}

// ---------------------------------------------------------------- Mapeamento

export type AriTarget = {
  propertyId: string;
  propertyTitle: string;
  currency: string;
  roomTypes: Array<{ id: string; title: string; countOfRooms: number }>;
  ratePlans: Array<{ id: string; title: string; roomTypeId: string; currency: string }>;
};

/** Camada de mapeamento: lê da própria Channex a propriedade, room types e rate plans (sem UUID fixo no código). */
export async function loadAriTargets(): Promise<AriTarget[]> {
  const props = await channexRequest({ operation: "mapping.properties", method: "GET", path: "/properties" });
  if (!props.ok) throw new Error(`Channex indisponível (${props.error}).`);
  const out: AriTarget[] = [];
  for (const p of props.json?.data ?? []) {
    const rts = await channexRequest({ operation: "mapping.room_types", method: "GET", path: `/room_types?filter[property_id]=${p.id}&pagination[limit]=100` });
    const rps = await channexRequest({ operation: "mapping.rate_plans", method: "GET", path: `/rate_plans?filter[property_id]=${p.id}&pagination[limit]=100` });
    out.push({
      propertyId: p.id,
      propertyTitle: p.attributes?.title ?? p.id,
      currency: p.attributes?.currency ?? "",
      roomTypes: (rts.json?.data ?? []).map((r: any) => ({ id: r.id, title: r.attributes?.title, countOfRooms: r.attributes?.count_of_rooms ?? 1 })),
      ratePlans: (rps.json?.data ?? []).map((r: any) => ({
        id: r.id,
        title: r.attributes?.title,
        roomTypeId: r.relationships?.room_type?.data?.id,
        currency: r.attributes?.currency,
      })),
    });
  }
  return out;
}

// ---------------------------------------------------------------- Datas

const iso = (d: Date) => d.toISOString().slice(0, 10);
function addDays(s: string, n: number) {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}
function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    out.push(d);
    if (out.length > 800) break;
  }
  return out;
}

// ---------------------------------------------------------------- Calendário + delta

export const RESTRICTION_FIELDS = ["rate", "min_stay", "max_stay", "stop_sell", "closed_to_arrival", "closed_to_departure"] as const;
type RestrictionField = (typeof RESTRICTION_FIELDS)[number];
export type CalendarFields = Partial<Record<RestrictionField, number | boolean | null>> & { availability?: number | null };

export type CalendarChange = {
  propertyId: string;
  roomTypeId: string;
  ratePlanId: string;
  dateFrom: string;
  dateTo: string;
  fields: CalendarFields;
};

type Row = { date: string } & Record<string, any>;

function channexValueFor(field: string, v: any): Record<string, unknown> {
  if (field === "rate") return { rate: Number(v).toFixed(2) };
  if (field === "min_stay") return { min_stay_arrival: Number(v) };
  if (field === "max_stay") return { max_stay: Number(v) };
  return { [field]: v };
}

/** Agrupa datas consecutivas com o mesmo conjunto de valores em intervalos. */
function toRanges(items: Array<{ date: string; values: Record<string, unknown> }>) {
  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));
  const ranges: Array<{ from: string; to: string; values: Record<string, unknown> }> = [];
  for (const it of sorted) {
    const prev = ranges[ranges.length - 1];
    if (prev && addDays(prev.to, 1) === it.date && JSON.stringify(prev.values) === JSON.stringify(it.values)) prev.to = it.date;
    else ranges.push({ from: it.date, to: it.date, values: it.values });
  }
  return ranges;
}

/**
 * Aplica alterações ao calendário interno e enfileira SOMENTE o delta
 * (campos/datas cujo valor realmente mudou). Retorna quantos itens entraram na fila.
 */
export async function applyCalendarChanges(changes: CalendarChange[], userId: string | null, source = "delta") {
  const sb = await db();
  const outboxItems: OutboxInput[] = [];

  for (const ch of changes) {
    const dates = eachDate(ch.dateFrom, ch.dateTo);
    const { data: existing } = await sb
      .from("channex_ari_calendar")
      .select("*")
      .eq("rate_plan_id", ch.ratePlanId)
      .gte("date", ch.dateFrom)
      .lte("date", ch.dateTo);
    const byDate = new Map<string, Row>(((existing ?? []) as Row[]).map((r) => [r.date, r]));

    const upserts: Row[] = [];
    const availDeltas: Array<{ date: string; values: Record<string, unknown> }> = [];
    const restrDeltas: Array<{ date: string; values: Record<string, unknown> }> = [];

    for (const date of dates) {
      const cur: Row = byDate.get(date) ?? ({ date } as Row);
      const next: Row = {
        channex_property_id: ch.propertyId,
        room_type_id: ch.roomTypeId,
        rate_plan_id: ch.ratePlanId,
        date,
        availability: cur.availability ?? null,
        rate: cur.rate ?? null,
        min_stay: cur.min_stay ?? null,
        max_stay: cur.max_stay ?? null,
        stop_sell: cur.stop_sell ?? null,
        closed_to_arrival: cur.closed_to_arrival ?? null,
        closed_to_departure: cur.closed_to_departure ?? null,
        updated_at: new Date().toISOString(),
      };
      const rv: Record<string, unknown> = {};
      for (const f of RESTRICTION_FIELDS) {
        const v = ch.fields[f];
        if (v === undefined || v === null) continue;
        const same = f === "rate" ? Number(cur.rate) === Number(v) && cur.rate != null : cur[f] === v;
        next[f] = v;
        if (!same || source === "full_sync") Object.assign(rv, channexValueFor(f, v));
      }
      if (ch.fields.availability !== undefined && ch.fields.availability !== null) {
        const v = ch.fields.availability;
        next.availability = v;
        if (cur.availability !== v || source === "full_sync") availDeltas.push({ date, values: { availability: v } });
      }
      if (Object.keys(rv).length) restrDeltas.push({ date, values: rv });
      upserts.push(next);
    }

    if (upserts.length) {
      const { error } = await sb.from("channex_ari_calendar").upsert(upserts, { onConflict: "rate_plan_id,date" });
      if (error) throw new Error(error.message);
    }
    for (const r of toRanges(availDeltas))
      outboxItems.push({ kind: "availability", propertyId: ch.propertyId, roomTypeId: ch.roomTypeId, dateFrom: r.from, dateTo: r.to, values: r.values });
    for (const r of toRanges(restrDeltas))
      outboxItems.push({ kind: "restrictions", propertyId: ch.propertyId, ratePlanId: ch.ratePlanId, dateFrom: r.from, dateTo: r.to, values: r.values });
  }

  await enqueueAri(outboxItems, source, userId);
  return { enqueued: outboxItems.length };
}

// ---------------------------------------------------------------- Outbox

type OutboxInput = {
  kind: "availability" | "restrictions";
  propertyId: string;
  roomTypeId?: string;
  ratePlanId?: string;
  dateFrom: string;
  dateTo: string;
  values: Record<string, unknown>;
};

export async function enqueueAri(items: OutboxInput[], source: string, userId: string | null) {
  if (!items.length) return;
  const sb = await db();
  const rows = items.map((it) => {
    const target = it.kind === "availability" ? it.roomTypeId : it.ratePlanId;
    const dedupe = `${it.kind}:${target}:${it.dateFrom}:${it.dateTo}:${Object.keys(it.values).sort().join(",")}`;
    return {
      kind: it.kind,
      channex_property_id: it.propertyId,
      room_type_id: it.roomTypeId ?? null,
      rate_plan_id: it.ratePlanId ?? null,
      date_from: it.dateFrom,
      date_to: it.dateTo,
      payload: it.values,
      dedupe_key: dedupe,
      source,
      created_by: userId,
    };
  });
  // Idempotência: uma alteração pendente idêntica (mesmo alvo/intervalo/campos) é substituída pela mais nova.
  const keys = [...new Set(rows.map((r) => r.dedupe_key))];
  for (let i = 0; i < keys.length; i += 200) {
    await sb.from("channex_ari_outbox").update({ status: "superseded" }).eq("status", "pending").in("dedupe_key", keys.slice(i, i + 200));
  }
  const { error } = await sb.from("channex_ari_outbox").insert(rows);
  if (error) throw new Error(error.message);
}

export type FlushResult = { batches: Array<{ kind: string; items: number; ok: boolean; status: number | null; taskId: string | null; error: string | null; warnings: string | null }> };

/** Drena a outbox: 1 chamada por tipo (availability / restrictions) com todos os itens pendentes. */
export async function flushAriOutbox(): Promise<FlushResult> {
  const sb = await db();
  const result: FlushResult = { batches: [] };
  const { data: pending } = await sb
    .from("channex_ari_outbox")
    .select("*")
    .eq("status", "pending")
    .lte("next_attempt_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(1000);
  const rows = (pending ?? []) as any[];

  for (const kind of ["availability", "restrictions"] as const) {
    const items = rows.filter((r) => r.kind === kind);
    if (!items.length) continue;
    const batchId = crypto.randomUUID();
    const ids = items.map((r) => r.id);
    await sb.from("channex_ari_outbox").update({ status: "sending", batch_id: batchId }).in("id", ids);

    const values = items.map((r) => ({
      property_id: r.channex_property_id,
      ...(kind === "availability" ? { room_type_id: r.room_type_id } : { rate_plan_id: r.rate_plan_id }),
      date_from: r.date_from,
      date_to: r.date_to,
      ...r.payload,
    }));
    const sources = [...new Set(items.map((r) => r.source))].join("+");
    const res = await channexRequest({
      operation: `ari.${kind}.${sources}`,
      method: "POST",
      path: `/${kind}`,
      body: { values },
      isAri: true,
      batchId,
    });

    if (res.ok) {
      await sb.from("channex_ari_outbox").update({ status: "sent", task_id: res.taskId, sent_at: new Date().toISOString(), last_error: null }).in("id", ids);
    } else {
      for (const r of items) {
        const attempts = (r.attempts ?? 0) + 1;
        const giveUp = !res.retriable || attempts >= MAX_OUTBOX_ATTEMPTS;
        await sb
          .from("channex_ari_outbox")
          .update({
            status: giveUp ? "failed" : "pending",
            attempts,
            last_error: `${res.error ?? "erro"} ${JSON.stringify(res.json?.errors ?? "").slice(0, 500)}`,
            next_attempt_at: new Date(Date.now() + 30_000 * 2 ** attempts).toISOString(),
          })
          .eq("id", r.id);
      }
    }
    result.batches.push({ kind, items: items.length, ok: res.ok, status: res.status, taskId: res.taskId, error: res.error, warnings: res.json?.meta?.warnings ? JSON.stringify(res.json.meta.warnings).slice(0, 1000) : null });
  }
  return result;
}

// ---------------------------------------------------------------- Full sync

export type FullSyncInput = {
  propertyId: string;
  roomTypeId: string;
  ratePlanId: string;
  countOfRooms: number;
  baseRate: number;
  weekendRate: number;
  defaultMinStay: number;
};

/**
 * Full sync de 500 dias: materializa o estado (calendário interno; datas sem
 * valor usam tarifa base/fim de semana; disponibilidade descontando reservas
 * recebidas da Channex) e envia em 2 chamadas (availability + restrictions).
 */
export async function runFullSync(input: FullSyncInput, userId: string | null) {
  const sb = await db();
  const start = iso(new Date());
  const end = addDays(start, 499);

  const { data: cal } = await sb.from("channex_ari_calendar").select("*").eq("rate_plan_id", input.ratePlanId).gte("date", start).lte("date", end);
  const byDate = new Map<string, Row>(((cal ?? []) as Row[]).map((r) => [r.date, r]));

  const { data: bookings } = await sb
    .from("reservas")
    .select("data_checkin, data_checkout, status")
    .eq("channex_room_type_id", input.roomTypeId)
    .neq("status", "cancelled")
    .gte("data_checkout", start);
  const booked = new Map<string, number>();
  for (const b of (bookings ?? []) as any[]) {
    if (!b.data_checkin || !b.data_checkout) continue;
    for (let d = b.data_checkin; d < b.data_checkout; d = addDays(d, 1)) booked.set(d, (booked.get(d) ?? 0) + 1);
  }

  const avail: Array<{ date: string; values: Record<string, unknown> }> = [];
  const restr: Array<{ date: string; values: Record<string, unknown> }> = [];
  const upserts: Row[] = [];
  for (const date of eachDate(start, end)) {
    const cur: Row = byDate.get(date) ?? ({ date } as Row);
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    const weekend = dow === 5 || dow === 6;
    const availability = cur.availability ?? Math.max(0, input.countOfRooms - (booked.get(date) ?? 0));
    const rate = cur.rate != null ? Number(cur.rate) : weekend ? input.weekendRate : input.baseRate;
    const row: Row = {
      channex_property_id: input.propertyId,
      room_type_id: input.roomTypeId,
      rate_plan_id: input.ratePlanId,
      date,
      availability,
      rate,
      min_stay: cur.min_stay ?? input.defaultMinStay,
      max_stay: cur.max_stay ?? 0,
      stop_sell: cur.stop_sell ?? false,
      closed_to_arrival: cur.closed_to_arrival ?? false,
      closed_to_departure: cur.closed_to_departure ?? false,
      updated_at: new Date().toISOString(),
    };
    upserts.push(row);
    avail.push({ date, values: { availability } });
    restr.push({
      date,
      values: {
        rate: rate.toFixed(2),
        min_stay_arrival: row.min_stay,
        max_stay: row.max_stay,
        stop_sell: row.stop_sell,
        closed_to_arrival: row.closed_to_arrival,
        closed_to_departure: row.closed_to_departure,
      },
    });
  }
  for (let i = 0; i < upserts.length; i += 250) {
    const { error } = await sb.from("channex_ari_calendar").upsert(upserts.slice(i, i + 250), { onConflict: "rate_plan_id,date" });
    if (error) throw new Error(error.message);
  }
  const items: OutboxInput[] = [
    ...toRanges(avail).map((r) => ({ kind: "availability" as const, propertyId: input.propertyId, roomTypeId: input.roomTypeId, dateFrom: r.from, dateTo: r.to, values: r.values })),
    ...toRanges(restr).map((r) => ({ kind: "restrictions" as const, propertyId: input.propertyId, ratePlanId: input.ratePlanId, dateFrom: r.from, dateTo: r.to, values: r.values })),
  ];
  await enqueueAri(items, "full_sync", userId);
  return { days: 500, from: start, to: end, ranges: items.length };
}

// ---------------------------------------------------------------- Booking ACK

/** Confirma (ACK) uma revisão de reserva. Idempotente: não reenvia se já confirmada. */
export async function ackBookingRevision(revisionId: string, bookingId: string | null) {
  const sb = await db();
  const { data: prev } = await sb.from("channex_booking_acks").select("status, attempts").eq("revision_id", revisionId).maybeSingle();
  if (prev?.status === "acked") return { ok: true, already: true };
  const res = await channexRequest({ operation: "booking.ack", method: "POST", path: `/booking_revisions/${revisionId}/ack` });
  await sb.from("channex_booking_acks").upsert(
    {
      revision_id: revisionId,
      booking_id: bookingId,
      status: res.ok ? "acked" : "failed",
      attempts: (prev?.attempts ?? 0) + 1,
      last_error: res.ok ? null : `${res.error} ${JSON.stringify(res.json ?? "").slice(0, 300)}`,
      acked_at: res.ok ? new Date().toISOString() : null,
    },
    { onConflict: "revision_id" },
  );
  return { ok: res.ok, already: false };
}
