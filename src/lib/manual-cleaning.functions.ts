import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * LIMPEZA CRIADA MANUALMENTE (mockup "Nova limpeza em perguntas · v2.1",
 * aprovado 02/10/2026 — "implementar a possibilidade de 'criar limpeza'
 * manualmente, direcionando para um determinado prestador com preços manuais
 * e vinculando a um imóvel ou a uma reserva").
 *
 * COMO É GUARDADA: uma linha em `guest_arrival_status` com `kind = 'checkout'`
 * e `manual = true`, sem `log_id` nem `reservation_id`. Mora na MESMA tabela
 * das limpezas da esteira de propósito: tudo que soma limpeza (totais, ranking
 * e gráficos da aba Limpeza, aprovação da completa) lê essa tabela por imóvel,
 * então a manual entra nesses números sem nenhuma conta paralela. Decisão do
 * cliente: "entra direto em Fila de Limpeza e segue o mesmo caminho das outras
 * (finalizar, aprovação da completa, totais e ranking)".
 *
 * POR QUE A RESERVA VINCULADA FICA EM `manual_reservation_id` (e não em
 * `reservation_id`): a esteira identifica a limpeza DA SAÍDA de uma reserva
 * por `reservation_id` — existe um índice único (reserva, kind) e dezenas de
 * consultas contam com "uma linha por reserva". Uma limpeza extra na mesma
 * reserva (ex.: no meio da estadia) precisa conviver com a da saída, então ela
 * só APONTA para a reserva; nunca ocupa o lugar dela.
 *
 * REGRAS (respostas do cliente, 02/10/2026):
 *  · Já nasce liberada: `status = 'done'`, que é o que a esteira chama de
 *    "Fila de Limpeza". Só aparece no quadro a partir do dia marcado
 *    (`manual_date`) — "pode agendar para outro dia, que seja para o futuro
 *    somente... aparece na fila só naquele dia". Hoje vale; passado não.
 *  · Reserva que já tem a limpeza da saída: quem está criando é avisado e
 *    decide — "substitui, cancela a criação, ou soma as duas". O servidor
 *    devolve `conflict` e não grava nada até vir a escolha.
 *  · Tipo e valor são definidos na criação, então "Finalizar Limpeza" não
 *    pergunta o tipo de novo. Completa entra pendente de aprovação, igual às
 *    outras.
 *
 * QUEM PODE CRIAR — ATENÇÃO: o cliente respondeu "só quem já pode ajustar
 * valores". Hoje "Ajustar valor desta limpeza" não tem permissão própria: vale
 * para qualquer pessoa com acesso ao imóvel, inclusive o prestador. Liberar a
 * criação para esse mesmo grupo deixaria quem faz a limpeza criar a própria
 * cobrança com o valor que quiser. Por isso a trava usada é a que já existe
 * para dinheiro de limpeza: dono da conta, ou quem recebeu DIRETAMENTE o nó
 * "Aprovar limpeza completa" (`userCanApproveCleaning`). Fica registrado como
 * decisão a confirmar com o cliente.
 */

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** "Hoje" em São Paulo (UTC-3, sem horário de verão desde 2019). */
function todaySP(): string {
  return new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
}

type Sb = {
  from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

async function canCreate(sb: Sb, userId: string, ownerId: string | null | undefined) {
  const { resolveAuthorizedAccountOwnerId } = await import("@/lib/account-scope.server");
  const tenantId = await resolveAuthorizedAccountOwnerId(sb as never, userId, ownerId ?? null);
  const { userCanApproveCleaning } = await import("@/lib/cleaning-approval.functions");
  return { tenantId, allowed: await userCanApproveCleaning(userId, tenantId) };
}

/**
 * Só o "pode criar?" — leve, para decidir se o botão "+" aparece ao lado de
 * Filtros. As listas do quadrante só são buscadas quando ele abre.
 */
export const getManualCleaningAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ ownerId: z.string().uuid().nullable().optional() }).parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { allowed } = await canCreate(
      context.supabase as unknown as Sb,
      context.userId,
      data.ownerId,
    );
    return { canCreate: allowed };
  });

