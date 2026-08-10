import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { resolveAccountOwnerId } from "@/lib/active-account.functions";

export type ProviderCategory = { id: string; slug: string; label: string };

const DEFAULTS: Array<{ slug: string; label: string }> = [
  { slug: "limpeza", label: "Limpeza" },
  { slug: "manutencao", label: "Manutenção" },
  { slug: "portaria", label: "Portaria" },
  { slug: "lavanderia", label: "Lavanderia" },
  { slug: "jardinagem", label: "Jardinagem" },
  { slug: "piscina", label: "Piscina" },
  { slug: "outros", label: "Outros" },
];

function slugify(v: string) {
  return v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

/** Categorias de serviço da conta. Na primeira leitura, cria as padrões — a
 * partir daí o usuário pode renomear, excluir ou criar novas livremente. */
export const listProviderCategories = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ProviderCategory[]> => {
    const { supabase, userId } = context;
    const accountId = await resolveAccountOwnerId(supabase, userId);
    const { data } = await supabase
      .from("provider_categories")
      .select("id, slug, label")
      .eq("account_owner_id", accountId)
      .order("label");
    if (data && data.length > 0) return data as ProviderCategory[];

    await supabase
      .from("provider_categories")
      .insert(DEFAULTS.map((d) => ({ ...d, account_owner_id: accountId })) as never);
    const { data: seeded } = await supabase
      .from("provider_categories")
      .select("id, slug, label")
      .eq("account_owner_id", accountId)
      .order("label");
    return (seeded ?? []) as ProviderCategory[];
  });

/** Cria ou renomeia uma categoria de serviço. */
export const saveProviderCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({ id: z.string().uuid().optional().nullable(), label: z.string().trim().min(2).max(60) })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<ProviderCategory> => {
    const { supabase, userId } = context;
    const accountId = await resolveAccountOwnerId(supabase, userId);
    const label = data.label.trim();

    if (data.id) {
      const { data: row, error } = await supabase
        .from("provider_categories")
        .update({ label } as never)
        .eq("id", data.id)
        .eq("account_owner_id", accountId)
        .select("id, slug, label")
        .single();
      if (error) throw new Error("Não foi possível renomear a categoria.");
      return row as ProviderCategory;
    }

    const slug = slugify(label) || `cat-${Date.now()}`;
    const { data: row, error } = await supabase
      .from("provider_categories")
      .insert({ account_owner_id: accountId, slug, label } as never)
      .select("id, slug, label")
      .single();
    if (error) throw new Error("Já existe uma categoria com esse nome.");
    return row as ProviderCategory;
  });

/** Exclui uma categoria de serviço da conta. */
export const deleteProviderCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const accountId = await resolveAccountOwnerId(supabase, userId);
    const { error } = await supabase
      .from("provider_categories")
      .delete()
      .eq("id", data.id)
      .eq("account_owner_id", accountId);
    if (error) throw new Error("Não foi possível excluir a categoria.");
    return { ok: true };
  });
