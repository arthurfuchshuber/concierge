import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { accessiblePropertyIds } from "@/lib/dashboard.functions";

/**
 * APROVAÇÃO DA LIMPEZA COMPLETA (pedido explícito, 17/09/2026).
 *
 * "sempre que a limpeza selecionar 'completa', essa informação precisa ir
 *  pra aprovação antes de contabilizar no valor do dashboard"
 *
 * Ao concluir uma limpeza como COMPLETA, a linha de saída nasce com
 * `cleaning_approval_status = 'pending'` e fica fora de "Limpezas Realizadas"
 * e "Custo Total Limpeza" (ver `getCleaningStats`). O gestor decide aqui:
 *
 *   Aprovar completa  → 'approved': passa a contar com o valor da completa.
 *   Foi normal        → 'rejected': a linha vira limpeza NORMAL, com o valor
 *                       vigente da normal do imóvel, e o valor pedido fica
 *                       guardado em `cleaning_requested_price_cents`.
 *
 * QUEM APROVA (decisão do cliente): o dono da conta, e quem recebeu o nó
 * `tenant.dashboard.chegadas.aprovar-limpeza` DIRETAMENTE. A herança da aba
 * "Chegadas e saídas" não vale: prestadores costumam ter essa aba inteira
 * liberada para concluir limpezas, e quem faz a limpeza não pode aprovar a
 * própria cobrança.
 *
 * A gravação da decisão usa a chave de serviço, depois de checar a permissão
 * e o acesso ao imóvel com a sessão da pessoa. O gatilho
 * `guard_cleaning_approval` no banco recusa qualquer decisão gravada por
 * outro caminho.
 */

export const APPROVE_CLEANING_PERMISSION = "tenant.dashboard.chegadas.aprovar-limpeza";

async function resolveTenantId(
  supabase: unknown,
  userId: string,
  ownerId: string | null | undefined,
): Promise<string | undefined> {
  if (!ownerId) return undefined;
  const { resolveAuthorizedAccountOwnerId } = await import("@/lib/account-scope.server");
  return resolveAuthorizedAccountOwnerId(supabase as never, userId, ownerId);
}

/** Dono da conta, ou nó concedido diretamente. Nunca por herança. */
export async function userCanApproveCleaning(userId: string, tenantId?: string): Promise<boolean> {
  try {
    const { can } = await import("@/lib/permissions/permission.guard.server");
    const decision = await can(userId, APPROVE_CLEANING_PERMISSION, {
      required: "WRITE",
      ...(tenantId ? { tenantId } : {}),
    });
    return decision.allowed && (decision.source === "owner" || decision.source === "assignment");
  } catch (err) {
    console.error("[cleaning-approval] falha ao checar permissão:", err);
    return false;
  }
}

export type CleaningApprovalItem = {
  id: string;
  propertyId: string;
  propertyName: string;
  ownerName: string | null;
  concludedAt: string | null;
  doneByName: string | null;
  priceCents: number | null;
  normalPriceCents: number | null;
};

const ListInput = z.object({
  ownerId: z.string().uuid().nullable().optional(),
  // Mesmo recorte de Proprietário/Cidade dos cards da aba Limpeza.
  propertyIds: z.array(z.string().uuid()).optional(),
});