export type ManualCleaningProperty = {
  id: string;
  name: string;
  ownerName: string | null;
  normalCents: number | null;
  fullCents: number | null;
  defaultProviderId: string | null;
};
export type ManualCleaningProvider = { id: string; name: string };
export type ManualCleaningReservation = {
  id: string;
  propertyId: string;
  /** Hóspede (do formulário) ou código da reserva. */
  label: string;
  checkin: string;
  checkout: string | null;
};

/**
 * Tudo que o quadrante precisa para abrir: se a pessoa pode criar, os imóveis
 * que ela enxerga (com o preço de cada tipo e o prestador padrão), os
 * prestadores da conta e as reservas em curso/próximas.
 */
export const getManualCleaningOptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ ownerId: z.string().uuid().nullable().optional() }).parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase as unknown as Sb;
    const empty = {
      canCreate: false,
      properties: [] as ManualCleaningProperty[],
      providers: [] as ManualCleaningProvider[],
      reservations: [] as ManualCleaningReservation[],
    };
    const { tenantId, allowed } = await canCreate(sb, context.userId, data.ownerId);
    if (!allowed) return empty;

    const { accessiblePropertyIds } = await import("@/lib/dashboard.functions");
    const propIds = await accessiblePropertyIds(sb as never, data.ownerId ?? null, context.userId);
    if (propIds.length === 0) return { ...empty, canCreate: true };

    const from = new Date(Date.now() - 3 * 3600_000 - 7 * 86400_000).toISOString().slice(0, 10);
    const to = new Date(Date.now() - 3 * 3600_000 + 90 * 86400_000).toISOString().slice(0, 10);
    const [{ data: props }, { data: provs }, { data: links }, { data: res }] = await Promise.all([
      sb
        .from("properties")
        .select(
          "id, name, owner_contact_id, cleaning_price_normal_cents, cleaning_price_full_cents",
        )
        .in("id", propIds)
        .order("name"),
      sb
        .from("service_providers")
        .select("id, name, trade_name, status")
        .eq("account_owner_id", tenantId)
        .order("name"),
      sb.from("property_providers").select("property_id, provider_id").in("property_id", propIds),
      // Em curso, recém-encerradas (7 dias) e as próximas (90 dias).
      sb
        .from("property_reservations")
        .select("id, property_id, checkin_date, checkout_date, guest_hint, status, raw_summary")
        .in("property_id", propIds)
        .gte("checkout_date", from)
        .lte("checkin_date", to)
        .order("checkin_date", { ascending: true })
        .limit(400),
    ]);

    type PropRow = {
      id: string;
      name: string | null;
      owner_contact_id: string | null;
      cleaning_price_normal_cents: number | null;
      cleaning_price_full_cents: number | null;
    };
    const propRows = (props ?? []) as PropRow[];
    const ownerIds = Array.from(
      new Set(propRows.map((p) => p.owner_contact_id).filter((v): v is string => !!v)),
    );
    const ownerName = new Map<string, string>();
    if (ownerIds.length > 0) {
      const { data: owners } = await sb
        .from("property_owners")
        .select("id, name, trade_name")
        .in("id", ownerIds);
      for (const o of (owners ?? []) as Array<{
        id: string;
        name: string | null;
        trade_name: string | null;
      }>) {
        const label = (o.trade_name || o.name || "").trim();
        if (label) ownerName.set(o.id, label);
      }
    }

    const providers: ManualCleaningProvider[] = (
      (provs ?? []) as Array<{
        id: string;
        name: string | null;
        trade_name: string | null;
        status: string | null;
      }>
    )
      .filter((p) => !/^cancel/i.test(p.status ?? ""))
      .map((p) => ({ id: p.id, name: (p.trade_name || p.name || "Prestador").trim() }));
    const validProv = new Set(providers.map((p) => p.id));
    const defaults = new Map<string, string>();
    for (const l of (links ?? []) as Array<{ property_id: string; provider_id: string }>) {
      if (!defaults.has(l.property_id) && validProv.has(l.provider_id))
        defaults.set(l.property_id, l.provider_id);
    }

    type ResRow = {
      id: string;
      property_id: string;
      checkin_date: string;
      checkout_date: string | null;
      guest_hint: string | null;
      status: string | null;
      raw_summary: string | null;
    };
    // Mesmo critério de "reserva de verdade" da esteira: cancelada e bloqueio
    // de calendário não são estadia.
    const resRows = ((res ?? []) as ResRow[]).filter((r) => {
      const st = (r.status ?? "").toLowerCase();
      const sum = (r.raw_summary ?? "").toLowerCase();
      if (st.includes("cancel") || st.includes("block")) return false;
      return !(
        sum.includes("not available") ||
        sum.includes("unavailable") ||
        sum.includes("bloqueado")
      );
    });
    // Nome do hóspede: vem do formulário do guia, casado pelo imóvel + data de
    // entrada. Sem formulário, fica o código da reserva.
    const guestByStay = new Map<string, string>();
    if (resRows.length > 0) {
      const { data: logs } = await sb
        .from("guide_access_logs")
        .select("property_id, checkin_date, guest_name")
        .in("property_id", propIds)
        .gte("checkin_date", from)
        .lte("checkin_date", to)
        .limit(2000);
      for (const l of (logs ?? []) as Array<{
        property_id: string;
        checkin_date: string;
        guest_name: string | null;
      }>) {
        const n = (l.guest_name ?? "").trim();
        if (!n || n.toLowerCase() === "hóspede pendente") continue;
        const k = `${l.property_id}|${l.checkin_date}`;
        if (!guestByStay.has(k)) guestByStay.set(k, n);
      }
    }

    return {
      canCreate: true,
      properties: propRows.map((p) => ({
        id: p.id,
        name: (p.name ?? "Imóvel").trim(),
        ownerName: p.owner_contact_id ? (ownerName.get(p.owner_contact_id) ?? null) : null,
        normalCents: p.cleaning_price_normal_cents,
        fullCents: p.cleaning_price_full_cents,
        defaultProviderId: defaults.get(p.id) ?? null,
      })),
      providers,
      reservations: resRows.map((r) => ({
        id: r.id,
        propertyId: r.property_id,
        label: guestByStay.get(`${r.property_id}|${r.checkin_date}`) ?? (r.guest_hint ?? "").trim(),
        checkin: r.checkin_date,
        checkout: r.checkout_date,
      })),
    };
  });

