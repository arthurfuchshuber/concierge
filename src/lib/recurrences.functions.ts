// Recorrências de Manutenção e Limpeza (13/11/2026). Ver a migration 20261113120000.
// A série (`task_recurrences`) gera UMA pendência por vez em `tasks` (recurrence_id); concluída ou
// pulada, a próxima nasce na leitura seguinte. Sem cron: toda leitura de série "materializa" o que venceu.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  addDays,
  advance,
  describeFrequency,
  describeShort,
  pickCleaningDate,
  type RecurrenceUnit,
} from "@/lib/recurrence-dates";
import { composeRecordBody, nextRecordNameFor, RECORD_TITLE_MAX } from "@/lib/reservation-records.functions";

type AnyClient = { from: (t: string) => any };

/** Com o checklist ligado a pendência aparece com 7 dias de antecedência (para caber no checkout mais próximo). */
const LEAD_DAYS_CHECKLIST = 7;

export function todayISO(): string {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}

export type RecurrenceRow = {
  id: string;
  property_id: string;
  category: "maintenance" | "cleaning";
  title: string;
  description: string | null;
  unit: RecurrenceUnit;
  interval_n: number;
  anchor_day: number;
  start_date: string;
  next_date: string | null;
  ends_on: string | null;
  in_cleaning_checklist: boolean;
  status: "active" | "paused" | "ended";
  created_by: string | null;
  account_owner_id: string;
};

const COLS =
  "id, property_id, category, title, description, unit, interval_n, anchor_day, start_date, next_date, ends_on, in_cleaning_checklist, status, created_by, account_owner_id";

async function checkoutsOf(db: AnyClient, propertyId: string, today: string) {
  const { data } = await db
    .from("property_reservations")
    .select("id, checkout_date")
    .eq("property_id", propertyId)
    .eq("status", "confirmed")
    .gte("checkout_date", today)
    .order("checkout_date", { ascending: true });
  return ((data ?? []) as Array<{ id: string; checkout_date: string }>).map((r) => ({
    id: r.id,
    date: r.checkout_date,
  }));
}

/** Reservas cujo checkout recebe a pendência: devolve { reservationId, date } ou null. */
export async function resolveCleaningFor(db: AnyClient, propertyId: string, due: string, today: string) {
  const list = await checkoutsOf(db, propertyId, today);
  const date = pickCleaningDate(due, today, list.map((c) => c.date));
  if (!date) return null;
  const hit = list.find((c) => c.date === date);
  return hit ? { reservationId: hit.id, date } : null;
}


/** Reserva (checkout) que recebe uma pendência avulsa: o mais próximo de `due` (ou de hoje, sem data). */
export async function autoLinkReservationId(
  db: AnyClient,
  propertyId: string,
  due: string | null,
): Promise<string | null> {
  const today = todayISO();
  const link = await resolveCleaningFor(db, propertyId, due ?? today, today);
  return link?.reservationId ?? null;
}

/**
 * Religa as pendências avulsas de checkout automático (`auto_link_checkout`) ao checkout certo: quando a
 * reserva muda de data, é cancelada, ou aparece uma reserva para o imóvel que estava sem checkout à frente.
 * Sem checkout à frente a pendência fica guardada (reservation_id nulo) e entra no checklist quando surgir um.
 */
