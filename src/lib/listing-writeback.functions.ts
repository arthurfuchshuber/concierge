import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Fields = z.object({
  availability: z.number().int().min(0).max(1).nullable().optional(),
  rate: z.number().min(0).nullable().optional(),
  min_stay: z.number().int().min(1).max(1000).nullable().optional(),
  max_stay: z.number().int().min(1).max(1000).nullable().optional(),
  stop_sell: z.boolean().nullable().optional(),
  closed_to_arrival: z.boolean().nullable().optional(),
  closed_to_departure: z.boolean().nullable().optional(),
});

const Patch = z.object({
  checkin_time: z.string().nullable().optional(),
  checkin_time_max: z.string().nullable().optional(),
  checkout_time: z.string().nullable().optional(),
  instant_booking: z.boolean().optional(),
  cancellation_category: z.string().optional(),
  guest_controls: z.record(z.string(), z.union([z.boolean(), z.number()])).optional(),
  availability: z.record(z.string(), z.any()).optional(),
  pricing: z.record(z.string(), z.any()).optional(),
  published: z.boolean().optional(),
  unpublish_reason: z.string().optional(),
});

/** O usuário só age em imóvel que o RLS deixa ele ver e editar (mesma regra do editor). */
async function assertCanEdit(supabase: any, userId: string, propertyId: string) {
  const { data } = await supabase.from("properties").select("id").eq("id", propertyId).maybeSingle();
  if (!data) throw new Error("Imóvel não encontrado ou sem permissão.");
  const { enforce } = await import("@/lib/permissions/permission.enforce.server");
  await enforce(userId, "imoveis.editor.write", { propertyId });
}

export const pushListingSettingsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ propertyId: z.string().uuid(), patch: Patch, allowPricing: z.boolean().optional(), dryRun: z.boolean().optional() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertCanEdit(context.supabase, context.userId, data.propertyId);
    const { pushListingSettings } = await import("@/lib/listing-writeback.server");
    return pushListingSettings({ ...data, patch: data.patch as never, userId: context.userId, source: "painel" });
  });

export const pushCalendarFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ propertyId: z.string().uuid(), dateFrom: z.string(), dateTo: z.string(), fields: Fields, allowPricing: z.boolean().optional() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertCanEdit(context.supabase, context.userId, data.propertyId);
    const { pushCalendar } = await import("@/lib/listing-writeback.server");
    return pushCalendar({ ...data, fields: data.fields as never, userId: context.userId, source: "painel" });
  });
