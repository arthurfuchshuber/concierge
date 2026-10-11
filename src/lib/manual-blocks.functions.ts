import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Imóveis do usuário em que ele pode editar a operação (dono, admin ou operation_edit). */
async function editableProperties(sb: any, userId: string, ownerId: string | null | undefined) {
  const { resolveAuthorizedAccountOwnerId } = await import("@/lib/account-scope.server");
  const tenantId = await resolveAuthorizedAccountOwnerId(sb as never, userId, ownerId ?? null);
  let allowed = tenantId === userId;
  if (!allowed) {
    const { data: isAdmin } = await sb.rpc("has_role", { _user_id: userId, _role: "admin" });
    allowed = !!isAdmin;
  }
  if (!allowed && tenantId) {
    const { data: can } = await sb.rpc("has_member_permission", { _user_id: userId, _owner_id: tenantId, _permission: "operation_edit" });
    allowed = !!can;
  }
  if (!allowed) return [] as string[];
  const { accessiblePropertyIds } = await import("@/lib/dashboard.functions");
  return accessiblePropertyIds(sb, tenantId, userId);
}

export const listManualBlocks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ ownerId: z.string().uuid().nullable().optional() }).parse(i ?? {}))
  .handler(async ({ data, context }) => {
    const ids = await editableProperties(context.supabase, context.userId, data.ownerId);
    if (!ids.length) return { canEdit: false, properties: [], blocks: [] };
    const today = new Date().toISOString().slice(0, 10);
    const [{ data: props }, { data: blocks }] = await Promise.all([
      context.supabase.from("properties").select("id, name").in("id", ids).order("name"),
      context.supabase
        .from("property_reservations")
        .select("id, property_id, checkin_date, checkout_date, raw_summary")
        .in("property_id", ids)
        .eq("source", "manual")
        .eq("status", "blocked")
        .gte("checkout_date", today)
        .order("checkin_date"),
    ]);
    return {
      canEdit: true,
      properties: (props ?? []) as Array<{ id: string; name: string }>,
      blocks: ((blocks ?? []) as any[]).map((b) => ({ id: b.id as string, propertyId: b.property_id as string, from: b.checkin_date as string, to: b.checkout_date as string, note: (b.raw_summary as string | null) ?? null })),
    };
  });

export const createManualBlockFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ ownerId: z.string().uuid().nullable().optional(), propertyId: z.string().uuid(), from: ISO, to: ISO, note: z.string().max(200).nullable().optional() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const ids = await editableProperties(context.supabase, context.userId, data.ownerId);
    if (!ids.includes(data.propertyId)) throw new Error("Sem permissão para bloquear este imóvel.");
    const { createManualBlock } = await import("@/lib/manual-blocks.server");
    return createManualBlock({ ...data, userId: context.userId });
  });

export const removeManualBlockFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ ownerId: z.string().uuid().nullable().optional(), propertyId: z.string().uuid(), id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const ids = await editableProperties(context.supabase, context.userId, data.ownerId);
    if (!ids.includes(data.propertyId)) throw new Error("Sem permissão para desbloquear este imóvel.");
    const { removeManualBlock } = await import("@/lib/manual-blocks.server");
    return removeManualBlock({ ...data, userId: context.userId });
  });