export const listCleaningApprovals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ListInput.parse(i ?? {}))
  .handler(async ({ data, context }) => {
    const tenantId = await resolveTenantId(context.supabase, context.userId, data.ownerId);
    const canApprove = await userCanApproveCleaning(context.userId, tenantId);

    let propIds = await accessiblePropertyIds(
      context.supabase as never,
      data.ownerId ?? null,
      context.userId,
    );
    if (data.propertyIds && data.propertyIds.length > 0) {
      const allowed = new Set(data.propertyIds);
      propIds = propIds.filter((id) => allowed.has(id));
    }
    if (propIds.length === 0) return { canApprove, items: [] as CleaningApprovalItem[] };

    const { data: rows, error } = await context.supabase
      .from("guest_arrival_status")
      .select("id, property_id, concluded_at, cleaning_price_cents, cleaning_done_by")
      .in("property_id", propIds)
      .eq("kind", "checkout")
      .eq("cleaning_approval_status", "pending")
      .not("concluded_at", "is", null)
      .order("concluded_at", { ascending: true })
      .limit(200);
    if (error) throw new Error(error.message);

    type Row = {
      id: string;
      property_id: string;
      concluded_at: string | null;
      cleaning_price_cents: number | null;
      cleaning_done_by: string | null;
    };
    const list = (rows ?? []) as Row[];
    if (list.length === 0) return { canApprove, items: [] as CleaningApprovalItem[] };

    const propertyIdsInList = Array.from(new Set(list.map((r) => r.property_id)));
    const { data: props } = await context.supabase
      .from("properties")
      .select("id, name, cleaning_price_normal_cents, owner_contact_id")
      .in("id", propertyIdsInList);
    const propArr = (props ?? []) as Array<{
      id: string;
      name: string | null;
      cleaning_price_normal_cents: number | null;
      owner_contact_id: string | null;
    }>;
    const propById = new Map(propArr.map((p) => [p.id, p]));

    // Regra da casa: todo nome de imóvel vem com o proprietário embaixo.
    const ownerIds = Array.from(
      new Set(propArr.map((p) => p.owner_contact_id).filter((v): v is string => !!v)),
    );
    const ownerNameById = new Map<string, string>();
    if (ownerIds.length > 0) {
      const { data: owners } = await context.supabase
        .from("property_owners")
        .select("id, name, trade_name")
        .in("id", ownerIds);
      for (const o of (owners ?? []) as Array<{
        id: string;
        name: string | null;
        trade_name: string | null;
      }>) {
        const label = (o.trade_name || o.name || "").trim();
        if (label) ownerNameById.set(o.id, label);
      }
    }

    // Quem concluiu: o nome do cadastro de prestador vinculado ao login (mesma
    // regra do aviso "Finalizado por" em ops-push.server.ts).
    const doneByIds = Array.from(
      new Set(list.map((r) => r.cleaning_done_by).filter((v): v is string => !!v)),
    );
    const nameByUser = new Map<string, string>();
    if (doneByIds.length > 0) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: providers } = await supabaseAdmin
        .from("service_providers")
        .select("member_user_id, name, trade_name")
        .in("member_user_id", doneByIds);
      for (const p of (providers ?? []) as Array<{
        member_user_id: string | null;
        name: string | null;
        trade_name: string | null;
      }>) {
        const label = (p.trade_name || p.name || "").trim();
        if (p.member_user_id && label) nameByUser.set(p.member_user_id, label);
      }
    }

    const items: CleaningApprovalItem[] = list.map((r) => {
      const p = propById.get(r.property_id);
      return {
        id: r.id,
        propertyId: r.property_id,
        propertyName: p?.name ?? "Imóvel",
        ownerName: p?.owner_contact_id ? (ownerNameById.get(p.owner_contact_id) ?? null) : null,
        concludedAt: r.concluded_at,
        doneByName: r.cleaning_done_by ? (nameByUser.get(r.cleaning_done_by) ?? null) : null,
        priceCents: r.cleaning_price_cents,
        normalPriceCents: p?.cleaning_price_normal_cents ?? null,
      };
    });
    return { canApprove, items };
  });

const DecideInput = z.object({
  id: z.string().uuid(),
  decision: z.enum(["approve", "normal"]),
  ownerId: z.string().uuid().nullable().optional(),
});

/**
 * Checagens comuns à decisão e ao desfazer — em PARALELO (pedido explícito,
 * 17/09/2026: "as respostas de QUALQUER ação precisam ser INSTANTÂNEAS").
 * Antes eram três idas ao banco em fila.
 */
