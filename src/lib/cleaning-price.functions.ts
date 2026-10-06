import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * AJUSTE DO VALOR DE UMA LIMPEZA (pedido explícito, 29/09/2026).
 *
 * Vale só para aquela limpeza (linha de saída em `guest_arrival_status`),
 * nunca altera o preço cadastrado do imóvel.
 *  - Antes da conclusão: guarda em `cleaning_price_override_cents`; o avanço
 *    "cleaning" usa esse valor no snapshot.
 *  - Depois da conclusão: troca `cleaning_price_cents` direto (todos os totais
 *    já leem essa coluna) e guarda o valor anterior em
 *    `cleaning_price_original_cents`.
 * Gravado com a sessão da pessoa: a RLS da tabela é a mesma que permite
 * avançar o card na esteira.
 */

const Key = z
  .object({
    logId: z.string().uuid().nullable().optional(),
    reservationId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => !!v.logId || !!v.reservationId, { message: "Informe a reserva." });

async function findCheckoutRow(
  supabase: SupabaseClient<Database>,
  k: { logId?: string | null; reservationId?: string | null; statusId?: string | null },
) {
  const cols =
    "id, cleaning_type, cleaning_price_cents, cleaning_price_override_cents, cleaning_price_original_cents, cleaning_price_override_reason, cleaning_price_override_by, cleaning_price_override_at, concluded_at";
  for (const [col, val] of [
    ["id", k.statusId],
    ["reservation_id", k.reservationId],
    ["log_id", k.logId],
  ] as const) {
    if (!val) continue;
    const { data } = await supabase
      .from("guest_arrival_status")
      .select(cols)
      .eq(col, val)
      .eq("kind", "checkout")
      .limit(1);
    const row = data?.[0] as Record<string, unknown> | undefined;
    if (row) return row as {
      id: string;
      cleaning_type: string | null;
      cleaning_price_cents: number | null;
      cleaning_price_override_cents: number | null;
      cleaning_price_original_cents: number | null;
      cleaning_price_override_reason: string | null;
      cleaning_price_override_by: string | null;
      cleaning_price_override_at: string | null;
      concluded_at: string | null;
    };
  }
  return null;
}

export const getCleaningPriceInfo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Key.parse(i))
  .handler(async ({ data, context }) => {
    const r = await findCheckoutRow(context.supabase, data);
    if (!r) return null;
    const concluded = !!r.cleaning_type;
    let byName: string | null = null;
    if (r.cleaning_price_override_by) {
      const { data: p } = await context.supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", r.cleaning_price_override_by)
        .maybeSingle();
      const pp = p as { full_name?: string | null; email?: string | null } | null;
      byName = pp?.full_name || pp?.email || null;
    }
    return {
      concluded,
      cleaningType: r.cleaning_type,
      currentCents: concluded ? r.cleaning_price_cents : r.cleaning_price_override_cents,
      originalCents: r.cleaning_price_original_cents,
      adjusted: r.cleaning_price_override_at != null,
      reason: r.cleaning_price_override_reason,
      byName,
      at: r.cleaning_price_override_at,
    };
  });

