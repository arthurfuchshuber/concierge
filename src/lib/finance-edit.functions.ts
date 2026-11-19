// EDIÇÃO DOS LANÇAMENTOS DO FINANCEIRO (mockups Fin-14..21, aprovados em 18/11/2026).
//
// O detalhe de uma limpeza ou de um serviço extra abre uma janela de edição para
// cada campo alterável: valor, prestador, tipo, data e hora da conclusão, título e
// descrição da situação e as fotos/vídeos. Valor e tipo da LIMPEZA continuam em
// `cleaning-price.functions.ts` e o prestador da limpeza em
// `cleaning-assign.functions.ts`; aqui ficam os campos que ainda não tinham caminho.
//
// Autorização: o dono da conta do imóvel ou um membro ativo com "Agir na operação"
// (`operation_edit`), a mesma regra do ajuste de valor. A escrita usa a sessão da
// pessoa (RLS), então o servidor nunca escreve onde ela não poderia.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cliente sem tipos de tabela, como em finance-entry.functions
type AnyClient = { from: (t: string) => any };

async function requireOperationEdit(
  db: AnyClient,
  userId: string,
  propertyId: string,
  supabase: unknown,
) {
  const { data: prop } = await db
    .from("properties")
    .select("owner_id")
    .eq("id", propertyId)
    .maybeSingle();
  const ownerId = (prop as { owner_id?: string | null } | null)?.owner_id;
  if (!ownerId) throw new Error("Sem permissão para esta ação.");
  const { requireMemberPermission } = await import("./member-permissions.server");
  await requireMemberPermission(supabase as never, userId, ownerId, "operation_edit");
  return ownerId;
}

async function audit(db: AnyClient, row: Record<string, unknown>) {
  try {
    await db.from("audit_logs").insert(row as never);
  } catch {
    /* auditoria é best-effort */
  }
}

/** Data e hora da conclusão de uma LIMPEZA (linha de saída em `guest_arrival_status`). */
export const setCleaningConcludedAt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({ statusId: z.string().uuid(), concludedAt: z.string().datetime({ offset: true }) })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as unknown as AnyClient;
    const { data: row } = await db
      .from("guest_arrival_status")
      .select("id, property_id, concluded_at")
      .eq("id", data.statusId)
      .eq("kind", "checkout")
      .maybeSingle();
    const r = row as { id: string; property_id: string; concluded_at: string | null } | null;
    if (!r || !r.concluded_at) throw new Error("Esta limpeza ainda não foi concluída.");
    if (new Date(data.concludedAt).getTime() > Date.now() + 60_000) {
      throw new Error("A conclusão não pode ficar no futuro.");
    }
    await requireOperationEdit(db, context.userId, r.property_id, context.supabase);
    const iso = new Date(data.concludedAt).toISOString();
    const { data: done, error } = await db
      .from("guest_arrival_status")
      .update({ concluded_at: iso } as never)
      .eq("id", r.id)
      .select("id");
    if (error || !(done ?? []).length)
      throw new Error("Você não tem permissão para alterar esta limpeza.");
    await audit(db, {
      user_id: context.userId,
      action: "cleaning_concluded_at_change",
      table_name: "guest_arrival_status",
      record_id: r.id,
      old_data: { concluded_at: r.concluded_at },
      new_data: { concluded_at: iso },
    });
    return { ok: true };
  });

type ExtraRow = {
  table: "tasks" | "task_completions";
  id: string;
  taskId: string;
  propertyId: string;
  title: string | null;
  description: string | null;
  cents: number | null;
  at: string | null;
  providerId: string | null;
};

/** Serviço extra: a própria tarefa ou a conclusão de uma tarefa recorrente. */
async function findExtra(db: AnyClient, id: string): Promise<ExtraRow | null> {
  const { data: t } = await db
    .from("tasks")
    .select(
      "id, property_id, title, description, amount_spent_cents, completed_at, resolved_by_provider_id",
    )
    .eq("id", id)
    .maybeSingle();
  if (t?.property_id) {
    return {
      table: "tasks",
      id: t.id,
      taskId: t.id,
      propertyId: t.property_id,
      title: t.title ?? null,
      description: t.description ?? null,
      cents: t.amount_spent_cents ?? null,
      at: t.completed_at ?? null,
      providerId: t.resolved_by_provider_id ?? null,
    };
  }
  const { data: c } = await db
    .from("task_completions")
    .select("id, task_id, amount_spent_cents, completed_at, resolved_by_provider_id")
    .eq("id", id)
    .maybeSingle();
  if (!c) return null;
  const { data: p } = await db
    .from("tasks")
    .select("id, property_id, title, description")
    .eq("id", c.task_id)
    .maybeSingle();
  if (!p?.property_id) return null;
  return {
    table: "task_completions",
    id: c.id,
    taskId: p.id,
    propertyId: p.property_id,
    title: p.title ?? null,
    description: p.description ?? null,
    cents: c.amount_spent_cents ?? null,
    at: c.completed_at ?? null,
    providerId: c.resolved_by_provider_id ?? null,
  };
}

