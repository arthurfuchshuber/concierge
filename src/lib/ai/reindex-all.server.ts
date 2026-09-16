import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Reindexa a base de conhecimento de vários imóveis em lote.
 * Executado em pequenos grupos para não estourar o limite de embeddings.
 */
export async function reindexAllProperties(params: {
  supabase: SupabaseClient;
  onlyPublished?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ total: number; done: number; indexed: number; failed: string[] }> {
  const { supabase } = params;
  const limit = params.limit ?? 40;
  const offset = params.offset ?? 0;

  let query = supabase.from("properties").select("id").order("created_at", { ascending: true });
  if (params.onlyPublished) query = query.eq("published", true);
  const { data, error } = await query.range(offset, offset + limit - 1);
  if (error) throw new Error(error.message);

  const ids = (data ?? []).map((r) => String((r as { id: string }).id));
  const { reindexProperty } = await import("./indexing.server");

  let indexed = 0;
  let done = 0;
  const failed: string[] = [];

  for (const id of ids) {
    try {
      const res = await reindexProperty(supabase, id);
      indexed += res.indexed;
      done += 1;
    } catch (e) {
      console.error("[reindex-all] falhou", id, e);
      failed.push(id);
    }
  }

  return { total: ids.length, done, indexed, failed };
}
