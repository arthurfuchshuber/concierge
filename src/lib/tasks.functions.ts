// Server functions de Tarefas/Pendências — botão "PENDÊNCIAS" do Kanban
// (agrupado por proprietário/imóvel/imóvel+hóspede) e checklist do card de
// Limpeza. Mesmos padrões já usados em dashboard.functions.ts:
// createServerFn + requireSupabaseAuth + zod, com o cliente Supabase
// "solto" (AnyClient) pras tabelas que ainda não estão no types.ts gerado —
// igual arrival-board.server.ts já faz.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { defaultShowInCleaning } from "@/lib/tasks-types";
import type {
  TaskCategory,
  TaskCompletion,
  TaskLinkOwner,
  TaskLinkProperty,
  TaskLinkProvider,
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
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      properties: TaskLinkProperty[];
      owners: TaskLinkOwner[];
      providers: TaskLinkProvider[];
    }> => {
      const { accessiblePropertyIds } = await import("@/lib/dashboard.functions");
      const { resolveAuthorizedAccountOwnerId } = await import("@/lib/account-scope.server");
      const db = context.supabase as unknown as AnyClient;

      const [propIds, accountOwnerId] = await Promise.all([
        accessiblePropertyIds(context.supabase as never, data.ownerId ?? null, context.userId),
        resolveAuthorizedAccountOwnerId(
          context.supabase as never,
          context.userId,
          data.ownerId ?? null,
        ),
      ]);

      const [{ data: props }, { data: ownerRows }, { data: providerRows }] = await Promise.all([
        propIds.length > 0
          ? db
              .from("properties")
              .select("id, name, owner_contact_id")
              .in("id", propIds)
              .order("name")
          : Promise.resolve({ data: [] }),
        db
          .from("property_owners")
          .select("id, name, trade_name")
          .eq("account_owner_id", accountOwnerId)
          .neq("status", "canceled")
          .order("name"),
        // Prestadores ativos — alimentam "quem resolveu" ao concluir uma
        // pendência. Vêm junto nesta mesma função (em vez de uma busca à
        // parte) porque a tela de Pendências já consome ela.
        db
          .from("service_providers")
          .select("id, name, trade_name, category, categories, city, status")
          .eq("account_owner_id", accountOwnerId)
          .eq("status", "active")
          .order("name"),
      ]);

      const ownerNameById = new Map<string, string>();
      for (const o of (ownerRows ?? []) as Array<{
        id: string;
        name: string | null;
        trade_name: string | null;
      }>) {
        const label = (o.trade_name || o.name || "").trim();
        if (label) ownerNameById.set(o.id, label);
      }

      const properties: TaskLinkProperty[] = (
        (props ?? []) as Array<{
          id: string;
          name: string | null;
          owner_contact_id: string | null;
        }>
      ).map((p) => ({
        id: p.id,
        name: p.name ?? "Sem nome",
        ownerContactId: p.owner_contact_id,
        ownerName: p.owner_contact_id ? (ownerNameById.get(p.owner_contact_id) ?? null) : null,
      }));

      const owners: TaskLinkOwner[] = Array.from(ownerNameById.entries())
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

      const providers: TaskLinkProvider[] = (
        (providerRows ?? []) as Array<{
          id: string;
          name: string | null;
          trade_name: string | null;
          category: string | null;
          categories: string[] | null;
          city: string | null;
        }>
      )
        .map((p) => ({
          id: p.id,
          name: (p.trade_name || p.name || "").trim() || "Sem nome",
          city: (p.city ?? "").trim() || null,
          // `categories` (lista) é o campo atual; `category` (texto) é o
          // legado de quando havia só uma — vale como reserva.
          categories: (p.categories ?? (p.category ? [p.category] : [])).filter(Boolean),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

      return { properties, owners, providers };
    },
  );

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
  .handler(
    async ({ data, context }): Promise<{ tasks: TaskRow[]; completions: TaskCompletion[] }> => {
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
          "id, title, description, category, priority, due_date, show_in_cleaning, status, completed_at, created_at, property_id, owner_contact_id, log_id, reservation_id, amount_spent_cents, recurrence_days, resolved_by_provider_id, resolution_note",
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
        resolved_by_provider_id: string | null;
        resolution_note: string | null;
      }>;

      // Nomes de imóvel/proprietário em 2 buscas em lote (mesma técnica do
      // getOccupancyBoard) — evita N+1. O "proprietário" de uma pendência
      // vinculada só ao imóvel é herdado do dono cadastrado do imóvel.
      const propIdsUsed = Array.from(
        new Set(raw.map((r) => r.property_id).filter((v): v is string => !!v)),
      );
      const { data: propRows } =
        propIdsUsed.length > 0
          ? await db.from("properties").select("id, name, owner_contact_id").in("id", propIdsUsed)
          : { data: [] };
      const propById = new Map(
        (
          (propRows ?? []) as Array<{
            id: string;
            name: string | null;
            owner_contact_id: string | null;
          }>
        ).map((p) => [p.id, p]),
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
      for (const o of (ownerRows ?? []) as Array<{
        id: string;
        name: string | null;
        trade_name: string | null;
      }>) {
        const label = (o.trade_name || o.name || "").trim();
        if (label) ownerNameById.set(o.id, label);
      }

      // Nome de quem resolveu — mesma técnica em lote das duas buscas acima.
      const providerIdsUsed = Array.from(
        new Set(raw.map((r) => r.resolved_by_provider_id).filter((v): v is string => !!v)),
      );
      const { data: providerRows } =
        providerIdsUsed.length > 0
          ? await db
              .from("service_providers")
              .select("id, name, trade_name")
              .in("id", providerIdsUsed)
          : { data: [] };
      const providerNameById = new Map<string, string>();
      for (const p of (providerRows ?? []) as Array<{
        id: string;
        name: string | null;
        trade_name: string | null;
      }>) {
        const label = (p.trade_name || p.name || "").trim();
        if (label) providerNameById.set(p.id, label);
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
          resolvedByProviderId: r.resolved_by_provider_id,
          resolvedByProviderName: r.resolved_by_provider_id
            ? (providerNameById.get(r.resolved_by_provider_id) ?? null)
            : null,
          resolutionNote: r.resolution_note,
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
    },
  );

// ----- Criar -----

const CreateTaskInput = z
  .object({
    ownerId: z.string().uuid().nullable().optional(),
    title: z.string().trim().min(1, "Título obrigatório.").max(200),
    description: z.string().trim().max(1000).nullable().optional(),
    category: z
      .enum([
        "maintenance",
        "financial",
        "guest_request",
        "purchase",
        "inspection",
        "cleaning",
        "other",
      ])
      .default("other"),
    priority: z.enum(["low", "medium", "high"]).default("medium"),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    /** Omitido = usa o padrão da categoria (ver defaultShowInCleaning):
     * manutenção nasce visível para a limpeza, o resto nasce oculto. */
    showInCleaning: z.boolean().optional(),
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
        show_in_cleaning: data.showInCleaning ?? defaultShowInCleaning(data.category),
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
   * valor — ver diálogo de conclusão na UI. */
  amountSpentCents: z.number().int().min(0).nullable().optional(),
  /** Prestação de contas da conclusão (pedido explícito, 07/09/2026) — os
   * dois OPCIONAIS: dá pra concluir sem informar nada, como antes. */
  resolvedByProviderId: z.string().uuid().nullable().optional(),
  resolutionNote: z.string().trim().max(2000).nullable().optional(),
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
    if (data.resolvedByProviderId !== undefined)
      patch.resolved_by_provider_id = data.resolvedByProviderId;
    if (data.resolutionNote !== undefined) patch.resolution_note = data.resolutionNote || null;
    // Reabrir limpa a prestação de contas da conclusão anterior — senão a
    // pendência volta pendente ainda exibindo "resolvida por Fulano".
    if (data.status === "pending") {
      patch.resolved_by_provider_id = null;
      patch.resolution_note = null;
    }

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
      const recurrenceDays =
        (row as { recurrence_days: number | null } | null)?.recurrence_days ?? null;
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
    /** Prestação de contas desta ocorrência: a tela de conclusão pergunta
     * quem resolveu e como — antes esses campos eram descartados aqui. */
    resolvedByProviderId: z.string().uuid().nullable().optional(),
    resolutionNote: z.string().max(2000).nullable().optional(),
  })
  .refine((v) => !!v.logId || !!v.reservationId, {
    message: "Informe a estadia (log ou reserva).",
  });

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
      resolved_by_provider_id: data.resolvedByProviderId ?? null,
      resolution_note: data.resolutionNote?.trim() || null,
      completed_by: context.userId,
    });
    if (error) throw new Error(error.message);
    return { checked: true };
  });

