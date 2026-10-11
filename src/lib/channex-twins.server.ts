/**
 * Anúncios gêmeos: dois anúncios do Airbnb da mesma casa física, cada um com
 * unidade própria na Channex (o PriceLabs lista os dois) e calendários
 * travados juntos pelo ConciergeIA a partir de `channex_twin_links`.
 */
const B = "https://app.channex.io/api/v1";

function headers() {
  const key = process.env["CHANNEX_API_KEY"] ?? process.env["CHANNEX_STAGING_API_KEY"];
  if (!key) throw new Error("Chave Channex ausente.");
  return { "user-api-key": key, "Content-Type": "application/json", Accept: "application/json" };
}

async function cx<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${B}${path}`, { ...init, headers: headers() });
  const text = await res.text();
  if (!res.ok) throw new Error(`Channex ${res.status}: ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : null) as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type ListingRow = {
  channelId: string;
  channelTitle: string;
  listingId: string;
  title: string;
  mappingId: string;
  ratePlanId: string;
  roomTypeId: string | null;
  propertyId: string | null;
};

/** Lista todos os anúncios Airbnb mapeados, com o Room Type que cada um consome. */
export async function listAirbnbListings(): Promise<ListingRow[]> {
  const chans = await cx<{ data: any[] }>("/channels?pagination[limit]=100");
  const out: ListingRow[] = [];
  for (const c of chans.data ?? []) {
    if (c.attributes?.channel !== "AirBNB") continue;
    const [full, listings] = await Promise.all([
      cx<{ data: any }>(`/channels/${c.id}`),
      cx<{ data: any }>(`/channels/${c.id}/action/listings`).catch(() => null),
    ]);
    const titles = new Map<string, string>(
      ((listings?.data?.listing_id_dictionary?.values ?? []) as any[]).map((l) => [String(l.id), String(l.title ?? l.id)]),
    );
    for (const m of full.data.attributes.rate_plans ?? []) {
      const rp = await cx<{ data: any }>(`/rate_plans/${m.rate_plan_id}`).catch(() => null);
      const listingId = String(m.settings?.listing_id ?? "");
      out.push({
        channelId: c.id,
        channelTitle: String(c.attributes?.title ?? ""),
        listingId,
        title: titles.get(listingId) ?? listingId,
        mappingId: m.id,
        ratePlanId: m.rate_plan_id,
        roomTypeId: rp?.data?.relationships?.room_type?.data?.id ?? null,
        propertyId: rp?.data?.relationships?.property?.data?.id ?? null,
      });
    }
  }
  return out;
}

const publicTitle = (raw: string) => (raw.includes(" · ") ? raw.slice(raw.lastIndexOf(" · ") + 3) : raw).trim();

/** Inclui a propriedade em todas as chaves ativas do PriceLabs restritas por propriedade. */
async function grantPriceLabsAccess(channexPropertyId: string) {
  const keys = await cx<{ data: any[] }>("/api_keys?pagination[limit]=100").catch(() => ({ data: [] as any[] }));
  for (const k of keys.data ?? []) {
    const a = k.attributes ?? {};
    if (a.is_withdrawn || !/pricelabs/i.test(String(a.title ?? ""))) continue;
    const pol = a.property_policy ?? {};
    if (pol.mode !== "selected") continue;
    const props: string[] = pol.properties ?? [];
    if (props.includes(channexPropertyId)) continue;
    await cx(`/api_keys/${k.id}`, {
      method: "PUT",
      body: JSON.stringify({ api_key: { property_policy: { mode: "selected", properties: [...props, channexPropertyId] } } }),
    });
  }
}

/**
 * Une dois anúncios da mesma casa física mantendo CADA UM com unidade própria
 * na Channex (assim o PriceLabs lista os dois). O par é gravado em
 * `channex_twin_links`; o calendário dos dois passa a ser a soma das reservas
 * de ambos, enviado já na união e a cada reserva recebida.
 */
