/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Guarda 100% do que a Channex devolve, sem filtrar campos, em
 * `channex_raw_records` (uma linha por entidade, upsert idempotente).
 */
export type RawRecord = {
  entity_type: string;
  channex_id: string;
  payload: unknown;
  parent_id?: string | null;
  channex_property_id?: string | null;
  property_id?: string | null;
  source?: string;
};

export async function saveRawRecords(records: RawRecord[]): Promise<number> {
  const rows = records.filter((r) => r.channex_id);
  if (!rows.length) return 0;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const now = new Date().toISOString();
  let saved = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200).map((r) => ({
      entity_type: r.entity_type,
      channex_id: String(r.channex_id),
      parent_id: r.parent_id ?? null,
      channex_property_id: r.channex_property_id ?? null,
      property_id: r.property_id ?? null,
      payload: r.payload as never,
      source: r.source ?? "backfill",
      last_synced_at: now,
    }));
    const { error } = await supabaseAdmin.from("channex_raw_records").upsert(chunk as never, { onConflict: "entity_type,channex_id" });
    if (error) console.error("[channex-raw]", r0(chunk), error.message);
    else saved += chunk.length;
  }
  return saved;
}

const r0 = (c: any[]) => c[0]?.entity_type;

/** Propriedade Channex de uma entidade JSON:API, quando houver. */
export function channexPropertyOf(item: any): string | null {
  return (
    item?.relationships?.property?.data?.id ??
    item?.attributes?.property_id ??
    null
  );
}