export async function relinkAutoCheckout(db: AnyClient, propertyIds?: string[]): Promise<void> {
  try {
    const today = todayISO();
    let q = db
      .from("tasks")
      .select("id, property_id, due_date, reservation_id")
      .eq("auto_link_checkout", true)
      .eq("status", "pending")
      .eq("show_in_cleaning", true)
      .not("property_id", "is", null);
    if (propertyIds?.length) q = q.in("property_id", propertyIds);
    const { data } = await q.limit(1000);
    const rows = (data ?? []) as Array<{
      id: string;
      property_id: string;
      due_date: string | null;
      reservation_id: string | null;
    }>;
    if (rows.length === 0) return;
    const cache = new Map<string, Array<{ id: string; date: string }>>();
    for (const r of rows) {
      let list = cache.get(r.property_id);
      if (!list) {
        list = await checkoutsOf(db, r.property_id, today);
        cache.set(r.property_id, list);
      }
      const date = pickCleaningDate(r.due_date ?? today, today, list.map((c) => c.date));
      const wanted = date ? (list.find((c) => c.date === date)?.id ?? null) : null;
      if (wanted !== r.reservation_id) {
        await db.from("tasks").update({ reservation_id: wanted }).eq("id", r.id);
      }
    }
  } catch (e) {
    console.error("relinkAutoCheckout", (e as Error).message);
  }
}

/** Transforma em pendência a data que venceu e religa as já abertas ao checkout certo. */
export async function materializeDue(db: AnyClient, userId: string, propertyIds?: string[]): Promise<void> {
  const today = todayISO();
  await relinkAutoCheckout(db, propertyIds);
  let q = db.from("task_recurrences").select(COLS).eq("status", "active").not("next_date", "is", null);
  if (propertyIds?.length) q = q.in("property_id", propertyIds);
  const { data: series } = await q.limit(500);
  for (const s of (series ?? []) as RecurrenceRow[]) {
    try {
      const { data: open } = await db
        .from("tasks")
        .select("id, due_date, status, reservation_id")
        .eq("recurrence_id", s.id)
        .eq("status", "pending");
      const openRows = (open ?? []) as Array<{ id: string; due_date: string; reservation_id: string | null }>;

      // 1) Religar a pendência aberta (agenda mudou): só enquanto a data não passou e não há limpeza no dia.
      if (s.in_cleaning_checklist) {
        for (const o of openRows) {
          const link = await resolveCleaningFor(db, s.property_id, o.due_date, today);
          const wanted = link?.reservationId ?? null;
          if (wanted !== o.reservation_id) {
            await db.from("tasks").update({ reservation_id: wanted }).eq("id", o.id);
          }
        }
      }
      if (openRows.length > 0) continue;

      // 2) Gerar a próxima, se já está na janela.
      if (!s.next_date) continue;
      const lead = s.in_cleaning_checklist ? LEAD_DAYS_CHECKLIST : 0;
      if (s.next_date > addDays(today, lead)) continue;
      if (s.ends_on && s.next_date > s.ends_on) {
        await db.from("task_recurrences").update({ status: "ended", next_date: null }).eq("id", s.id);
        continue;
      }
      const due = s.next_date;
      const link = s.in_cleaning_checklist ? await resolveCleaningFor(db, s.property_id, due, today) : null;
      const { data: ins, error } = await db
        .from("tasks")
        .insert({
          account_owner_id: s.account_owner_id,
          property_id: s.property_id,
          title: s.title,
          description: s.description,
          category: s.category,
          priority: "medium",
          due_date: due,
          show_in_cleaning: s.in_cleaning_checklist,
          reservation_id: link?.reservationId ?? null,
          recurrence_id: s.id,
          created_by: s.created_by ?? userId,
        })
        .select("id")
        .single();
      if (error) {
        // Outra tela gerou a mesma data no mesmo instante: o índice único protege, nada a fazer.
        if ((error as { code?: string }).code !== "23505") console.error("materializeDue", error.message);
        continue;
      }
      const taskId = (ins as { id: string }).id;
      const gid = crypto.randomUUID();
      await db.from("reservation_records").insert({
        id: gid,
        group_id: gid,
        property_id: s.property_id,
        category: s.category === "cleaning" ? "cleaning_audit" : "maintenance",
        kind: "note",
        body: composeRecordBody(s.title, s.description) ?? s.title,
        created_by: s.created_by ?? userId,
        created_by_name: "Recorrência",
        task_id: taskId,
        file_name: await nextRecordNameFor(db as never, s.property_id),
      });
      let next = advance(due, s.unit, s.interval_n, s.anchor_day);
      while (next < today) next = advance(next, s.unit, s.interval_n, s.anchor_day);
      const ended = !!s.ends_on && next > s.ends_on;
      await db
        .from("task_recurrences")
        .update(ended ? { next_date: null, status: "ended" } : { next_date: next })
        .eq("id", s.id);
    } catch (e) {
      console.error("materializeDue série", s.id, (e as Error).message);
    }
  }
}