// ----- Excluir UMA ocorrência de uma pendência recorrente -----
//
// Pedido explícito (09/09/2026): "ao clicar no botão excluir, se houver mais
// de uma task vinculada, então o sistema deve perguntar se é para excluir só
// aquela recorrência ou se todas as recorrências futuras — tipo quando vai
// excluir uma agenda do Google".
//
// Vale dizer como o dado é, porque isso decide o que cada opção faz. Uma
// pendência recorrente NÃO é uma fileira de linhas no banco: é UMA linha só,
// com `recurrence_days`, que volta a ficar pendente com um prazo novo toda
// vez que é concluída. Então:
//
//   • "todas as recorrências futuras" = arquivar a linha (setTaskStatus
//     "canceled") — a que a tela já sabia fazer, e a única que existia;
//   • "somente esta ocorrência"       = PULAR o ciclo atual: o prazo anda
//     `recurrence_days` pra frente e a pendência continua viva. É esta.
//
// O prazo novo é contado a partir do prazo atual (não de hoje), pra a série
// não escorregar um pouquinho a cada vez que alguém pula uma ocorrência. Sem
// prazo registrado, hoje é o ponto de partida — é o melhor palpite disponível.
const SkipTaskOccurrenceInput = z.object({ taskId: z.string().uuid() });

