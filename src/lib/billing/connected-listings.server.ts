/**
 * Anúncios conectados ATIVOS de uma conta — a base da cobrança por anúncio.
 *
 * Um único lugar decide o que é cobrado: a tela "Imóveis Cobrados" e a sincronização com a
 * Stripe leem daqui. Ativo = anúncio com `airbnb_listing_id`, sem pausa de sincronização e com o
 * imóvel não arquivado; cada gêmeo ativo conta como um anúncio próprio.
 */
export type ConnectedListing = {
  listingId: string;
  name: string;
  kind: "primary" | "twin";
  propertyName: string;
};

export async function loadConnectedListings(admin: any, ownerId: string): Promise<ConnectedListing[]> {
  const [prim, twins] = await Promise.all([
    admin
      .from("property_listing_raw_data")
      .select("property_id, airbnb_listing_id, properties!inner(name, owner_id, archived_at)")
      .eq("properties.owner_id", ownerId)
      .is("properties.archived_at", null)
      .is("sync_paused_at", null)
      .not("airbnb_listing_id", "is", null),
    admin
      .from("channex_twin_links")
      .select("property_id, twin_listing_id, twin_title")
      .eq("owner_id", ownerId)
      .eq("status", "active"),
  ]);
  // Na cobrança, um erro de leitura não pode virar "zero anúncios" (pausaria a cobrança).
  if (prim.error) throw new Error(`Falha ao ler anúncios conectados: ${prim.error.message}`);
  if (twins.error) throw new Error(`Falha ao ler anúncios gêmeos: ${twins.error.message}`);

  const nameByProp = new Map<string, string>();
  const items: ConnectedListing[] = [];
  for (const r of (prim.data ?? []) as any[]) {
    const n = r.properties?.name ?? "Imóvel";
    nameByProp.set(r.property_id, n);
    items.push({ listingId: String(r.airbnb_listing_id ?? r.property_id), name: n, kind: "primary", propertyName: n });
  }
  const seen = new Set(items.map((i) => i.listingId));
  for (const t of (twins.data ?? []) as any[]) {
    const id = String(t.twin_listing_id);
    // Gêmeo de imóvel pausado/arquivado não está ativo.
    if (seen.has(id) || !nameByProp.has(t.property_id)) continue;
    seen.add(id);
    const pn = nameByProp.get(t.property_id) ?? "Imóvel";
    items.push({ listingId: id, name: t.twin_title ?? `Anúncio ${id}`, kind: "twin", propertyName: pn });
  }
  items.sort((a, b) => a.propertyName.localeCompare(b.propertyName, "pt-BR") || (a.kind === "primary" ? -1 : 1));
  return items;
}
