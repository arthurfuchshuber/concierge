import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { PropertyType } from "@/lib/property-types.server";

export type { PropertyType };

/** Tipos de imóvel da conta. Na primeira leitura cria os padrões — a partir
 * daí o anfitrião pode renomear, excluir ou criar novos livremente. */
export const listPropertyTypes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PropertyType[]> => {
    const { DEFAULT_PROPERTY_TYPES, resolveAccountOwnerId } = await import(
      "@/lib/property-types.server"
    );
    const { supabase, userId } = context;
    const accountId = await resolveAccountOwnerId(supabase, userId);
    const { data } = await supabase
      .from("property_types")
      .select("id, slug, label")
      .eq("account_owner_id", accountId)
      .order("label");
    if (data && data.length > 0) return data as PropertyType[];

    await supabase
      .from("property_types")
      .insert(
        DEFAULT_PROPERTY_TYPES.map((d) => ({ ...d, account_owner_id: accountId })) as never,
      );
    const { data: seeded } = await supabase
      .from("property_types")
      .select("id, slug, label")
      .eq("account_owner_id", accountId)
      .order("label");
    return (seeded ?? []) as PropertyType[];
  });

/** Cria ou renomeia um tipo de imóvel. */
export const savePropertyType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        id: z.string().uuid().optional().nullable(),
        label: z.string().trim().min(2).max(60),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<PropertyType> => {
    const { resolveAccountOwnerId, slugifyPropertyType } = await import(
      "@/lib/property-types.server"
    );
    const { supabase, userId } = context;
    const accountId = await resolveAccountOwnerId(supabase, userId);
    const label = data.label.trim();

    if (data.id) {
      const { data: row, error } = await supabase
        .from("property_types")
        .update({ label } as never)
        .eq("id", data.id)
        .eq("account_owner_id", accountId)
        .select("id, slug, label")
        .single();
      if (error) throw new Error("Não foi possível renomear o tipo de imóvel.");
      return row as PropertyType;
    }

    const slug = slugifyPropertyType(label) || `tipo-${Date.now()}`;
    const { data: row, error } = await supabase
      .from("property_types")
      .insert({ account_owner_id: accountId, slug, label } as never)
      .select("id, slug, label")
      .single();
    if (error) throw new Error("Já existe um tipo de imóvel com esse nome.");
    return row as PropertyType;
  });

/** Exclui um tipo de imóvel da conta. Imóveis que usavam essa opção ficam sem
 * tipo definido (property_type_id vira NULL via ON DELETE SET NULL). */
export const deletePropertyType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { resolveAccountOwnerId } = await import("@/lib/property-types.server");
    const { supabase, userId } = context;
    const accountId = await resolveAccountOwnerId(supabase, userId);
    const { error } = await supabase
      .from("property_types")
      .delete()
      .eq("id", data.id)
      .eq("account_owner_id", accountId);
    if (error) throw new Error("Não foi possível excluir o tipo de imóvel.");
    return { ok: true };
  });
