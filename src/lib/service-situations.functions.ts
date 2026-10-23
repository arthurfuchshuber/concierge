// Server functions da aba Serviços: situações (CRUD) e estatísticas dos
// "Serviços Extras" (tudo que foi resolvido e NÃO é limpeza).
//
// REGRA DE VISIBILIDADE (doc "regra-visibilidade-por-vinculo"): cada perfil vê
// só o que está ligado a ele. Aqui isso vale em duas camadas:
//  1) imóveis: `accessiblePropertyIds` (RLS + residências atendidas);
//  2) prestador: quem entra como prestador (e não é o dono da conta) só vê os
//     serviços em que ele consta como "quem resolveu".
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  SITUATION_DETAIL_MAX,
  SITUATION_NAME_MAX,
  SYSTEM_SITUATIONS,
  isSystemSituation,
  titleCaseSituation,
  type ExtraServiceItem,
  type ServiceSituation,
} from "@/lib/service-situations";

type AnyClient = { from: (t: string) => any };

const IsoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

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
const localDateOf = (iso: string) =>
  new Date(new Date(iso).getTime() - 3 * 3600_000).toISOString().slice(0, 10);

async function accountOwner(context: { supabase: unknown; userId: string }, ownerId?: string | null) {
  const { resolveAuthorizedAccountOwnerId } = await import("@/lib/account-scope.server");
  return resolveAuthorizedAccountOwnerId(context.supabase as never, context.userId, ownerId ?? null);
}

function toSituation(r: { id: string; name: string; detail: string | null }): ServiceSituation {
  return { id: r.id, name: r.name, detail: r.detail, system: false };
}

// ----- Lista (para o "+" e para resolver nomes) -----

export const listServiceSituations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ ownerId: z.string().uuid().nullable().optional() }).parse(i ?? {}))
  .handler(async ({ data, context }): Promise<{ situations: ServiceSituation[] }> => {
    const owner = await accountOwner(context, data.ownerId);
    const db = context.supabase as unknown as AnyClient;
    const { data: rows, error } = await db
      .from("service_situations")
      .select("id, name, detail")
      .eq("account_owner_id", owner)
      .is("deleted_at", null)
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    const system: ServiceSituation[] = SYSTEM_SITUATIONS.map((s) => ({
      id: s.key,
      name: s.name,
      detail: s.detail,
      system: true,
    }));
    return {
      situations: [...system, ...((rows ?? []) as Array<{ id: string; name: string; detail: string | null }>).map(toSituation)],
    };
  });

// ----- Criar / editar / excluir (só as do usuário) -----

const SituationInput = z.object({
  ownerId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1, "Dê um título à situação.").max(SITUATION_NAME_MAX),
  detail: z.string().trim().max(SITUATION_DETAIL_MAX).nullable().optional(),
});

async function assertNameFree(db: AnyClient, owner: string, name: string, exceptId?: string) {
  if (SYSTEM_SITUATIONS.some((s) => s.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"))) {
    throw new Error("Já existe uma situação com esse nome.");
  }
  const { data: rows } = await db
    .from("service_situations")
    .select("id, name")
    .eq("account_owner_id", owner)
    .is("deleted_at", null);
  const clash = ((rows ?? []) as Array<{ id: string; name: string }>).some(
    (r) => r.id !== exceptId && r.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"),
  );
  if (clash) throw new Error("Já existe uma situação com esse nome.");
}

export const createServiceSituation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SituationInput.parse(i))
  .handler(async ({ data, context }): Promise<ServiceSituation> => {
    const owner = await accountOwner(context, data.ownerId);
    const db = context.supabase as unknown as AnyClient;
    const name = titleCaseSituation(data.name);
    await assertNameFree(db, owner, name);
    const { data: row, error } = await db
      .from("service_situations")
      .insert({
        account_owner_id: owner,
        name,
        detail: data.detail?.trim() || null,
        created_by: context.userId,
      })
      .select("id, name, detail")
      .single();
    if (error) throw new Error(error.message);
    return toSituation(row as { id: string; name: string; detail: string | null });
  });

