// Server functions de Tarefas/Pendências — botão "PENDÊNCIAS" do Kanban
// (agrupado por proprietário/imóvel/imóvel+hóspede) e checklist do card de
// Limpeza. Mesmos padrões já usados em dashboard.functions.ts:
// createServerFn + requireSupabaseAuth + zod, com o cliente Supabase
// "solto" (AnyClient) pras tabelas que ainda não estão no types.ts gerado —
// igual arrival-board.server.ts já faz.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type {
  TaskCategory,
  TaskCompletion,
  TaskLinkOwner,
  TaskLinkProperty,
  TaskPriority,
  TaskRow,
  TaskStatus,
} from "@/lib/tasks-types";

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
function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

const ScopeInput = z.object({ ownerId: z.string().uuid().nullable().optional() }).optional();

// ----- Opções pra vincular uma pendência (imóveis + proprietários) -----

export const listTaskLinkOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ScopeInput.parse(i) ?? {})
  .handler(async ({ data, context }): Promise<{ properties: TaskLinkProperty[]; owners: TaskLinkOwner[] }> => {
    const { accessiblePropertyIds } = await import("@/lib/dashboard.functions");
    const { resolveAuthorizedAccountOwnerId } = await import("@/lib/account-scope.server");
    const db = context.supabase as unknown as AnyClient;

    const [propIds, accountOwnerId] = await Promise.all([
      accessiblePropertyIds(context.supabase as never, data.ownerId ?? null, context.userId),
      resolveAuthorizedAccountOwnerId(context.supabase as never, context.userId, data.ownerId ?? null),
    ]);

    const [{ data: props }, { data: ownerRows }] = await Promise.all([
      propIds.length > 0
        ? db.from("properties").select("id, name, owner_contact_id").in("id", propIds).order("name")
        : Promise.resolve({ data: [] }),
      db
        .from("property_owners")
        .select("id, name, trade_name")
        .eq("account_owner_id", accountOwnerId)
        .neq("status", "canceled")
        .order("name"),
    ]);

    const ownerNameById = new Map<string, string>();
    for (const o of (ownerRows ?? []) as Array<{ id: string; name: string | null; trade_name: string | null }>) {
      const label = (o.trade_name || o.name || "").trim();
      if (label) ownerNameById.set(o.id, label);
    }

    const properties: TaskLinkProperty[] = ((props ?? []) as Array<{
      id: string;
      name: string | null;
      owner_contact_id: string | null;
    }>).map((p) => ({
      id: p.id,
      name: p.name ?? "Sem nome",
      ownerContactId: p.owner_contact_id,
      ownerName: p.owner_contact_id ? (ownerNameById.get(p.owner_contact_id) ?? null) : null,
    }));

    const owners: TaskLinkOwner[] = Array.from(ownerNameById.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

    return { properties, owners };
  });

// ----- Listagem (dialog "PENDÊNCIAS" + checklist da Limpeza) -----

const ListTasksInput = z
  .object({
    ownerId: z.string().uuid().nullable().optional(),
    /** true = só as marcadas "aparece na limpeza" (usado pelo checklist do
     * card de Limpeza); omitido = todas (usado pelo dialog "PENDÊNCIAS"). */
    onlyCleaning: z.boolean().optional(),
  })
  .optional();

export const listTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ListTasksInput.parse(i) ?? {})
  .handler(async ({ data, context }): Promise<{ tasks: TaskRow[]; completions: TaskCompletion[] }> => {
    const { resolveAuthorizedAccountOwnerId } = await import("@/lib/account-scope.server");
    const accountOwnerId = await resolveAuthorizedAccountOwnerId(
      context.supabase as never,
      context.userId,
      data.ownerId ?? null,
    );
    const db = context.supabase as unknown as AnyClient;

    let query = db
      .from("tasks")
      .select(
        "id, title, description, category, priority, due_date, show_in_cleaning, status, completed_at, created_at, property_id, owner_contact_id, log_id, reservation_id, amount_spent_cents, recurrence_days",
      )
      .eq("account_owner_id", accountOwnerId)
      .in("status", ["pending", "done"])
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (data.onlyCleaning) query = query.eq("show_in_cleaning", true);

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    const raw = (rows ?? []) as Array<{
      id: string;
      title: string;
      description: string | null;
      category: string;
      priority: string;
      due_date: string | null;
      show_in_cleaning: boolean;
      status: string;
      completed_at: string | null;
      created_at: string;
      property_id: string | null;
      owner_contact_id: string | null;
      log_id: string | null;
      reservation_id: string | null;
      amount_spent_cents: number | null;
      recurrence_days: number | null;
    }>;

    // Nomes de imóvel/proprietário em 2 buscas em lote (mesma técnica do
    // getOccupancyBoard) — evita N+1. O "proprietário" de uma pendência
    // vinculada só ao imóvel é herdado do dono cadastrado do imóvel.
    const propIdsUsed = Array.from(new Set(raw.map((r) => r.property_id).filter((v): v is string => !!v)));
    const { data: propRows } =
      propIdsUsed.length > 0
        ? await db.from("properties").select("id, name, owner_contact_id").in("id", propIdsUsed)
        : { data: [] };
    const propById = new Map(
      ((propRows ?? []) as Array<{ id: string; name: string | null; owner_contact_id: string | null }>).map((p) => [
        p.id,
        p,
      ]),
    );
    const ownerIdsUsed = Array.from(
      new Set([
        ...raw.map((r) => r.owner_contact_id).filter((v): v is string => !!v),
        ...Array.from(propById.values())
          .map((p) => p.owner_contact_id)
          .filter((v): v is string => !!v),
      ]),
    );
    const { data: ownerRows } =
      ownerIdsUsed.length > 0
        ? await db.from("property_owners").select("id, name, trade_name").in("id", ownerIdsUsed)
        : { data: [] };
    const ownerNameById = new Map<string, string>();
    for (const o of (ownerRows ?? []) as Array<{ id: string; name: string | null; trade_name: string | null }>) {
      const label = (o.trade_name || o.name || "").trim();
      if (label) ownerNameById.set(o.id, label);
    }

    const tasks: TaskRow[] = raw.map((r) => {
      const prop = r.property_id ? propById.get(r.property_id) : undefined;
      const effectiveOwnerId = r.owner_contact_id ?? prop?.owner_contact_id ?? null;
      return {
        id: r.id,
        title: r.title,
        description: r.description,
        category: r.category as TaskCategory,
        priority: r.priority as TaskPriority,
        dueDate: r.due_date,
        showInCleaning: r.show_in_cleaning,
        status: r.status as TaskStatus,
        completedAt: r.completed_at,
        createdAt: r.created_at,
        propertyId: r.property_id,
        propertyName: prop?.name ?? null,
        ownerContactId: r.owner_contact_id,
        ownerName: effectiveOwnerId ? (ownerNameById.get(effectiveOwnerId) ?? null) : null,
        logId: r.log_id,
        reservationId: r.reservation_id,
        amountSpentCents: r.amount_spent_cents,
        recurrenceDays: r.recurrence_days,
      };
    });

    // Conclusões recentes das pendências RECORRENTES (sem log/reservation na
    // própria linha) — só últimos 7 dias, suficiente pra saber o que já foi
    // feito nas limpezas em andamento sem carregar histórico velho.
    const recurringIds = raw.filter((r) => !r.log_id && !r.reservation_id).map((r) => r.id);
    let completions: TaskCompletion[] = [];
    if (recurringIds.length > 0) {
      const since = `${addDaysISO(todayISO(), -7)}T00:00:00.000Z`;
      const { data: compRows } = await db
        .from("task_completions")
        .select("task_id, log_id, reservation_id, amount_spent_cents")
        .in("task_id", recurringIds)
        .gte("completed_at", since);
      completions = (
        (compRows ?? []) as Array<{
          task_id: string;
          log_id: string | null;
          reservation_id: string | null;
          amount_spent_cents: number | null;
        }>
      ).map((c) => ({
        taskId: c.task_id,
        logId: c.log_id,
        reservationId: c.reservation_id,
        amountSpentCents: c.amount_spent_cents,
      }));
    }

    return { tasks, completions };
  });

