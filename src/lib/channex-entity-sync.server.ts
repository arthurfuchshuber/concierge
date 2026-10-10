/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Sincronização contínua de TUDO que a Channex expõe (fora reservas/mensagens,
 * que já têm fluxo próprio): propriedades, quartos, tarifas, canais e o
 * catálogo completo de anúncios de cada canal (que reflete edições feitas no
 * Airbnb). Cada entidade é gravada integralmente em `channex_raw_records`;
 * mudanças detectadas por comparação com a última versão gravada disparam:
 *  - título do anúncio alterado → renomeia o quarto vinculado na Channex
 *    (PriceLabs lê o nome a partir daí);
 *  - anúncio piloto alterado → atualiza `property_listing_raw_data` e reindexa a IA.
 * Nunca envia ARI (preço/disponibilidade) nem cria mapping.
 */
const BASE = "https://app.channex.io/api/v1";
const MIN_INTERVAL_MS = 5 * 60_000;

async function get(path: string): Promise<any> {
  const key = process.env["CHANNEX_API_KEY"] ?? process.env["CHANNEX_STAGING_API_KEY"];
  if (!key) throw new Error("Chave Channex ausente.");
  const res = await fetch(`${BASE}${path}`, { headers: { "user-api-key": key, Accept: "application/json" } });
  if (!res.ok) throw new Error(`Channex ${res.status} em ${path}`);
  return res.json();
}

async function getAll(path: string): Promise<any[]> {
  const out: any[] = [];
  for (let page = 1; page <= 30; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const rows = ((await get(`${path}${sep}pagination[page]=${page}&pagination[limit]=100`))?.data ?? []) as any[];
    out.push(...rows);
    if (rows.length < 100) break;
  }
  return out;
}

/** Serialização estável (ordem de chaves) para comparar versões. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stableStringify((v as any)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/** A Channex prefixa o título com "<conta> <apelido> · "; o nome público do anúncio é o que vem depois. */
export const listingTitle = (raw: unknown) => {
  const s = String(raw ?? "").trim();
  const i = s.lastIndexOf(" · ");
  return (i >= 0 ? s.slice(i + 3) : s).trim();
};

/** Nome interno do anúncio (prefixo antes de " · "), ou "" se não houver. */
export const internalName = (raw: unknown) => {
  const s = String(raw ?? "").trim();
  const i = s.lastIndexOf(" · ");
  return i >= 0 ? s.slice(0, i).trim() : "";
};

/** Nome composto "[Nome interno] - [Título do anúncio]" (usado quando a propriedade é compartilhada). */
export const roomTypeName = (raw: unknown) => {
  const s = String(raw ?? "").trim();
  const i = s.lastIndexOf(" · ");
  return i >= 0 ? `${s.slice(0, i).trim()} - ${s.slice(i + 3).trim()}` : s;
};

/**
 * Regra para todo imóvel: PriceLabs exibe "[Propriedade] - [Quarto]".
 * Propriedade exclusiva do anúncio → propriedade = nome interno, quarto = título público.
 * Propriedade compartilhada → quarto leva o nome composto (propriedade não é tocada).
 */
export const namingFor = (raw: unknown, exclusive: boolean) => {
  const internal = internalName(raw);
  if (exclusive && internal) return { property: internal, room: listingTitle(raw) };
  return { property: null as string | null, room: roomTypeName(raw) };
};

export const normTitle = (s: unknown) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

export type EntitySyncResult = {
  skipped?: boolean;
  entities: number;
  changed: number;
  renamedRoomTypes: number;
  listingsUpdated: number;
};

type Rec = { entity_type: string; channex_id: string; payload: any; parent_id?: string | null; channex_property_id?: string | null };