async function loadDecisionRow(
  context: { supabase: SupabaseClient<Database>; userId: string },
  id: string,
  ownerId: string | null | undefined,
) {
  const supabase = context.supabase;
  const tenantId = await resolveTenantId(context.supabase, context.userId, ownerId);
  const [canApprove, rowRes, visible] = await Promise.all([
    userCanApproveCleaning(context.userId, tenantId),
    // Lida com a sessão da pessoa: a política da tabela já recorta os imóveis
    // que ela enxerga. Depois, o mesmo recorte de residências do dashboard.
    supabase
      .from("guest_arrival_status")
      .select(
        "id, property_id, cleaning_type, cleaning_price_cents, cleaning_approval_status, cleaning_requested_price_cents",
      )
      .eq("id", id)
      .eq("kind", "checkout")
      .maybeSingle(),
    accessiblePropertyIds(context.supabase as never, ownerId ?? null, context.userId),
  ]);
  if (!canApprove) throw new Error("Você não tem permissão para aprovar limpezas completas.");
  if (rowRes.error) throw new Error(rowRes.error.message);
  const r = rowRes.data as {
    id: string;
    property_id: string;
    cleaning_type: string | null;
    cleaning_price_cents: number | null;
    cleaning_approval_status: string | null;
    cleaning_requested_price_cents: number | null;
  } | null;
  if (!r || !visible.includes(r.property_id)) throw new Error("Limpeza não encontrada.");
  return r;
}

export const decideCleaningApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => DecideInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const r = await loadDecisionRow(context, data.id, data.ownerId);
    if (r.cleaning_approval_status !== "pending" || r.cleaning_type !== "completa") {
      throw new Error("Esta limpeza já foi decidida.");
    }
    const nowIso = new Date().toISOString();

    if (data.decision === "approve") {
      const { error: upErr } = await supabaseAdmin
        .from("guest_arrival_status")
        .update({
          cleaning_approval_status: "approved",
          cleaning_approval_by: context.userId,
          cleaning_approval_at: nowIso,
        })
        .eq("id", r.id)
        .eq("cleaning_approval_status", "pending");
      if (upErr) throw new Error(upErr.message);
      return { ok: true, status: "approved" as const };
    }

    const { data: prop } = await supabaseAdmin
      .from("properties")
      .select("cleaning_price_normal_cents")
      .eq("id", r.property_id)
      .maybeSingle();
    const { error: upErr } = await supabaseAdmin
      .from("guest_arrival_status")
      .update({
        cleaning_type: "normal",
        cleaning_price_cents:
          (prop as { cleaning_price_normal_cents: number | null } | null)
            ?.cleaning_price_normal_cents ?? null,
        cleaning_requested_price_cents: r.cleaning_price_cents,
        cleaning_approval_status: "rejected",
        cleaning_approval_by: context.userId,
        cleaning_approval_at: nowIso,
      })
      .eq("id", r.id)
      .eq("cleaning_approval_status", "pending");
    if (upErr) throw new Error(upErr.message);
    return { ok: true, status: "rejected" as const };
  });

/**
 * DESFAZER a decisão (botão "Desfazer", 5s — pedido explícito, 17/09/2026).
 * Devolve a limpeza para "aguardando aprovação" exatamente como estava:
 * se tinha virado normal, volta a ser completa com o valor pedido.
 */
const UndoInput = z.object({
  id: z.string().uuid(),
  ownerId: z.string().uuid().nullable().optional(),
});

export const undoCleaningDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UndoInput.parse(i))
  .handler(async ({ data, context }) => {
    const r = await loadDecisionRow(context, data.id, data.ownerId);
    if (r.cleaning_approval_status === "pending") return { ok: true };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch =
      r.cleaning_approval_status === "rejected"
        ? {
            cleaning_type: "completa",
            cleaning_price_cents: r.cleaning_requested_price_cents ?? r.cleaning_price_cents,
            cleaning_requested_price_cents: null,
            cleaning_approval_status: "pending",
            cleaning_approval_by: null,
            cleaning_approval_at: null,
          }
        : {
            cleaning_approval_status: "pending",
            cleaning_approval_by: null,
            cleaning_approval_at: null,
          };
    const { error } = await supabaseAdmin
      .from("guest_arrival_status")
      .update(patch)
      .eq("id", r.id)
      .in("cleaning_approval_status", ["approved", "rejected"]);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
