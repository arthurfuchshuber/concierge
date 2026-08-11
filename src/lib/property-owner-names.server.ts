import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Anexa `ownerName` (nome fantasia > nome) a cada imóvel, resolvendo
 * `owner_contact_id` -> `property_owners`. Usado para ordenar/exibir listas
 * de guias por proprietário.
 */
export async function attachOwnerNames<T extends { owner_contact_id?: string | null }>(
  client: SupabaseClient,
  rows: T[],
): Promise<Array<T & { ownerName: string | null }>> {
  const ids = Array.from(
    new Set(rows.map((r) => r.owner_contact_id).filter((v): v is string => !!v)),
  );
  const nameById = new Map<string, string>();
  if (ids.length > 0) {
    const { data } = await client
      .from("property_owners")
      .select("id, name, trade_name")
      .in("id", ids);
    for (const o of (data ?? []) as Array<{ id: string; name: string | null; trade_name: string | null }>) {
      const label = (o.trade_name || o.name || "").trim();
      if (label) nameById.set(o.id, label);
    }
  }
  return rows.map((r) => ({
    ...r,
    ownerName: r.owner_contact_id ? (nameById.get(r.owner_contact_id) ?? null) : null,
  }));
}