export async function syncChannexEntities(opts: { force?: boolean; source?: string } = {}): Promise<EntitySyncResult> {
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const { saveRawRecords, channexPropertyOf } = await import("@/lib/channex-raw.server");

  // Throttle via banco (workers são stateless).
  if (!opts.force) {
    const { data: last } = await admin
      .from("channex_raw_records")
      .select("last_synced_at")
      .eq("entity_type", "sync:entities")
      .eq("channex_id", "last_run")
      .maybeSingle();
    const t = last?.last_synced_at ? Date.parse(last.last_synced_at as string) : 0;
    if (Date.now() - t < MIN_INTERVAL_MS) return { skipped: true, entities: 0, changed: 0, renamedRoomTypes: 0, listingsUpdated: 0 };
  }
  await saveRawRecords([{ entity_type: "sync:entities", channex_id: "last_run", payload: { at: new Date().toISOString() }, source: opts.source ?? "sync" }]);

  const [properties, roomTypes, ratePlans, channels] = await Promise.all([
    getAll("/properties"),
    getAll("/room_types"),
    getAll("/rate_plans"),
    getAll("/channels"),
  ]);

  const recs: Rec[] = [];
  for (const p of properties) recs.push({ entity_type: "property", channex_id: p.id, payload: p, channex_property_id: p.id });
  for (const r of roomTypes) recs.push({ entity_type: "room_type", channex_id: r.id, payload: r, channex_property_id: channexPropertyOf(r) });
  for (const r of ratePlans) recs.push({ entity_type: "rate_plan", channex_id: r.id, payload: r, channex_property_id: channexPropertyOf(r) });
  for (const c of channels) recs.push({ entity_type: "channel", channex_id: c.id, payload: c });

  // Catálogo completo de anúncios por canal (edições feitas na OTA aparecem aqui).
  const listingsByChannel = new Map<string, any[]>();
  for (const c of channels) {
    const json = await get(`/channels/${c.id}/action/listings`).catch(() => null);
    const values = (json?.data?.listing_id_dictionary?.values ?? []) as any[];
    if (!json) continue;
    listingsByChannel.set(c.id, values);
    for (const l of values) {
      if (l?.id == null) continue;
      recs.push({ entity_type: "channel_listing", channex_id: String(l.id), parent_id: c.id, payload: l });
    }
  }

  // Versões anteriores para detectar mudanças.
  const prev = new Map<string, string>();
  const types = [...new Set(recs.map((r) => r.entity_type))];
  for (const t of types) {
    const ids = recs.filter((r) => r.entity_type === t).map((r) => r.channex_id);
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await admin.from("channex_raw_records").select("channex_id, payload").eq("entity_type", t).in("channex_id", ids.slice(i, i + 200));
      for (const row of data ?? []) prev.set(`${t}:${row.channex_id}`, stableStringify(row.payload));
    }
  }
  const changedRecs = recs.filter((r) => prev.get(`${r.entity_type}:${r.channex_id}`) !== stableStringify(r.payload));
  await saveRawRecords(recs.map((r) => ({ ...r, source: opts.source ?? "sync" })));

  // Vínculos anúncio → quarto Channex (persistidos; criados por título idêntico na 1ª vez).
  const { PILOT_LISTING_CONFIG, LISTING_ALIASES } = await import("@/lib/channex-listing.server");
  const links = new Map<string, string>();
  {
    const { data } = await admin.from("channex_raw_records").select("channex_id, payload").eq("entity_type", "link:listing_room_type");
    for (const row of data ?? []) links.set(String(row.channex_id), String((row.payload as any)?.room_type_id));
  }
  for (const [lid, cfg] of Object.entries(PILOT_LISTING_CONFIG)) if (cfg.roomTypeId && !LISTING_ALIASES[lid]) links.set(lid, cfg.roomTypeId);
  const newLinks: Rec[] = [];
  for (const [channelId, values] of listingsByChannel) {
    const ch = channels.find((c) => c.id === channelId);
    const propIds = new Set<string>((ch?.attributes?.properties ?? []) as string[]);
    const rts = roomTypes.filter((r) => propIds.has(channexPropertyOf(r) ?? ""));
    for (const l of values) {
      const lid = String(l?.id ?? "");
      if (!lid || links.has(lid)) continue;
      const t = normTitle(listingTitle(l.title));
      const full = normTitle(roomTypeName(l.title));
      const matches = rts.filter((r) => [t, full].includes(normTitle(r.attributes?.title)));
      if (matches.length === 1) {
        links.set(lid, matches[0].id);
        newLinks.push({ entity_type: "link:listing_room_type", channex_id: lid, payload: { room_type_id: matches[0].id, channel_id: channelId } });
      }
    }
  }
  if (newLinks.length) await saveRawRecords(newLinks.map((r) => ({ ...r, source: "sync" })));

  // Renomeia propriedade/quarto conforme o anúncio (fonte de verdade = OTA), via `namingFor`.
  const { channexRequest } = await import("@/lib/channex-ari.server");
  let renamed = 0;
  const rtCount = new Map<string, number>();
  for (const r of roomTypes) {
    const p = channexPropertyOf(r) ?? "";
    rtCount.set(p, (rtCount.get(p) ?? 0) + 1);
  }
  for (const values of listingsByChannel.values()) {
    for (const l of values) {
      const rtId = links.get(String(l?.id ?? ""));
      if (!rtId || !l?.title) continue;
      const rt = roomTypes.find((r) => r.id === rtId);
      if (!rt) continue;
      const propId = channexPropertyOf(rt) ?? "";
      const { property, room } = namingFor(l.title, rtCount.get(propId) === 1);
      if (room && String(rt.attributes?.title ?? "").trim() !== room) {
        const res = await channexRequest({ operation: "room_type_rename", method: "PUT", path: `/room_types/${rtId}`, body: { room_type: { title: room } } });
        if (res.ok) renamed += 1;
        else console.error("[channex-entity-sync] rename", rtId, res.error);
      }
      const prop = properties.find((p) => p.id === propId);
      if (property && prop && String(prop.attributes?.title ?? "").trim() !== property) {
        const res = await channexRequest({ operation: "property_rename", method: "PUT", path: `/properties/${propId}`, body: { property: { title: property } } });
        if (!res.ok) console.error("[channex-entity-sync] property rename", propId, res.error);
      }
    }
  }

  // Anúncios piloto alterados → atualiza dados do imóvel e reindexa a IA (sem raspar página pública).
  let listingsUpdated = 0;
  const changedListingIds = new Set(changedRecs.filter((r) => r.entity_type === "channel_listing").map((r) => r.channex_id));
  for (const [lid, cfg] of Object.entries(PILOT_LISTING_CONFIG)) {
    if (!changedListingIds.has(lid)) continue;
    const meta = listingsByChannel.get(cfg.channelId)?.find((l) => String(l.id) === lid);
    if (!meta) continue;
    const { data: prop } = await admin.from("properties").select("id").eq("slug", cfg.slug).maybeSingle();
    if (!prop) continue;
    const { error } = await admin
      .from("property_listing_raw_data")
      .update({ listing_meta: meta, synced_at: new Date().toISOString(), updated_at: new Date().toISOString() } as never)
      .eq("property_id", prop.id);
    if (error) continue;
    const { reindexProperty } = await import("@/lib/ai/indexing.server");
    await reindexProperty(admin as never, prop.id as string).catch(() => undefined);
    listingsUpdated += 1;
  }

  return { entities: recs.length, changed: changedRecs.length, renamedRoomTypes: renamed, listingsUpdated };
}