export async function linkTwinListing(input: { channelId: string; primaryListingId: string; twinListingId: string; userId?: string | null }) {
  if (input.primaryListingId === input.twinListingId) throw new Error("Escolha dois anúncios diferentes.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const { data: existing } = await db.from("channex_twin_links").select("id, status").eq("twin_listing_id", input.twinListingId).maybeSingle();
  if (existing?.status === "active") return { alreadyLinked: true };

  const rows = (await listAirbnbListings()).filter((r) => r.channelId === input.channelId);
  const primary = rows.find((r) => r.listingId === input.primaryListingId);
  const twin = rows.find((r) => r.listingId === input.twinListingId);
  if (!primary?.roomTypeId || !primary.propertyId) throw new Error("Anúncio principal não encontrado na Channex.");
  if (!twin?.propertyId) throw new Error("Anúncio gêmeo não encontrado na Channex.");
  const twinTitle = publicTitle(twin.title) || twin.listingId;

  // Imóvel do ConciergeIA (dono do par) pelo anúncio principal.
  const { data: raw } = await db.from("property_listing_raw_data").select("property_id").eq("airbnb_listing_id", input.primaryListingId).maybeSingle();
  const propertyId: string | null = raw?.property_id ?? null;
  let ownerId: string | null = null;
  if (propertyId) ownerId = (await db.from("properties").select("owner_id").eq("id", propertyId).maybeSingle()).data?.owner_id ?? null;

  // 1) Unidade própria do gêmeo: reaproveita se ele já tem propriedade só dele.
  let unit: { propertyId: string; roomTypeId: string; ratePlanId: string };
  const sharedWithPrimary = twin.propertyId === primary.propertyId;
  const twinRts = sharedWithPrimary ? [] : ((await cx<{ data: any[] }>(`/room_types?filter[property_id]=${twin.propertyId}`)).data ?? []);
  if (!sharedWithPrimary && twinRts.length === 1 && twin.roomTypeId === twinRts[0].id) {
    unit = { propertyId: twin.propertyId, roomTypeId: twin.roomTypeId!, ratePlanId: twin.ratePlanId };
  } else {
    const base = (await cx<{ data: any }>(`/properties/${primary.propertyId}`)).data;
    const ba = base?.attributes ?? {};
    const groupId = base?.relationships?.groups?.data?.[0]?.id ?? base?.relationships?.group?.data?.id;
    const prop = await cx<{ data: { id: string } }>("/properties", {
      method: "POST",
      body: JSON.stringify({
        property: {
          title: `${String(ba.title ?? "").trim()} - ${twinTitle}`.slice(0, 250),
          currency: ba.currency ?? "BRL", country: ba.country ?? "BR", city: ba.city, address: ba.address,
          zip_code: ba.zip_code, timezone: ba.timezone ?? "America/Sao_Paulo", property_type: ba.property_type ?? "guest_house",
          latitude: ba.latitude, longitude: ba.longitude, ...(groupId ? { group_id: groupId } : {}),
        },
      }),
    });
    const oldRt = twin.roomTypeId ? (await cx<{ data: any }>(`/room_types/${twin.roomTypeId}`).catch(() => null))?.data?.attributes : null;
    const occ = Number(oldRt?.default_occupancy ?? oldRt?.occ_adults ?? 2) || 2;
    const rt = await cx<{ data: { id: string } }>("/room_types", {
      method: "POST",
      body: JSON.stringify({ room_type: { property_id: prop.data.id, title: twinTitle, count_of_rooms: 1, occ_adults: occ, occ_children: 0, occ_infants: 0, default_occupancy: occ } }),
    });
    const oldRp = (await cx<{ data: any }>(`/rate_plans/${twin.ratePlanId}`).catch(() => null))?.data?.attributes;
    const rate = Number(oldRp?.options?.[0]?.rate ?? 0) || 1;
    const rp = await cx<{ data: { id: string } }>("/rate_plans", {
      method: "POST",
      body: JSON.stringify({ rate_plan: { title: twinTitle, property_id: prop.data.id, room_type_id: rt.data.id, currency: ba.currency ?? "BRL", sell_mode: "per_room", rate_mode: "manual", options: [{ occupancy: occ, is_primary: true, rate }] } }),
    });
    unit = { propertyId: prop.data.id, roomTypeId: rt.data.id, ratePlanId: rp.data.id };
    // Liga a nova propriedade ao canal do Airbnb.
    const ch = (await cx<{ data: any }>(`/channels/${input.channelId}`)).data?.attributes ?? {};
    const props: string[] = ch.properties ?? [];
    if (!props.includes(unit.propertyId)) {
      await cx(`/channels/${input.channelId}`, { method: "PUT", body: JSON.stringify({ channel: { properties: [...props, unit.propertyId] } }) });
    }
  }

  // 2) PriceLabs passa a enxergar a unidade nova.
  await grantPriceLabsAccess(unit.propertyId).catch((e) => console.error("[twins] pricelabs", e));
  await grantPriceLabsAccess(primary.propertyId).catch(() => undefined);

  // 3) Grava o par e já envia o calendário unido (antes de religar o anúncio).
  const row = {
    owner_id: ownerId, property_id: propertyId, channel_id: input.channelId,
    primary_listing_id: primary.listingId, primary_title: publicTitle(primary.title),
    primary_channex_property_id: primary.propertyId, primary_room_type_id: primary.roomTypeId, primary_rate_plan_id: primary.ratePlanId,
    twin_listing_id: twin.listingId, twin_title: twinTitle,
    twin_channex_property_id: unit.propertyId, twin_room_type_id: unit.roomTypeId, twin_rate_plan_id: unit.ratePlanId,
    status: "active", last_error: null, created_by: input.userId ?? null, updated_at: new Date().toISOString(),
  };
  const { error } = await db.from("channex_twin_links").upsert(row, { onConflict: "twin_listing_id" });
  if (error) throw new Error(error.message);
  const { syncTwinPair } = await import("@/lib/channex-mapping.server");
  const pre = await syncTwinPair(twin.listingId, input.userId ?? null);
  if (!pre.ok) {
    await db.from("channex_twin_links").update({ last_error: "A Channex não confirmou o calendário inicial." }).eq("twin_listing_id", twin.listingId);
    throw new Error("A Channex não confirmou o calendário; o anúncio gêmeo não foi religado. Tente de novo em 1 minuto.");
  }

  // 4) Religa o anúncio gêmeo à sua unidade própria e republica.
  if (twin.ratePlanId !== unit.ratePlanId) {
    await cx(`/channels/${input.channelId}/mappings/${twin.mappingId}`, { method: "DELETE" });
    await sleep(40_000); // a Channex exige pausa entre remover e recriar o vínculo do Airbnb
    await cx(`/channels/${input.channelId}/mappings`, {
      method: "POST",
      body: JSON.stringify({ mapping: { rate_plan_id: unit.ratePlanId, settings: { listing_id: twin.listingId } } }),
    });
    await sleep(10_000);
    await cx(`/channels/${input.channelId}/execute/publish`, { method: "POST", body: JSON.stringify({ listing_id: twin.listingId }) }).catch(() => undefined);
  }

  // 5) Confirma o calendário unido com o anúncio já publicado.
  const post = await syncTwinPair(twin.listingId, input.userId ?? null).catch(() => ({ ok: false }));
  await db.from("channex_twin_links").update({ last_sync_at: new Date().toISOString(), last_error: post.ok ? null : "Reenvio do calendário pendente (nova tentativa automática)." }).eq("twin_listing_id", twin.listingId);
  return { alreadyLinked: false, twinPropertyId: unit.propertyId };
}

/** Pares unidos pelo sistema (para a tela de integrações). */
export async function listTwinLinks() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await (supabaseAdmin as any)
    .from("channex_twin_links")
    .select("twin_listing_id, primary_listing_id, primary_title, twin_title, status, last_sync_at, last_error")
    .eq("status", "active")
    .order("created_at");
  return (data ?? []) as Array<{ twin_listing_id: string; primary_listing_id: string; primary_title: string | null; twin_title: string | null; status: string; last_sync_at: string | null; last_error: string | null }>;
}