export const skipTaskOccurrence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SkipTaskOccurrenceInput.parse(i))
  .handler(async ({ data, context }): Promise<{ dueDate: string }> => {
    const db = context.supabase as unknown as AnyClient;
    const { data: row, error: readErr } = await db
      .from("tasks")
      .select("recurrence_days, due_date")
      .eq("id", data.taskId)
      .single();
    if (readErr) throw new Error("Pendência não encontrada ou sem acesso.");
    const task = row as { recurrence_days: number | null; due_date: string | null } | null;
    const recurrenceDays = task?.recurrence_days ?? null;
    if (!recurrenceDays) throw new Error("Esta pendência não é recorrente.");
    const base = task?.due_date ?? todayISO();
    let next = addDaysISO(base, recurrenceDays);
    // Se o prazo estava atrasado, um único salto pode cair no passado. Anda
    // até sair na frente de hoje — pular uma ocorrência nunca pode devolver
    // uma pendência que já nasce vencida.
    const hoje = todayISO();
    while (next <= hoje) next = addDaysISO(next, recurrenceDays);
    const { error } = await db
      .from("tasks")
      .update({ status: "pending", due_date: next })
      .eq("id", data.taskId);
    if (error) throw new Error(error.message);
    return { dueDate: next };
  });

// ----- Excluir DEFINITIVAMENTE (não é arquivar) -----
//
// Pedido explícito (09/09/2026): "quero que você exclua definitivamente de
// tudo, não quero arquivar, quero que você exclua 100%".
//
// Arquivar (`status = "canceled"`) some da tela mas a linha continua no banco,
// e essa distinção importa: quando alguém cria por engano uma rotina em quinze
// imóveis, arquivar deixa quinze lixos permanentes atrás de um filtro. O que
// se quer ali é desfazer, não encerrar.
//
// As duas chaves estrangeiras já resolvem o que fica para trás — verificado no
// banco antes de escrever isto: `task_completions.task_id` é ON DELETE CASCADE
// (as marcas de "feito nesta limpeza" morrem com a pendência, que é o certo:
// sozinhas não significam nada) e `reservation_records.task_id` é ON DELETE
// SET NULL (o registro/comprovante da reserva SOBREVIVE, só deixa de apontar
// para a pendência — apagar o comprovante junto seria apagar histórico).
//
// A permissão é a mesma de sempre: a policy "Account can manage tasks" cobre
// ALL, então quem não pode gerir aquela pendência simplesmente não apaga
// nenhuma linha.
const DeleteTasksInput = z.object({ taskIds: z.array(z.string().uuid()).min(1).max(200) });

export const deleteTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => DeleteTasksInput.parse(i))
  .handler(async ({ data, context }): Promise<{ deleted: number }> => {
    const db = context.supabase as unknown as AnyClient;
    const { data: rows, error } = await db
      .from("tasks")
      .delete()
      .in("id", data.taskIds)
      .select("id");
    if (error) throw new Error(error.message);
    return { deleted: (rows ?? []).length };
  });

// ----- Arquivar VÁRIAS de uma vez -----
//
// Mesmo raciocínio da criação em lote: "arquive todas as pendências que você
// criou agora" é UM pedido, e virava N cartões de confirmação. Uma chamada,
// uma confirmação, a lista inteira.
const SetTasksStatusInput = z.object({
  taskIds: z.array(z.string().uuid()).min(1).max(200),
  status: z.enum(["pending", "canceled"]),
});

export const setTasksStatusBulk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SetTasksStatusInput.parse(i))
  .handler(async ({ data, context }): Promise<{ updated: number }> => {
    const db = context.supabase as unknown as AnyClient;
    const { data: rows, error } = await db
      .from("tasks")
      .update({ status: data.status, completed_at: null })
      .in("id", data.taskIds)
      .select("id");
    if (error) throw new Error(error.message);
    return { updated: (rows ?? []).length };
  });