export const updateServiceSituation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SituationInput.extend({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<ServiceSituation> => {
    const owner = await accountOwner(context, data.ownerId);
    const db = context.supabase as unknown as AnyClient;
    const name = titleCaseSituation(data.name);
    await assertNameFree(db, owner, name, data.id);
    const { data: row, error } = await db
      .from("service_situations")
      .update({ name, detail: data.detail?.trim() || null, updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("account_owner_id", owner)
      .is("deleted_at", null)
      .select("id, name, detail")
      .single();
    if (error) throw new Error(error.message);
    return toSituation(row as { id: string; name: string; detail: string | null });
  });

/**
 * Exclusão "mole": a linha fica (deleted_at) para o histórico continuar
 * mostrando o nome nos serviços já registrados; só some das listas.
 */
export const deleteServiceSituation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ ownerId: z.string().uuid().nullable().optional(), id: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const owner = await accountOwner(context, data.ownerId);
    const db = context.supabase as unknown as AnyClient;
    const { error } = await db
      .from("service_situations")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("account_owner_id", owner);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ----- Estatísticas dos Serviços Extras -----

const ExtrasInput = z.object({
  ownerId: z.string().uuid().nullable().optional(),
  propertyIds: z.array(z.string().uuid()).optional(),
  rangeStart: IsoDay.optional(),
  rangeEnd: IsoDay.optional(),
});

export type ExtraDailyPoint = { date: string; count: number; totalCents: number };
export type ExtraBreakdownItem = {
  propertyId: string;
  propertyName: string;
  ownerName: string | null;
  ownerPhone: string | null;
  ownerPhoneCountry: string | null;
  count: number;
  totalCents: number;
};
export type ExtrasStats = {
  /** Todas as ocorrências (todas as situações não-limpeza) do período. O recorte
   * por situação é feito no cliente — assim o filtro troca na hora, sem nova ida
   * ao servidor, e a contagem por situação sai do mesmo dado. */
  items: ExtraServiceItem[];
  /** Situações próprias (inclusive excluídas) para resolver nomes do histórico. */
  names: Record<string, string>;
};

export const getServiceExtras = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ExtrasInput.parse(i ?? {}))
  .handler(async ({ data, context }): Promise<ExtrasStats> => {
    const { accessiblePropertyIds } = await import("@/lib/dashboard.functions");
    const owner = await accountOwner(context, data.ownerId);
    const db = context.supabase as unknown as AnyClient;
    let propIds = await accessiblePropertyIds(context.supabase as never, data.ownerId ?? null, context.userId);
    if (data.propertyIds) {
      const allowed = new Set(data.propertyIds);
      propIds = propIds.filter((id) => allowed.has(id));
    }
    const empty: ExtrasStats = { items: [], names: {} };
    if (propIds.length === 0) return empty;

    const day0 = data.rangeStart ?? todayISO();
    const day1 = data.rangeEnd ?? day0;
    const from = `${day0}T03:00:00.000Z`;
    const to = `${addDaysISO(day1, 1)}T03:00:00.000Z`;

    // Prestador (não dono da conta): só o que ele resolveu.
    let onlyProviderId: string | null = null;
    if (context.userId !== owner) {
      const { data: me } = await db
        .from("service_providers")
        .select("id")
        .eq("account_owner_id", owner)
        .eq("member_user_id", context.userId)
        .maybeSingle();
      onlyProviderId = (me as { id: string } | null)?.id ?? null;
    }

    // 1) Pendências pontuais concluídas no período.
    let tq = db
      .from("tasks")
      .select(
        "id, title, situation, property_id, log_id, reservation_id, amount_spent_cents, completed_at, resolved_by_provider_id",
      )
      .eq("account_owner_id", owner)
      .eq("status", "done")
      .or("situation.is.null,situation.neq.cleaning")
      .in("property_id", propIds)
      .gte("completed_at", from)
      .lt("completed_at", to)
      .limit(5000);
    if (onlyProviderId) tq = tq.eq("resolved_by_provider_id", onlyProviderId);
    const { data: tasks, error } = await tq;
    if (error) throw new Error(error.message);

    // 2) Conclusões de recorrentes (task_completions), com a situação da tarefa-mãe.
    let cq = db
      .from("task_completions")
      .select("id, task_id, log_id, reservation_id, amount_spent_cents, completed_at, resolved_by_provider_id")
      .gte("completed_at", from)
      .lt("completed_at", to)
      .limit(5000);
    if (onlyProviderId) cq = cq.eq("resolved_by_provider_id", onlyProviderId);
    const { data: comps } = await cq;

    type T = {
      id: string;
      title: string;
      situation: string | null;
      property_id: string | null;
      log_id: string | null;
      reservation_id: string | null;
      amount_spent_cents: number | null;
      completed_at: string | null;
      resolved_by_provider_id: string | null;
    };
    type C = {
      id: string;
      task_id: string;
      log_id: string | null;
      reservation_id: string | null;
      amount_spent_cents: number | null;
      completed_at: string | null;
      resolved_by_provider_id: string | null;
    };
    const compRows = (comps ?? []) as C[];
    const parentIds = Array.from(new Set(compRows.map((c) => c.task_id)));
    const parents = new Map<string, T>();
    if (parentIds.length > 0) {
      const { data: ps } = await db
        .from("tasks")
        .select("id, title, situation, property_id, log_id, reservation_id, amount_spent_cents, completed_at, resolved_by_provider_id")
        .eq("account_owner_id", owner)
        .in("id", parentIds);
      for (const p of (ps ?? []) as T[]) parents.set(p.id, p);
    }

    type Row = {
      id: string;
      title: string;
      situation: string;
      propertyId: string;
      logId: string | null;
      reservationId: string | null;
      cents: number | null;
      at: string;
      providerId: string | null;
    };
    const rows: Row[] = [];
    for (const t of (tasks ?? []) as T[]) {
      if (!t.property_id || !t.completed_at) continue;
      rows.push({
        id: t.id,
        title: t.title,
        situation: t.situation ?? "other",
        propertyId: t.property_id,
        logId: t.log_id,
        reservationId: t.reservation_id,
        cents: t.amount_spent_cents,
        at: t.completed_at,
        providerId: t.resolved_by_provider_id,
      });
    }
    const allowedProps = new Set(propIds);
    for (const c of compRows) {
      const p = parents.get(c.task_id);
      if (!p || !p.property_id || !c.completed_at) continue;
      if ((p.situation ?? "other") === "cleaning") continue;
      if (!allowedProps.has(p.property_id)) continue;
      rows.push({
        id: c.id,
        title: p.title,
        situation: p.situation ?? "other",
        propertyId: p.property_id,
        logId: c.log_id,
        reservationId: c.reservation_id,
        cents: c.amount_spent_cents,
        at: c.completed_at,
        providerId: c.resolved_by_provider_id,
      });
    }
    if (rows.length === 0) return empty;

    // Nomes: imóveis, proprietários, prestadores, situações próprias.
    const propIdsUsed = Array.from(new Set(rows.map((r) => r.propertyId)));
    const { data: props } = await db
      .from("properties")
      .select("id, name, owner_contact_id")
      .in("id", propIdsUsed);
    const propById = new Map(
      ((props ?? []) as Array<{ id: string; name: string | null; owner_contact_id: string | null }>).map((p) => [p.id, p]),
    );
    const ownerIds = Array.from(
      new Set(Array.from(propById.values()).map((p) => p.owner_contact_id).filter((v): v is string => !!v)),
    );
    const ownerById = new Map<string, { name: string; phone: string | null; country: string | null }>();
    if (ownerIds.length > 0) {
      const { data: os } = await db
        .from("property_owners")
        .select("id, name, trade_name, phone, phone_country")
        .in("id", ownerIds);
      for (const o of (os ?? []) as Array<{
        id: string;
        name: string | null;
        trade_name: string | null;
        phone: string | null;
        phone_country: string | null;
      }>) {
        ownerById.set(o.id, {
          name: (o.trade_name || o.name || "").trim(),
          phone: o.phone ?? null,
          country: o.phone_country ?? null,
        });
      }
    }
    const provIds = Array.from(new Set(rows.map((r) => r.providerId).filter((v): v is string => !!v)));
    const provName = new Map<string, string>();
    if (provIds.length > 0) {
      const { data: pv } = await db.from("service_providers").select("id, name, trade_name").in("id", provIds);
      for (const p of (pv ?? []) as Array<{ id: string; name: string | null; trade_name: string | null }>) {
        provName.set(p.id, (p.trade_name || p.name || "").trim());
      }
    }
    const customIds = Array.from(new Set(rows.map((r) => r.situation).filter((s) => !isSystemSituation(s))));
    const names: Record<string, string> = {};
    for (const s of SYSTEM_SITUATIONS) names[s.key] = s.name;
    if (customIds.length > 0) {
      const { data: ss } = await db.from("service_situations").select("id, name").in("id", customIds);
      for (const s of (ss ?? []) as Array<{ id: string; name: string }>) names[s.id] = s.name;
    }

    const items: ExtraServiceItem[] = rows
      .map((r): ExtraServiceItem => {
        const p = propById.get(r.propertyId);
        const o = p?.owner_contact_id ? ownerById.get(p.owner_contact_id) : undefined;
        return {
          id: r.id,
          date: localDateOf(r.at),
          propertyId: r.propertyId,
          propertyName: p?.name ?? "Imóvel",
          ownerName: o?.name || null,
          ownerPhone: o?.phone ?? null,
          ownerPhoneCountry: o?.country ?? null,
          situation: r.situation,
          situationName: names[r.situation] ?? "Outro",
          title: r.title,
          priceCents: r.cents,
          concludedAt: r.at,
          doneByName: r.providerId ? (provName.get(r.providerId) ?? null) : null,
          logId: r.logId,
          reservationId: r.reservationId,
        };
      })
      .sort((a, b) => (b.concludedAt ?? "").localeCompare(a.concludedAt ?? ""));
    return { items, names };
  });

// ----- Novo serviço (trilha completa do "+", 23/10/2026) -----

const CreateServiceInput = z.object({
  ownerId: z.string().uuid().nullable().optional(),
  /** Chave do sistema (maintenance, damage, other) ou uuid de situação própria. */
  situation: z.string().min(1).max(64),
  propertyId: z.string().uuid(),
  reservationId: z.string().uuid().nullable().optional(),
  providerId: z.string().uuid(),
  date: IsoDay,
  cents: z.number().int().min(0).max(100_000_00),
  /** Título curto (mesmo limite do registro: 50). Obrigatório. */
  title: z.string().trim().min(1, "Escreva um título para o serviço.").max(50),
  description: z.string().trim().max(4000).nullable().optional(),
  /** ID gerado no aparelho: o registro (texto + mídias) nasce com ele e as mídias se juntam depois. */
  groupId: z.string().uuid().optional(),
});

/**
 * Cria um SERVIÇO já realizado (Manutenção, Danos, Outro ou situação criada
 * pelo usuário): imóvel ou reserva → prestador → data → valor. Mora em `tasks`
 * como pendência concluída, que é exatamente o que a aba Serviços lê para
 * "Serviços Extras" (cartões, gráficos, Eficiência e Top 5): situação =
 * `situation`, quem resolveu = prestador, dia = `completed_at`, custo =
 * `amount_spent_cents`.
 *
 * Trava de permissão: a mesma do dinheiro de limpeza (dono da conta ou quem
 * recebeu "Aprovar limpeza completa") — quem faz o serviço não cria a própria
 * cobrança. Quem não tem a permissão continua com o registro simples.
 */
export const createServiceRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CreateServiceInput.parse(i))
  .handler(async ({ data, context }): Promise<{ id: string; situationName: string }> => {
    const owner = await accountOwner(context, data.ownerId);
    const db = context.supabase as unknown as AnyClient;

    const { userCanApproveCleaning } = await import("@/lib/cleaning-approval.functions");
    if (!(await userCanApproveCleaning(context.userId, owner))) {
      throw new Error("Você não tem permissão para criar serviços com valor.");
    }

    // Situação: do sistema (exceto Limpeza, que tem a trilha própria) ou da conta.
    let situationName: string;
    if (isSystemSituation(data.situation)) {
      if (data.situation === "cleaning") throw new Error("Limpeza usa a trilha “Nova limpeza”.");
      situationName = SYSTEM_SITUATIONS.find((s) => s.key === data.situation)?.name ?? "Outro";
    } else {
      const { data: row } = await db
        .from("service_situations")
        .select("id, name")
        .eq("id", data.situation)
        .eq("account_owner_id", owner)
        .is("deleted_at", null)
        .maybeSingle();
      if (!row) throw new Error("Situação não encontrada.");
      situationName = (row as { name: string }).name;
    }

    const { accessiblePropertyIds } = await import("@/lib/dashboard.functions");
    const propIds = await accessiblePropertyIds(context.supabase as never, data.ownerId ?? null, context.userId);
    if (!propIds.includes(data.propertyId)) throw new Error("Você não tem acesso a este imóvel.");

    const [{ data: prop }, { data: prov }] = await Promise.all([
      db.from("properties").select("owner_id, owner_contact_id").eq("id", data.propertyId).maybeSingle(),
      db.from("service_providers").select("account_owner_id").eq("id", data.providerId).maybeSingle(),
    ]);
    const p = prop as { owner_id: string | null; owner_contact_id: string | null } | null;
    const pv = prov as { account_owner_id: string } | null;
    if (!p?.owner_id || !pv || pv.account_owner_id !== p.owner_id) {
      throw new Error("Este prestador não pertence à conta deste imóvel.");
    }

    if (data.reservationId) {
      const { data: resv } = await db
        .from("property_reservations")
        .select("id, property_id")
        .eq("id", data.reservationId)
        .maybeSingle();
      if (!resv || (resv as { property_id: string }).property_id !== data.propertyId) {
        throw new Error("Esta reserva não é deste imóvel.");
      }
    }

    const category =
      data.situation === "maintenance" ? "maintenance" : data.situation === "damage" ? "inspection" : "other";
    const note = data.description?.trim() || null;
    // Meio-dia de Brasília do dia escolhido: cai no dia certo em qualquer fuso de leitura.
    const completedAt = `${data.date}T15:00:00.000Z`;
    const { data: ins, error } = await db
      .from("tasks")
      .insert({
        account_owner_id: owner,
        property_id: data.propertyId,
        owner_contact_id: null,
        reservation_id: data.reservationId ?? null,
        title: data.title.slice(0, 120),
        description: note,
        category,
        situation: data.situation,
        priority: "medium",
        status: "done",
        completed_at: completedAt,
        amount_spent_cents: data.cents,
        resolved_by_provider_id: data.providerId,
        resolution_note: note,
        show_in_cleaning: false,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error("Não foi possível criar o serviço.");
    const taskId = (ins as { id: string }).id;

    // REGISTRO DO SERVIÇO (título + descrição + mídias): a linha principal do
    // grupo nasce aqui, ligada à pendência concluída; as mídias se juntam a ela
    // depois, pela fila do aparelho (`appendSituationMedia`). Falhar aqui não
    // desfaz o serviço — o dinheiro e o dia já estão gravados.
    let groupId: string | null = null;
    try {
      const rr = await import("@/lib/reservation-records.functions");
      groupId = data.groupId ?? crypto.randomUUID();
      const [fileName, who] = await Promise.all([
        rr.nextRecordNameFor(db as never, data.propertyId),
        rr.resolveAuthorNameFor(db as never, context.userId),
      ]);
      const body = rr.composeRecordBody(data.title, data.description);
      const recCategory =
        data.situation === "maintenance" ? "maintenance" : data.situation === "damage" ? "damage" : "other";
      const { error: recErr } = await db.from("reservation_records").insert({
        id: groupId,
        group_id: groupId,
        property_id: data.propertyId,
        log_id: null,
        reservation_id: data.reservationId ?? null,
        category: recCategory,
        card_mode: null,
        kind: "note",
        body: body ?? "",
        created_by: context.userId,
        created_by_name: who,
        task_id: taskId,
        file_name: fileName,
        situation_id: /^[0-9a-f]{8}-/i.test(data.situation) ? data.situation : null,
      });
      if (recErr) groupId = null;
    } catch {
      groupId = null;
    }
    try {
      await db.from("audit_logs").insert({
        user_id: context.userId,
        action: "service_record_create",
        table_name: "tasks",
        record_id: (ins as { id: string }).id,
        new_data: data,
      });
    } catch {
      /* auditoria nunca derruba a operação */
    }
    return { id: taskId, situationName, groupId };
  });
