import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Apenas administradores da plataforma operam o console interno da Channex. */
async function requireAdmin(context: { supabase: any; userId: string }) {
  const { data } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (!data) throw new Error("Acesso restrito a administradores.");
}

export const getAriTargets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context as never);
    const { loadAriTargets } = await import("@/lib/channex-ari.server");
    return loadAriTargets();
  });

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const changeSchema = z.object({
  propertyId: z.string().uuid(),
  roomTypeId: z.string().uuid(),
  ratePlanId: z.string().uuid(),
  dateFrom: isoDate,
  dateTo: isoDate,
  fields: z.object({
    availability: z.number().int().min(0).max(999).nullable().optional(),
    rate: z.number().min(0).max(1_000_000).nullable().optional(),
    min_stay: z.number().int().min(0).max(365).nullable().optional(),
    max_stay: z.number().int().min(0).max(365).nullable().optional(),
    stop_sell: z.boolean().nullable().optional(),
    closed_to_arrival: z.boolean().nullable().optional(),
    closed_to_departure: z.boolean().nullable().optional(),
  }),
});

/** Salva alterações (1 ou várias linhas) → delta → outbox → envio imediato em lote. */
export const saveAriChanges = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ changes: z.array(changeSchema).min(1).max(50) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context as never);
    for (const c of data.changes) if (c.dateTo < c.dateFrom) throw new Error("Data final antes da inicial.");
    const { applyCalendarChanges, flushAriOutbox } = await import("@/lib/channex-ari.server");
    const applied = await applyCalendarChanges(data.changes, context.userId);
    const flush = await flushAriOutbox();
    return { ...applied, ...flush };
  });

/** Reserva/bloqueio manual no PMS: reduz 1 unidade em cada noite e envia só esse delta de disponibilidade. */
export const registerManualBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ propertyId: z.string().uuid(), roomTypeId: z.string().uuid(), ratePlanId: z.string().uuid(), checkin: isoDate, checkout: isoDate }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context as never);
    if (data.checkout <= data.checkin) throw new Error("Checkout deve ser depois do checkin.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { applyCalendarChanges, flushAriOutbox } = await import("@/lib/channex-ari.server");
    const last = new Date(`${data.checkout}T00:00:00Z`);
    last.setUTCDate(last.getUTCDate() - 1);
    const lastNight = last.toISOString().slice(0, 10);
    const { data: rows } = await (supabaseAdmin as any)
      .from("channex_ari_calendar")
      .select("date, availability")
      .eq("rate_plan_id", data.ratePlanId)
      .gte("date", data.checkin)
      .lte("date", lastNight);
    const cur = new Map<string, number>(((rows ?? []) as any[]).map((r) => [r.date, r.availability ?? 1]));
    const changes = [];
    for (let d = data.checkin; d <= lastNight; ) {
      changes.push({ ...data, dateFrom: d, dateTo: d, fields: { availability: Math.max(0, (cur.get(d) ?? 1) - 1) } });
      const n = new Date(`${d}T00:00:00Z`);
      n.setUTCDate(n.getUTCDate() + 1);
      d = n.toISOString().slice(0, 10);
    }
    const applied = await applyCalendarChanges(changes, context.userId);
    return { ...applied, ...(await flushAriOutbox()) };
  });

export const runAriFullSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        propertyId: z.string().uuid(),
        roomTypeId: z.string().uuid(),
        ratePlanId: z.string().uuid(),
        countOfRooms: z.number().int().min(1).max(999),
        baseRate: z.number().min(1),
        weekendRate: z.number().min(1),
        defaultMinStay: z.number().int().min(1).max(30),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context as never);
    const { runFullSync, flushAriOutbox } = await import("@/lib/channex-ari.server");
    const sync = await runFullSync(data, context.userId);
    return { ...sync, ...(await flushAriOutbox()) };
  });

export const flushAriQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context as never);
    const { flushAriOutbox } = await import("@/lib/channex-ari.server");
    return flushAriOutbox();
  });

export const pullBookingFeed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context as never);
    const { processarFilaChannex, puxarFeedReservas } = await import("@/lib/channex-webhook.server");
    const fila = await processarFilaChannex(50);
    const feed = await puxarFeedReservas();
    return { fila, feed };
  });

export const getCertDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;
    const since = new Date(Date.now() - 60_000).toISOString();
    const [logs, outbox, acks, reservas, lastMinute] = await Promise.all([
      sb.from("channex_api_logs").select("id, operation, method, endpoint, attempt, http_status, task_id, error, request, response, created_at").order("created_at", { ascending: false }).limit(40),
      sb.from("channex_ari_outbox").select("status").limit(5000),
      sb.from("channex_booking_acks").select("revision_id, booking_id, status, attempts, acked_at, last_error").order("created_at", { ascending: false }).limit(20),
      sb.from("reservas").select("codigo_reserva_channex, channex_booking_id, channex_revision_id, nome_hospede, data_checkin, data_checkout, status, ota_name, updated_at").order("updated_at", { ascending: false }).limit(20),
      sb.from("channex_api_logs").select("id", { count: "exact", head: true }).eq("is_ari", true).gte("created_at", since),
    ]);
    const counts: Record<string, number> = {};
    for (const r of (outbox.data ?? []) as Array<{ status: string }>) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return {
      logs: (logs.data ?? []).map((l: any) => ({
        ...l,
        request: l.request ? JSON.stringify(l.request).slice(0, 1500) : null,
        response: l.response ? JSON.stringify(l.response).slice(0, 800) : null,
      })),
      outbox: counts,
      acks: acks.data ?? [],
      reservas: reservas.data ?? [],
      ariLastMinute: lastMinute.count ?? 0,
    };
  });