/** O que já existe para a reserva escolhida — é o que o aviso mostra. */
export type ManualCleaningConflict = {
  statusId: string;
  providerName: string | null;
  cleaningType: "normal" | "completa" | null;
  priceCents: number | null;
  /** Já finalizada: substituir troca o valor registrado. */
  concluded: boolean;
};

const CreateInput = z.object({
  ownerId: z.string().uuid().nullable().optional(),
  propertyId: z.string().uuid(),
  reservationId: z.string().uuid().nullable().optional(),
  providerId: z.string().uuid(),
  date: DateStr,
  cleaningType: z.enum(["normal", "completa"]),
  cents: z.number().int().min(0).max(100_000_00),
  /**
   * `ask` (padrão): se a reserva já tem limpeza, não grava e devolve o aviso.
   * `add`: soma (cria a extra). `replace`: troca prestador e valor da que existe.
   */
  onConflict: z.enum(["ask", "add", "replace"]).default("ask"),
});

export const createManualCleaning = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CreateInput.parse(i))
  .handler(
    async ({
      data,
      context,
    }): Promise<
      | { ok: true; mode: "created" | "replaced"; scheduledFor: string; notified: boolean }
      | { ok: false; conflict: ManualCleaningConflict }
    > => {
      const sb = context.supabase as unknown as Sb;
      const { allowed } = await canCreate(sb, context.userId, data.ownerId);
      if (!allowed) throw new Error("Você não tem permissão para criar limpezas.");

      const today = todaySP();
      if (data.date < today) throw new Error("Escolha hoje ou uma data futura.");

      const { accessiblePropertyIds } = await import("@/lib/dashboard.functions");
      const propIds = await accessiblePropertyIds(
        sb as never,
        data.ownerId ?? null,
        context.userId,
      );
      if (!propIds.includes(data.propertyId)) throw new Error("Você não tem acesso a este imóvel.");

      const [{ data: prop }, { data: prov }] = await Promise.all([
        sb
          .from("properties")
          .select("owner_id, cleaning_price_normal_cents, cleaning_price_full_cents")
          .eq("id", data.propertyId)
          .maybeSingle(),
        sb
          .from("service_providers")
          .select("account_owner_id, name, trade_name")
          .eq("id", data.providerId)
          .maybeSingle(),
      ]);
      // Prestador precisa ser da MESMA conta do imóvel — nunca cruza contas
      // (mesma trava de `setCleaningAssignment`).
      if (!prop?.owner_id || !prov || prov.account_owner_id !== prop.owner_id) {
        throw new Error("Este prestador não pertence à conta deste imóvel.");
      }
      const standardCents: number | null =
        data.cleaningType === "completa"
          ? (prop.cleaning_price_full_cents ?? null)
          : (prop.cleaning_price_normal_cents ?? null);
      const nowIso = new Date().toISOString();
      // Só marca como "valor ajustado" quando difere do preço cadastrado.
      const adjusted = data.cents !== standardCents;
      const overrideMeta = adjusted
        ? {
            cleaning_price_override_by: context.userId,
            cleaning_price_override_at: nowIso,
            cleaning_price_override_reason: "Valor definido na criação manual",
          }
        : {};

      if (data.reservationId) {
        const { data: resv } = await sb
          .from("property_reservations")
          .select("id, property_id")
          .eq("id", data.reservationId)
          .maybeSingle();
        if (!resv || resv.property_id !== data.propertyId) {
          throw new Error("Esta reserva não é deste imóvel.");
        }
        const existing = await findReservationCleaning(sb, data.reservationId, data.propertyId);
        if (existing && data.onConflict === "ask") return { ok: false, conflict: existing.view };
        if (existing && data.onConflict === "replace") {
          const r = existing.row;
          const patch = r.cleaning_type
            ? {
                assigned_provider_id: data.providerId,
                cleaning_price_original_cents:
                  r.cleaning_price_original_cents ?? r.cleaning_price_cents,
                cleaning_price_cents: data.cents,
                cleaning_price_override_cents: data.cents,
                cleaning_price_override_by: context.userId,
                cleaning_price_override_at: nowIso,
                cleaning_price_override_reason: "Substituída por limpeza criada manualmente",
              }
            : {
                assigned_provider_id: data.providerId,
                cleaning_price_override_cents: data.cents,
                cleaning_price_override_by: context.userId,
                cleaning_price_override_at: nowIso,
                cleaning_price_override_reason: "Substituída por limpeza criada manualmente",
                // Tipo combinado na criação: é o que "Finalizar Limpeza" usa
                // nas manuais; na limpeza da saída o tipo continua sendo
                // perguntado na hora de finalizar, como sempre.
                manual_cleaning_type: data.cleaningType,
              };
          const { error } = await sb.from("guest_arrival_status").update(patch).eq("id", r.id);
          if (error) throw new Error("Você não tem permissão para alterar esta limpeza.");
          await audit(sb, context.userId, "manual_cleaning_replace", r.id, data);
          const notified = await pushToProvider(
            data.propertyId,
            data.providerId,
            r.id,
            today,
            today,
          );
          return { ok: true, mode: "replaced", scheduledFor: data.date, notified };
        }
      }

      const { data: created, error } = await sb
        .from("guest_arrival_status")
        .insert({
          property_id: data.propertyId,
          kind: "checkout",
          status: "done",
          done_at: nowIso,
          manual: true,
          manual_date: data.date,
          manual_cleaning_type: data.cleaningType,
          manual_reservation_id: data.reservationId ?? null,
          manual_created_by: context.userId,
          assigned_provider_id: data.providerId,
          cleaning_price_override_cents: data.cents,
          ...overrideMeta,
        })
        .select("id")
        .maybeSingle();
      if (error) throw new Error("Não foi possível criar a limpeza.");
      await audit(sb, context.userId, "manual_cleaning_create", created?.id ?? null, data);
      const notified = await pushToProvider(
        data.propertyId,
        data.providerId,
        created?.id ?? `${data.propertyId}:${nowIso}`,
        data.date,
        today,
      );
      return { ok: true, mode: "created", scheduledFor: data.date, notified };
    },
  );

