import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Anexa `ownerName` (nome fantasia > nome) e o telefone de contato a cada
 * imóvel, resolvendo `owner_contact_id` -> `property_owners`.
 */
export async function attachOwnerNames<T extends { owner_contact_id?: string | null }>(
  client: SupabaseClient,
  rows: T[],
): Promise<Array<T & { ownerName: string | null; ownerPhone: string | null; ownerPhoneCountry: string | null }>> {
  const ids = Array.from(
    new Set(rows.map((r) => r.owner_contact_id).filter((v): v is string => !!v)),
  );
  const byId = new Map<string, { name: string | null; phone: string | null; phoneCountry: string | null }>();
  if (ids.length > 0) {
    const { data } = await client
      .from("property_owners")
      .select("id, name, trade_name, phone, phone_country")
      .in("id", ids);
    for (const o of (data ?? []) as Array<{
      id: string;
      name: string | null;
      trade_name: string | null;
      phone: string | null;
      phone_country: string | null;
    }>) {
      const label = (o.trade_name || o.name || "").trim();
      byId.set(o.id, { name: label || null, phone: o.phone ?? null, phoneCountry: o.phone_country ?? null });
    }
  }
  return rows.map((r) => {
    const o = r.owner_contact_id ? byId.get(r.owner_contact_id) : undefined;
    return {
      ...r,
      ownerName: o?.name ?? null,
      ownerPhone: o?.phone ?? null,
      ownerPhoneCountry: o?.phoneCountry ?? null,
    };
  });
}