const Frequency = z.object({
  unit: z.enum(["day", "week", "month", "year"]),
  interval: z.number().int().min(1).max(365),
});
const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const CreateInput = z.object({
  propertyIds: z.array(z.string().uuid()).min(1).max(50),
  category: z.enum(["maintenance", "cleaning"]),
  title: z.string().trim().min(1, "Escreva um título.").max(RECORD_TITLE_MAX),
  description: z.string().trim().max(4000).nullable().optional(),
  frequency: Frequency,
  startDate: DateStr,
  endsOn: DateStr.nullable().optional(),
  inCleaningChecklist: z.boolean(),
});

export const createRecurrences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CreateInput.parse(i))
  .handler(async ({ data, context }): Promise<{ ids: string[] }> => {
    const db = context.supabase as unknown as AnyClient;
    const { resolveAuthorizedAccountOwnerId } = await import("@/lib/account-scope.server");
    const accountOwnerId = await resolveAuthorizedAccountOwnerId(context.supabase as never, context.userId, null);
    const anchor = Number(data.startDate.slice(8, 10));
    const rows = data.propertyIds.map((pid) => ({
      account_owner_id: accountOwnerId,
      property_id: pid,
      category: data.category,
      title: data.title,
      description: data.description || null,
      unit: data.frequency.unit,
      interval_n: data.frequency.interval,
      anchor_day: anchor,
      start_date: data.startDate,
      next_date: data.startDate,
      ends_on: data.endsOn ?? null,
      in_cleaning_checklist: data.inCleaningChecklist,
      created_by: context.userId,
    }));
    const { data: ins, error } = await db.from("task_recurrences").insert(rows).select("id");
    if (error) throw new Error(error.message);
    await materializeDue(db, context.userId, data.propertyIds);
    return { ids: ((ins ?? []) as Array<{ id: string }>).map((r) => r.id) };
  });

export type RecurrenceOccurrence = {
  /** task id; null quando é só a previsão da série. */
  taskId: string | null;
  date: string;
  state: "next" | "done" | "skipped";
  by: string | null;
  amountCents: number | null;
  note: string | null;
  /** checkout (AAAA-MM-DD) que recebeu a pendência, quando difere ou coincide com a data. */
  cleaningDate: string | null;
};

export type RecurrenceSummary = {
  id: string;
  propertyId: string;
  category: "maintenance" | "cleaning";
  title: string;
  description: string | null;
  frequencyLabel: string;
  frequencyShort: string;
  unit: RecurrenceUnit;
  interval: number;
  startDate: string;
  nextDate: string | null;
  endsOn: string | null;
  inCleaningChecklist: boolean;
  status: "active" | "paused" | "ended";
  occurrences: RecurrenceOccurrence[];
};

const ListInput = z.object({
  propertyId: z.string().uuid().optional(),
  propertyIds: z.array(z.string().uuid()).max(500).optional(),
  includeEnded: z.boolean().optional(),
});