/**
 * Altera um SERVIÇO EXTRA: valor, data e hora da conclusão, prestador que executou,
 * título e descrição da situação. Só os campos enviados mudam.
 */
export const updateExtraService = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        priceCents: z.number().int().min(1).max(100_000_00).optional(),
        completedAt: z.string().datetime({ offset: true }).optional(),
        providerId: z.string().uuid().nullable().optional(),
        title: z.string().trim().min(1).max(200).optional(),
        description: z.string().trim().max(4000).nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as unknown as AnyClient;
    const r = await findExtra(db, data.id);
    if (!r) throw new Error("Serviço não encontrado.");
    const ownerId = await requireOperationEdit(db, context.userId, r.propertyId, context.supabase);

    if (data.completedAt && new Date(data.completedAt).getTime() > Date.now() + 60_000) {
      throw new Error("A conclusão não pode ficar no futuro.");
    }
    if (data.providerId) {
      const { data: prov } = await db
        .from("service_providers")
        .select("account_owner_id")
        .eq("id", data.providerId)
        .maybeSingle();
      if (!prov || prov.account_owner_id !== ownerId) {
        throw new Error("Este prestador não pertence à conta deste imóvel.");
      }
    }

    // Valor, data e prestador moram na linha do lançamento (tarefa ou conclusão).
    const own: Record<string, unknown> = {};
    if (data.priceCents !== undefined) own.amount_spent_cents = data.priceCents;
    if (data.completedAt !== undefined) own.completed_at = new Date(data.completedAt).toISOString();
    if (data.providerId !== undefined) own.resolved_by_provider_id = data.providerId;
    if (Object.keys(own).length > 0) {
      const { data: done, error } = await db
        .from(r.table)
        .update(own as never)
        .eq("id", r.id)
        .select("id");
      if (error || !(done ?? []).length)
        throw new Error("Você não tem permissão para alterar este serviço.");
    }

    // Título e descrição são da situação (a tarefa; na recorrente, a tarefa-mãe).
    const text: Record<string, unknown> = {};
    if (data.title !== undefined) text.title = data.title;
    if (data.description !== undefined) text.description = data.description || null;
    if (Object.keys(text).length > 0) {
      const { data: done, error } = await db
        .from("tasks")
        .update(text as never)
        .eq("id", r.taskId)
        .select("id");
      if (error || !(done ?? []).length)
        throw new Error("Você não tem permissão para alterar este serviço.");
    }

    await audit(db, {
      user_id: context.userId,
      action: "extra_service_edit",
      table_name: r.table,
      record_id: r.id,
      old_data: {
        cents: r.cents,
        completed_at: r.at,
        provider_id: r.providerId,
        title: r.title,
        description: r.description,
      },
      new_data: { ...own, ...text },
    });
    return { ok: true };
  });

/**
 * Anexa uma foto/vídeo já enviado ao armazenamento à conferência de uma LIMPEZA
 * (registros com `card_mode = "cleaning"`, os mesmos que o detalhe lê).
 */
export const attachCleaningRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        statusId: z.string().uuid(),
        path: z.string().min(3).max(500),
        kind: z.enum(["photo", "video"]),
        mime: z.string().min(1).max(150),
        sizeBytes: z.number().int().nonnegative(),
        fileName: z.string().max(200).nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as unknown as AnyClient;
    const { data: row } = await db
      .from("guest_arrival_status")
      .select("id, property_id, log_id, reservation_id")
      .eq("id", data.statusId)
      .eq("kind", "checkout")
      .maybeSingle();
    const r = row as {
      id: string;
      property_id: string;
      log_id: string | null;
      reservation_id: string | null;
    } | null;
    if (!r) throw new Error("Limpeza não encontrada.");
    if (!r.log_id && !r.reservation_id)
      throw new Error("Esta limpeza não tem reserva ligada para guardar fotos.");
    if (!data.path.startsWith(`${r.property_id}/`)) throw new Error("Caminho de anexo inválido.");
    await requireOperationEdit(db, context.userId, r.property_id, context.supabase);
    const { data: prof } = await db
      .from("profiles")
      .select("full_name, email")
      .eq("id", context.userId)
      .maybeSingle();
    const who =
      ((prof?.full_name as string | null) || (prof?.email as string | null) || "").trim() || null;
    const { data: inserted, error } = await db
      .from("reservation_records")
      .insert({
        property_id: r.property_id,
        log_id: r.log_id,
        reservation_id: r.reservation_id,
        card_mode: "cleaning",
        category: "other",
        kind: data.kind,
        storage_path: data.path,
        mime: data.mime,
        size_bytes: data.sizeBytes,
        file_name: data.fileName ?? null,
        body: null,
        created_by: context.userId,
        created_by_name: who,
      } as never)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { ok: true, id: (inserted as { id?: string } | null)?.id ?? null };
  });