/**
 * Aviso por push ao prestador escolhido (02/10/2026: "tem que ir para os
 * envolvidos"). Nunca derruba a criação: falhou, a limpeza já está gravada.
 * Devolve se alguém foi de fato avisado — a tela conta para quem criou.
 */
async function pushToProvider(
  propertyId: string,
  providerId: string,
  refKey: string,
  date: string,
  today: string,
): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { notifyManualCleaningAssigned } = await import("@/lib/ops-push.server");
    const r = await notifyManualCleaningAssigned(supabaseAdmin as never, {
      propertyId,
      providerId,
      refKey,
      date,
      today,
    });
    return (r?.sent ?? 0) > 0;
  } catch (err) {
    console.error("[manual-cleaning] falha ao enviar push ao prestador:", err);
    return false;
  }
}

async function audit(sb: Sb, userId: string, action: string, recordId: string | null, d: unknown) {
  try {
    await sb.from("audit_logs").insert({
      user_id: userId,
      action,
      table_name: "guest_arrival_status",
      record_id: recordId,
      new_data: d,
    });
  } catch {
    /* auditoria nunca derruba a operação */
  }
}

type ExistingRow = {
  id: string;
  status: string;
  cleaning_type: string | null;
  cleaning_price_cents: number | null;
  cleaning_price_override_cents: number | null;
  cleaning_price_original_cents: number | null;
  assigned_provider_id: string | null;
  manual: boolean | null;
  manual_cleaning_type: string | null;
  concluded_at: string | null;
};