export const setCleaningPriceOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        logId: z.string().uuid().nullable().optional(),
        reservationId: z.string().uuid().nullable().optional(),
        statusId: z.string().uuid().nullable().optional(),
        cents: z.number().int().min(0).max(100_000_00),
        reason: z.string().trim().max(300).nullable().optional(),
      })
      .refine((v) => !!v.logId || !!v.reservationId || !!v.statusId)
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const r = await findCheckoutRow(context.supabase, data);
    if (!r) throw new Error("Esta limpeza ainda não está na fila.");
    // Autorização no servidor: só o dono da conta do imóvel, um membro ativo
    // com permissão "Agir na operação" pode ajustar o valor.
    // Ter acesso ao card (RLS) não basta — prestadores também enxergam a linha.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: st } = await supabaseAdmin
      .from("guest_arrival_status")
      .select("property_id")
      .eq("id", r.id)
      .maybeSingle();
    const propertyId = (st as { property_id?: string | null } | null)?.property_id;
    if (!propertyId) throw new Error("Sem permissão para esta ação.");
    const { data: prop } = await supabaseAdmin
      .from("properties")
      .select("owner_id")
      .eq("id", propertyId)
      .maybeSingle();
    const ownerId = (prop as { owner_id?: string | null } | null)?.owner_id;
    if (!ownerId) throw new Error("Sem permissão para esta ação.");
    const { requireMemberPermission } = await import("./member-permissions.server");
    await requireMemberPermission(context.supabase, context.userId, ownerId, "operation_edit");
    const nowIso = new Date().toISOString();
    const base = {
      cleaning_price_override_reason: data.reason || null,
      cleaning_price_override_by: context.userId,
      cleaning_price_override_at: nowIso,
    };
    const patch = r.cleaning_type
      ? {
          ...base,
          cleaning_price_original_cents: r.cleaning_price_original_cents ?? r.cleaning_price_cents,
          cleaning_price_cents: data.cents,
          cleaning_price_override_cents: data.cents,
        }
      : { ...base, cleaning_price_override_cents: data.cents };
    const { error } = await context.supabase
      .from("guest_arrival_status")
      .update(patch as never)
      .eq("id", r.id);
    if (error) throw new Error("Você não tem permissão para ajustar esta limpeza.");
    try {
      await context.supabase.from("audit_logs").insert({
        user_id: context.userId,
        action: "cleaning_price_override",
        table_name: "guest_arrival_status",
        record_id: r.id,
        old_data: { cents: r.cleaning_type ? r.cleaning_price_cents : r.cleaning_price_override_cents },
        new_data: { cents: data.cents, reason: data.reason ?? null },
      } as never);
    } catch {
      /* auditoria é best-effort */
    }
    return { ok: true };
  });

/**
 * Troca o tipo (normal ↔ completa) de uma limpeza JÁ concluída, direto pela
 * janela. O valor passa a ser o preço cadastrado do imóvel para o novo tipo
 * (quando existir); a troca feita pelo gestor já vale como aprovada.
 */
export const setCleaningType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ statusId: z.string().uuid(), type: z.enum(["normal", "completa"]) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase
      .from("guest_arrival_status")
      .select("id, property_id, cleaning_type, cleaning_price_cents")
      .eq("id", data.statusId)
      .eq("kind", "checkout")
      .maybeSingle();
    const r = row as { id: string; property_id: string; cleaning_type: string | null; cleaning_price_cents: number | null } | null;
    if (!r || !r.cleaning_type) throw new Error("Esta limpeza ainda não foi concluída.");
    if (r.cleaning_type === data.type) return { ok: true };
    const { data: prop } = await context.supabase
      .from("properties")
      .select("cleaning_price_normal_cents, cleaning_price_full_cents")
      .eq("id", r.property_id)
      .maybeSingle();
    const p = prop as { cleaning_price_normal_cents: number | null; cleaning_price_full_cents: number | null } | null;
    const price = data.type === "completa" ? p?.cleaning_price_full_cents : p?.cleaning_price_normal_cents;
    const { error } = await context.supabase
      .from("guest_arrival_status")
      .update({
        cleaning_type: data.type,
        cleaning_approval_status: null,
        ...(price != null ? { cleaning_price_cents: price } : {}),
      } as never)
      .eq("id", r.id);
    if (error) throw new Error("Você não tem permissão para alterar esta limpeza.");
    try {
      await context.supabase.from("audit_logs").insert({
        user_id: context.userId,
        action: "cleaning_type_change",
        table_name: "guest_arrival_status",
        record_id: r.id,
        old_data: { type: r.cleaning_type, cents: r.cleaning_price_cents },
        new_data: { type: data.type, cents: price ?? r.cleaning_price_cents },
      } as never);
    } catch {
      /* best-effort */
    }
    return { ok: true };
  });