// ----- Criar -----

const CreateTaskInput = z
  .object({
    ownerId: z.string().uuid().nullable().optional(),
    title: z.string().trim().min(1, "Título obrigatório.").max(200),
    description: z.string().trim().max(1000).nullable().optional(),
    category: z
      .enum(["maintenance", "financial", "guest_request", "purchase", "inspection", "cleaning", "other"])
      .default("other"),
    priority: z.enum(["low", "medium", "high"]).default("medium"),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    showInCleaning: z.boolean().default(false),
    propertyId: z.string().uuid().nullable().optional(),
    ownerContactId: z.string().uuid().nullable().optional(),
    logId: z.string().uuid().nullable().optional(),
    reservationId: z.string().uuid().nullable().optional(),
    amountSpentCents: z.number().int().min(0).nullable().optional(),
    recurrenceDays: z.number().int().min(1).nullable().optional(),
  })
  .refine((v) => !!v.propertyId || !!v.ownerContactId, {
    message: "Vincule a pendência a um imóvel ou a um proprietário.",
  });

export const createTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CreateTaskInput.parse(i))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { resolveAuthorizedAccountOwnerId } = await import("@/lib/account-scope.server");
    const accountOwnerId = await resolveAuthorizedAccountOwnerId(
      context.supabase as never,
      context.userId,
      data.ownerId ?? null,
    );
    const db = context.supabase as unknown as AnyClient;
    const { data: inserted, error } = await db
      .from("tasks")
      .insert({
        account_owner_id: accountOwnerId,
        property_id: data.propertyId ?? null,
        owner_contact_id: data.ownerContactId ?? null,
        log_id: data.logId ?? null,
        reservation_id: data.reservationId ?? null,
        title: data.title,
        description: data.description ?? null,
        category: data.category,
        priority: data.priority,
        due_date: data.dueDate ?? null,
        show_in_cleaning: data.showInCleaning,
        amount_spent_cents: data.amountSpentCents ?? null,
        recurrence_days: data.recurrenceDays ?? null,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: (inserted as { id: string }).id };
  });

