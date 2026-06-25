import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";

export type PoiCategory = {
  id: string;
  slug: string;
  label: string;
  display_order: number;
  is_protected: boolean;
};

export type PoiTag = {
  id: string;
  slug: string;
  label: string;
  category_id: string;
  category_slug: string;
  category_label: string;
  accepted_primary_types: string[];
  places_types: string[];
  query_variants: string[];
  min_reviews: number;
  is_protected: boolean;
  display_order: number;
};

export type Taxonomy = {
  categories: PoiCategory[];
  tags: PoiTag[];
};

function publicClient() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
  );
}

// ============== Public reader (anon) ==============
export const getPoiTaxonomy = createServerFn({ method: "GET" }).handler(async (): Promise<Taxonomy> => {
  const supabase = publicClient();
  const [catsRes, tagsRes] = await Promise.all([
    supabase.from("poi_categories").select("id,slug,label,display_order,is_protected").order("display_order"),
    supabase
      .from("poi_tags")
      .select("id,slug,label,category_id,accepted_primary_types,places_types,query_variants,min_reviews,is_protected,display_order")
      .order("display_order"),
  ]);
  const categories = (catsRes.data ?? []) as PoiCategory[];
  const catById = new Map(categories.map((c) => [c.id, c]));
  const tags: PoiTag[] = ((tagsRes.data ?? []) as Array<Omit<PoiTag, "category_slug" | "category_label">>).map((t) => {
    const c = catById.get(t.category_id);
    return {
      ...t,
      category_slug: c?.slug ?? "",
      category_label: c?.label ?? "Outros",
    };
  });
  return { categories, tags };
});

// ============== Server-side cache for TYPE_MAP (used by maps.functions) ==============
let _cache: { taxonomy: Taxonomy; at: number } | null = null;
const CACHE_TTL_MS = 60_000;

export async function loadTaxonomyCached(): Promise<Taxonomy> {
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return _cache.taxonomy;
  const supabase = publicClient();
  const [catsRes, tagsRes] = await Promise.all([
    supabase.from("poi_categories").select("id,slug,label,display_order,is_protected").order("display_order"),
    supabase
      .from("poi_tags")
      .select("id,slug,label,category_id,accepted_primary_types,places_types,query_variants,min_reviews,is_protected,display_order")
      .order("display_order"),
  ]);
  const categories = (catsRes.data ?? []) as PoiCategory[];
  const catById = new Map(categories.map((c) => [c.id, c]));
  const tags: PoiTag[] = ((tagsRes.data ?? []) as Array<Omit<PoiTag, "category_slug" | "category_label">>).map((t) => {
    const c = catById.get(t.category_id);
    return {
      ...t,
      category_slug: c?.slug ?? "",
      category_label: c?.label ?? "Outros",
    };
  });
  _cache = { taxonomy: { categories, tags }, at: Date.now() };
  return _cache.taxonomy;
}

export function invalidateTaxonomyCache() {
  _cache = null;
}

// ============== Admin CRUD ==============
async function assertAdmin(ctx: { supabase: ReturnType<typeof createClient<Database>>; userId: string }) {
  const { data } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  if (!data) throw new Error("Forbidden");
}

const slugify = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

// ---- Categories ----
const CreateCategorySchema = z.object({ label: z.string().min(1).max(60) });
export const createPoiCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CreateCategorySchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const slug = `${slugify(data.label)}-${Math.random().toString(36).slice(2, 6)}`;
    const { data: row, error } = await context.supabase
      .from("poi_categories")
      .insert({ slug, label: data.label.trim(), is_protected: false, display_order: 500 })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    invalidateTaxonomyCache();
    return row;
  });

const UpdateCategorySchema = z.object({ id: z.string().uuid(), label: z.string().min(1).max(60) });
export const updatePoiCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UpdateCategorySchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase
      .from("poi_categories")
      .update({ label: data.label.trim() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    invalidateTaxonomyCache();
    return { ok: true };
  });

const DeleteCategorySchema = z.object({ id: z.string().uuid() });
export const deletePoiCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => DeleteCategorySchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: cat } = await context.supabase
      .from("poi_categories")
      .select("is_protected")
      .eq("id", data.id)
      .maybeSingle();
    if (!cat) throw new Error("Categoria não encontrada");
    if (cat.is_protected) throw new Error("Esta categoria padrão não pode ser excluída.");
    const { count } = await context.supabase
      .from("poi_tags")
      .select("id", { count: "exact", head: true })
      .eq("category_id", data.id);
    if ((count ?? 0) > 0) throw new Error("Mova ou exclua as tags desta categoria antes.");
    const { error } = await context.supabase.from("poi_categories").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    invalidateTaxonomyCache();
    return { ok: true };
  });

// ---- Tags ----
const CreateTagSchema = z.object({
  label: z.string().min(1).max(60),
  category_id: z.string().uuid(),
  accepted_primary_types: z.array(z.string()).default([]),
  places_types: z.array(z.string()).default([]),
  query_variants: z.array(z.string()).default([]),
  min_reviews: z.number().int().min(0).max(10000).default(150),
});
export const createPoiTag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CreateTagSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const slug = `${slugify(data.label)}-${Math.random().toString(36).slice(2, 6)}`;
    const { data: row, error } = await context.supabase
      .from("poi_tags")
      .insert({
        slug,
        label: data.label.trim(),
        category_id: data.category_id,
        accepted_primary_types: data.accepted_primary_types,
        places_types: data.places_types,
        query_variants: data.query_variants,
        min_reviews: data.min_reviews,
        is_protected: false,
        display_order: 500,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    invalidateTaxonomyCache();
    return row;
  });

const UpdateTagSchema = z.object({
  id: z.string().uuid(),
  label: z.string().min(1).max(60).optional(),
  category_id: z.string().uuid().optional(),
  accepted_primary_types: z.array(z.string()).optional(),
  places_types: z.array(z.string()).optional(),
  query_variants: z.array(z.string()).optional(),
  min_reviews: z.number().int().min(0).max(10000).optional(),
});
export const updatePoiTag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UpdateTagSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const patch: Record<string, unknown> = {};
    if (data.label !== undefined) patch.label = data.label.trim();
    if (data.category_id !== undefined) patch.category_id = data.category_id;
    if (data.accepted_primary_types !== undefined) patch.accepted_primary_types = data.accepted_primary_types;
    if (data.places_types !== undefined) patch.places_types = data.places_types;
    if (data.query_variants !== undefined) patch.query_variants = data.query_variants;
    if (data.min_reviews !== undefined) patch.min_reviews = data.min_reviews;
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await context.supabase.from("poi_tags").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    invalidateTaxonomyCache();
    return { ok: true };
  });

const DeleteTagSchema = z.object({ id: z.string().uuid() });
export const deletePoiTag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => DeleteTagSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: tag } = await context.supabase
      .from("poi_tags")
      .select("is_protected")
      .eq("id", data.id)
      .maybeSingle();
    if (!tag) throw new Error("Tag não encontrada");
    if (tag.is_protected) throw new Error("Esta tag padrão não pode ser excluída (usada pela IA).");
    const { error } = await context.supabase.from("poi_tags").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    invalidateTaxonomyCache();
    return { ok: true };
  });