export const listRecurrences = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ListInput.parse(i ?? {}))
  .handler(async ({ data, context }): Promise<{ series: RecurrenceSummary[] }> => {
    const db = context.supabase as unknown as AnyClient;
    const ids = data.propertyIds ?? (data.propertyId ? [data.propertyId] : undefined);
    await materializeDue(db, context.userId, ids);
    let q = db.from("task_recurrences").select(COLS).order("created_at", { ascending: true });
    if (ids?.length) q = q.in("property_id", ids);
    if (!data.includeEnded) q = q.neq("status", "ended");
    const { data: rows, error } = await q.limit(500);
    if (error) throw new Error(error.message);
    const series = (rows ?? []) as RecurrenceRow[];
    if (series.length === 0) return { series: [] };

    const { data: tasks } = await db
      .from("tasks")
      .select("id, recurrence_id, due_date, status, completed_at, amount_spent_cents, resolution_note, resolved_by_provider_id, reservation_id")
      .in("recurrence_id", series.map((s) => s.id))
      .order("due_date", { ascending: false })
      .limit(2000);
    const tRows = (tasks ?? []) as Array<{
      id: string;
      recurrence_id: string;
      due_date: string;
      status: string;
      amount_spent_cents: number | null;
      resolution_note: string | null;
      resolved_by_provider_id: string | null;
      reservation_id: string | null;
    }>;
    const resIds = Array.from(new Set(tRows.map((t) => t.reservation_id).filter((v): v is string => !!v)));
    const resDate = new Map<string, string>();
    if (resIds.length) {
      const { data: rr } = await db.from("property_reservations").select("id, checkout_date").in("id", resIds);
      for (const r of (rr ?? []) as Array<{ id: string; checkout_date: string }>) resDate.set(r.id, r.checkout_date);
    }
    const provIds = Array.from(new Set(tRows.map((t) => t.resolved_by_provider_id).filter((v): v is string => !!v)));
    const provName = new Map<string, string>();
    if (provIds.length) {
      const { data: pp } = await db.from("service_providers").select("id, name, trade_name").in("id", provIds);
      for (const p of (pp ?? []) as Array<{ id: string; name: string | null; trade_name: string | null }>)
        provName.set(p.id, (p.trade_name || p.name || "").trim());
    }

    const out: RecurrenceSummary[] = series.map((s) => {
      const occ: RecurrenceOccurrence[] = tRows
        .filter((t) => t.recurrence_id === s.id)
        .map((t) => ({
          taskId: t.id,
          date: t.due_date,
          state: t.status === "done" ? ("done" as const) : t.status === "canceled" ? ("skipped" as const) : ("next" as const),
          by: t.resolved_by_provider_id ? (provName.get(t.resolved_by_provider_id) ?? null) : null,
          amountCents: t.amount_spent_cents,
          note: t.resolution_note,
          cleaningDate: t.reservation_id ? (resDate.get(t.reservation_id) ?? null) : null,
        }));
      const hasOpen = occ.some((o) => o.state === "next");
      if (!hasOpen && s.next_date && s.status === "active") {
        occ.unshift({ taskId: null, date: s.next_date, state: "next", by: null, amountCents: null, note: null, cleaningDate: null });
      }
      occ.sort((a, b) => b.date.localeCompare(a.date));
      const open = occ.find((o) => o.state === "next");
      return {
        id: s.id,
        propertyId: s.property_id,
        category: s.category,
        title: s.title,
        description: s.description,
        frequencyLabel: describeFrequency(s.unit, s.interval_n, s.anchor_day),
        frequencyShort: describeShort(s.unit, s.interval_n),
        unit: s.unit,
        interval: s.interval_n,
        startDate: s.start_date,
        nextDate: open?.date ?? s.next_date,
        endsOn: s.ends_on,
        inCleaningChecklist: s.in_cleaning_checklist,
        status: s.status,
        occurrences: occ,
      };
    });
    return { series: out };
  });

const UpdateInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pause"), id: z.string().uuid() }),
  z.object({ action: z.literal("resume"), id: z.string().uuid() }),
  z.object({ action: z.literal("end"), id: z.string().uuid() }),
  z.object({
    action: z.literal("edit"),
    id: z.string().uuid(),
    title: z.string().trim().min(1).max(RECORD_TITLE_MAX),
    description: z.string().trim().max(4000).nullable().optional(),
    frequency: Frequency,
    nextDate: DateStr,
    endsOn: DateStr.nullable().optional(),
    inCleaningChecklist: z.boolean(),
  }),
]);