// ----- Concluir / reabrir / arquivar (pendências pontuais e gestão geral) -----

const SetTaskStatusInput = z.object({
  taskId: z.string().uuid(),
  status: z.enum(["pending", "done", "canceled"]),
  /** Só relevante ao concluir ("done") uma pendência que ainda não tinha
   * valor — ver diálogo "teve gasto nessa tarefa?" na UI. */
  amountSpentCents: z.number().int().min(0).nullable().optional(),
});

export const setTaskStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SetTaskStatusInput.parse(i))
  .handler(async ({ data, context }) => {
    const db = context.supabase as unknown as AnyClient;
    const patch: Record<string, unknown> = {
      status: data.status,
      completed_at: data.status === "done" ? new Date().toISOString() : null,
    };
    if (data.amountSpentCents !== undefined) patch.amount_spent_cents = data.amountSpentCents;

    if (data.status === "done") {
      // Pendência com recorrência em dias: o ciclo não "fecha pra sempre" —
      // volta pendente sozinha com um novo prazo N dias à frente (pedido
      // explícito, ex.: "trocar filtro a cada 90 dias").
      const { data: row, error: readErr } = await db
        .from("tasks")
        .select("recurrence_days")
        .eq("id", data.taskId)
        .single();
      if (readErr) throw new Error("Pendência não encontrada ou sem acesso.");
      const recurrenceDays = (row as { recurrence_days: number | null } | null)?.recurrence_days ?? null;
      if (recurrenceDays) {
        const next = new Date();
        next.setDate(next.getDate() + recurrenceDays);
        patch.status = "pending";
        patch.due_date = next.toISOString().slice(0, 10);
        // completed_at continua marcado (registra a última conclusão), só o
        // status/prazo é que avançam pro próximo ciclo automaticamente.
      }
    }

    const { error } = await db.from("tasks").update(patch).eq("id", data.taskId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ----- Checklist da Limpeza: marcar/desmarcar uma pendência RECORRENTE só
// para esta ocorrência (não fecha a pendência — ela volta pendente na
// próxima limpeza) -----

const ToggleCleaningInput = z
  .object({
    taskId: z.string().uuid(),
    logId: z.string().uuid().nullable().optional(),
    reservationId: z.string().uuid().nullable().optional(),
    /** Só usado ao MARCAR (nunca ao desmarcar) — gasto desta ocorrência
     * específica, quando a pendência não tinha valor padrão definido. */
    amountSpentCents: z.number().int().min(0).nullable().optional(),
  })
  .refine((v) => !!v.logId || !!v.reservationId, { message: "Informe a estadia (log ou reserva)." });

export const toggleCleaningCompletion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ToggleCleaningInput.parse(i))
  .handler(async ({ data, context }): Promise<{ checked: boolean }> => {
    const db = context.supabase as unknown as AnyClient;
    const orParts: string[] = [];
    if (data.logId) orParts.push(`log_id.eq.${data.logId}`);
    if (data.reservationId) orParts.push(`reservation_id.eq.${data.reservationId}`);
    const { data: existing, error: findErr } = await db
      .from("task_completions")
      .select("id")
      .eq("task_id", data.taskId)
      .or(orParts.join(","))
      .limit(1);
    if (findErr) throw new Error(findErr.message);
    const existingId = (existing?.[0] as { id: string } | undefined)?.id;
    if (existingId) {
      const { error } = await db.from("task_completions").delete().eq("id", existingId);
      if (error) throw new Error(error.message);
      return { checked: false };
    }
    const { error } = await db.from("task_completions").insert({
      task_id: data.taskId,
      log_id: data.logId ?? null,
      reservation_id: data.reservationId ?? null,
      amount_spent_cents: data.amountSpentCents ?? null,
      completed_by: context.userId,
    });
    if (error) throw new Error(error.message);
    return { checked: true };
  });