/**
 * "A reserva já tem limpeza?" — sim quando a limpeza da saída já está na fila,
 * já foi finalizada, ou já foi direcionada/teve o valor ajustado; ou quando já
 * existe uma limpeza manual em aberto apontando para a mesma reserva. Uma
 * reserva futura em que ninguém mexeu ainda não conta: aí a manual é só mais
 * uma, e a da saída nasce normalmente no dia do check-out.
 */
async function findReservationCleaning(sb: Sb, reservationId: string, propertyId: string) {
  const cols =
    "id, status, cleaning_type, cleaning_price_cents, cleaning_price_override_cents, cleaning_price_original_cents, assigned_provider_id, manual, manual_cleaning_type, concluded_at";
  const [{ data: own }, { data: extras }] = await Promise.all([
    sb
      .from("guest_arrival_status")
      .select(cols)
      .eq("reservation_id", reservationId)
      .eq("kind", "checkout")
      .limit(1),
    sb
      .from("guest_arrival_status")
      .select(cols)
      .eq("manual_reservation_id", reservationId)
      .eq("manual", true)
      .is("concluded_at", null)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);
  const ownRow = (own?.[0] ?? null) as ExistingRow | null;
  const skipped = !!ownRow && !!ownRow.concluded_at && !ownRow.cleaning_type;
  const ownCounts =
    !!ownRow &&
    !skipped &&
    (ownRow.status === "done" ||
      !!ownRow.cleaning_type ||
      !!ownRow.assigned_provider_id ||
      ownRow.cleaning_price_override_cents != null);
  const row = ownCounts ? ownRow : ((extras?.[0] ?? null) as ExistingRow | null);
  if (!row) return null;

  const [{ data: prop }, { data: link }] = await Promise.all([
    sb
      .from("properties")
      .select("cleaning_price_normal_cents, cleaning_price_full_cents")
      .eq("id", propertyId)
      .maybeSingle(),
    sb.from("property_providers").select("provider_id").eq("property_id", propertyId).limit(1),
  ]);
  const providerId: string | null = row.assigned_provider_id ?? link?.[0]?.provider_id ?? null;
  let providerName: string | null = null;
  if (providerId) {
    const { data: p } = await sb
      .from("service_providers")
      .select("name, trade_name")
      .eq("id", providerId)
      .maybeSingle();
    providerName = ((p?.trade_name || p?.name || "") as string).trim() || null;
  }
  const type = (row.cleaning_type ?? row.manual_cleaning_type ?? null) as
    "normal" | "completa" | null;
  const standard =
    type === "completa"
      ? (prop?.cleaning_price_full_cents ?? null)
      : (prop?.cleaning_price_normal_cents ?? null);
  const view: ManualCleaningConflict = {
    statusId: row.id,
    providerName,
    cleaningType: type,
    priceCents: row.cleaning_type
      ? row.cleaning_price_cents
      : (row.cleaning_price_override_cents ?? standard),
    concluded: !!row.cleaning_type,
  };
  return { row, view };
}

/* ------------------------------------------------------------------------ */
/* Finalizar / cancelar / desfazer uma limpeza manual                        */
/* ------------------------------------------------------------------------ */

async function loadManual(sb: Sb, id: string) {
  const { data } = await sb
    .from("guest_arrival_status")
    .select(
      "id, property_id, manual, manual_cleaning_type, cleaning_price_override_cents, concluded_at",
    )
    .eq("id", id)
    .maybeSingle();
  const row = data as {
    id: string;
    property_id: string;
    manual: boolean | null;
    manual_cleaning_type: string | null;
    cleaning_price_override_cents: number | null;
    concluded_at: string | null;
  } | null;
  if (!row || !row.manual) throw new Error("Limpeza não encontrada.");
  return row;
}

/**
 * "Finalizar Limpeza" de uma manual. Mesmo retrato que a esteira grava no
 * avanço "cleaning" (`runAdvanceArrival`): tipo, valor, quem concluiu e a
 * completa pendente de aprovação. `skip` é o "Limpeza não será realizada":
 * encerra sem tipo nem valor, e por isso fica fora de todos os totais.
 * Gravado com a sessão da pessoa — a RLS da tabela é a mesma que deixa
 * avançar qualquer card da esteira, então o prestador finaliza a dele.
 */
export const concludeManualCleaning = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ statusId: z.string().uuid(), skip: z.boolean().optional() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase as unknown as Sb;
    const row = await loadManual(sb, data.statusId);
    if (row.concluded_at) return { ok: true };
    const nowIso = new Date().toISOString();
    if (data.skip) {
      const { error } = await sb
        .from("guest_arrival_status")
        .update({ concluded_at: nowIso, cleaning_type: null, cleaning_price_cents: null })
        .eq("id", row.id);
      if (error) throw new Error("Você não tem permissão para alterar esta limpeza.");
      return { ok: true };
    }
    const type = row.manual_cleaning_type === "completa" ? "completa" : "normal";
    const { data: prop } = await sb
      .from("properties")
      .select("cleaning_price_normal_cents, cleaning_price_full_cents")
      .eq("id", row.property_id)
      .maybeSingle();
    const standard: number | null =
      type === "completa"
        ? (prop?.cleaning_price_full_cents ?? null)
        : (prop?.cleaning_price_normal_cents ?? null);
    const price = row.cleaning_price_override_cents ?? standard;
    const { error } = await sb
      .from("guest_arrival_status")
      .update({
        concluded_at: nowIso,
        cleaning_type: type,
        cleaning_price_cents: price,
        ...(row.cleaning_price_override_cents != null && price !== standard
          ? { cleaning_price_original_cents: standard }
          : {}),
        cleaning_approval_status: type === "completa" ? "pending" : null,
        cleaning_done_by: context.userId,
      })
      .eq("id", row.id);
    if (error) throw new Error("Você não tem permissão para finalizar esta limpeza.");
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { notifyCleaningDone } = await import("@/lib/ops-push.server");
      // Só o aviso de "limpeza concluída". O aviso ao hóspede de "check-in
      // liberado" NÃO sai daqui: uma limpeza avulsa não diz nada sobre a
      // estadia de ninguém.
      await notifyCleaningDone(supabaseAdmin as never, {
        propertyId: row.property_id,
        refKey: row.id,
        byUserId: context.userId,
      });
    } catch (err) {
      console.error("[manual-cleaning] falha ao enviar push de limpeza:", err);
    }
    return { ok: true };
  });

/** "Desfazer" de uma finalização/cancelamento: a limpeza volta para a fila. */
export const reopenManualCleaning = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ statusId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as unknown as Sb;
    const row = await loadManual(sb, data.statusId);
    const { error } = await sb
      .from("guest_arrival_status")
      .update({
        concluded_at: null,
        cleaning_type: null,
        cleaning_price_cents: null,
        cleaning_price_original_cents: null,
        cleaning_approval_status: null,
        cleaning_done_by: null,
      })
      .eq("id", row.id);
    if (error) throw new Error("Você não tem permissão para alterar esta limpeza.");
    return { ok: true };
  });