export const updateRecurrence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UpdateInput.parse(i))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const db = context.supabase as unknown as AnyClient;
    const today = todayISO();
    const { data: cur, error: e0 } = await db.from("task_recurrences").select(COLS).eq("id", data.id).single();
    if (e0 || !cur) throw new Error("Recorrência não encontrada ou sem acesso.");
    const s = cur as RecurrenceRow;
    let patch: Record<string, unknown> = {};
    if (data.action === "pause") patch = { status: "paused" };
    else if (data.action === "end") patch = { status: "ended", next_date: null };
    else if (data.action === "resume") {
      let next = s.next_date ?? today;
      while (next < today) next = advance(next, s.unit, s.interval_n, s.anchor_day);
      patch = { status: "active", next_date: next };
    } else {
      patch = {
        title: data.title,
        description: data.description || null,
        unit: data.frequency.unit,
        interval_n: data.frequency.interval,
        anchor_day: Number(data.nextDate.slice(8, 10)),
        next_date: data.nextDate,
        ends_on: data.endsOn ?? null,
        in_cleaning_checklist: data.inCleaningChecklist,
      };
    }
    const { error } = await db.from("task_recurrences").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    // Encerrar: a pendência aberta da série sai da fila (a série acabou). Editar o checklist reflete nela.
    if (data.action === "end") {
      await db.from("tasks").update({ status: "canceled", resolution_note: "Série encerrada" }).eq("recurrence_id", data.id).eq("status", "pending");
    }
    if (data.action === "edit") {
      await db
        .from("tasks")
        .update({ title: data.title, description: data.description || null, show_in_cleaning: data.inCleaningChecklist, ...(data.inCleaningChecklist ? {} : { reservation_id: null }) })
        .eq("recurrence_id", data.id)
        .eq("status", "pending");
    }
    await materializeDue(db, context.userId, [s.property_id]);
    return { ok: true };
  });

const SkipInput = z.object({ taskId: z.string().uuid(), reason: z.string().trim().max(200).optional() });

/** "Pular" uma ocorrência: sai da fila, vira "Pulada" no histórico e a próxima nasce na janela. */
export const skipRecurrenceOccurrence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SkipInput.parse(i))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const db = context.supabase as unknown as AnyClient;
    const { data: t, error: e0 } = await db.from("tasks").select("id, recurrence_id, property_id").eq("id", data.taskId).single();
    const row = t as { recurrence_id: string | null; property_id: string | null } | null;
    if (e0 || !row?.recurrence_id) throw new Error("Esta pendência não pertence a uma recorrência.");
    const { error } = await db
      .from("tasks")
      .update({ status: "canceled", resolution_note: data.reason ? `Pulada · ${data.reason}` : "Pulada" })
      .eq("id", data.taskId);
    if (error) throw new Error(error.message);
    if (row.property_id) await materializeDue(db, context.userId, [row.property_id]);
    return { ok: true };
  });

const CheckoutDaysInput = z.object({
  propertyIds: z.array(z.string().uuid()).min(1).max(100),
  from: DateStr,
  to: DateStr,
});

/** Dias (AAAA-MM-DD) com checkout confirmado em QUALQUER dos imóveis: alimenta as bolinhas do calendário. */
export const listCheckoutDays = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CheckoutDaysInput.parse(i))
  .handler(async ({ data, context }): Promise<{ days: string[] }> => {
    const db = context.supabase as unknown as AnyClient;
    const { data: rows } = await db
      .from("property_reservations")
      .select("checkout_date")
      .in("property_id", data.propertyIds)
      .eq("status", "confirmed")
      .gte("checkout_date", data.from)
      .lte("checkout_date", data.to)
      .limit(2000);
    const days = Array.from(
      new Set(((rows ?? []) as Array<{ checkout_date: string }>).map((r) => r.checkout_date)),
    ).sort();
    return { days };
  });
