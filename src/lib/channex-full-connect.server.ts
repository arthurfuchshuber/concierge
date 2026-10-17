/**
 * Conexão de anúncio no Modo Full (só conta piloto Sigma por enquanto).
 *
 * Um anúncio só fica "Conectado" no Airbnb quando é mapeado a um rate plan da Channex, e mapear
 * sem diárias faz o Airbnb travar o calendário. Por isso: (1) cria uma unidade PRÓPRIA na Channex
 * (property + room type + rate plan, liberada nas chaves da ferramenta de preços) sem mapear;
 * (2) o anfitrião importa o código na ferramenta de preços e clica "Já conectei";
 * (3) só com 30 dias de diárias confirmadas o anúncio é mapeado por `safeMapAirbnbListing`
 * (calendário real aberto antes do vínculo). "Mapeado" é sempre lido ao vivo do canal.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { SIGMA_ACCOUNT_ID } from "@/lib/sync-alert-accounts";

const B = "https://app.channex.io/api/v1";
async function cx<T = any>(path: string, init?: RequestInit): Promise<T> {
  const key = process.env["CHANNEX_API_KEY"] ?? process.env["CHANNEX_STAGING_API_KEY"];
  if (!key) throw new Error("Chave Channex ausente.");
  const res = await fetch(`${B}${path}`, {
    ...init,
    headers: { "user-api-key": key, "Content-Type": "application/json", Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Channex ${res.status}: ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : null) as T;
}

export const FULL_CONNECT_ACCOUNTS = new Set([SIGMA_ACCOUNT_ID]);

export type PendingFullConnection = {
  propertyId: string;
  propertyName: string;
  listingId: string;
  unitCode: string | null;
  error: string | null;
  /** Proprietário(a) vinculado e foto do imóvel (só exibição na janela "Finalize a ativação"). */
  ownerName: string | null;
  ownerPhone: string | null;
  ownerPhoneCountry: string | null;
  imageUrl: string | null;
};

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

/** Anúncios ativos da conta Full ainda não mapeados no canal (lido ao vivo na Channex). */
async function unmappedRows(ownerId: string) {
  const d = await db();
  const { data: mode } = await d.from("channex_account_settings").select("operation_mode").eq("owner_id", ownerId).maybeSingle();
  if (mode?.operation_mode !== "full") return [];
  const { data: rows } = await d
    .from("property_listing_raw_data")
    .select("property_id, airbnb_listing_id, channex_channel_id, channex_property_id, channex_room_type_id, channex_rate_plan_id, listing_meta, properties!inner(name, archived_at)")
    .eq("owner_id", ownerId)
    .is("sync_paused_at", null)
    .is("properties.archived_at", null)
    .not("airbnb_listing_id", "is", null)
    .not("channex_channel_id", "is", null);
  const list = (rows ?? []) as any[];
  const mapped = new Set<string>();
  for (const ch of new Set(list.map((r) => String(r.channex_channel_id)))) {
    const c = await cx<{ data: any }>(`/channels/${ch}`);
    for (const rp of c.data?.attributes?.rate_plans ?? []) mapped.add(String(rp.settings?.listing_id));
  }
  return list.filter((r) => !mapped.has(String(r.airbnb_listing_id)));
}

/** Cria a unidade própria na Channex (sem mapear e sem enviar nada ao Airbnb). Idempotente. */
async function ensureUnit(r: any): Promise<string> {
  if (r.channex_room_type_id && r.channex_rate_plan_id && r.channex_property_id) return r.channex_property_id;
  const d = await db();
  const fallback = String(r.properties?.name ?? "Imóvel");
  const raw = String(r.listing_meta?.title ?? r.listing_meta?.name ?? fallback);
  // Mesma regra de nomes da sincronização: unidade exclusiva → propriedade = nome interno, quarto = título público.
  const { namingFor, listingTitle } = await import("@/lib/channex-entity-sync.server");
  const naming = namingFor(raw, true);
  const name = String(naming.property ?? fallback).slice(0, 200);
  const title = String(naming.property ? naming.room : listingTitle(raw) || fallback).slice(0, 200);
  const prop = await cx<{ data: { id: string } }>("/properties", {
    method: "POST",
    body: JSON.stringify({ property: { title: name, currency: "BRL", country: "BR", timezone: "America/Sao_Paulo", property_type: "guest_house" } }),
  });
  const rt = await cx<{ data: { id: string } }>("/room_types", {
    method: "POST",
    body: JSON.stringify({ room_type: { property_id: prop.data.id, title, count_of_rooms: 1, occ_adults: 2, occ_children: 0, occ_infants: 0, default_occupancy: 2 } }),
  });
  const rp = await cx<{ data: { id: string } }>("/rate_plans", {
    method: "POST",
    body: JSON.stringify({ rate_plan: { title, property_id: prop.data.id, room_type_id: rt.data.id, currency: "BRL", sell_mode: "per_room", rate_mode: "manual", options: [{ occupancy: 2, is_primary: true, rate: 0 }] } }),
  });
  const ch = (await cx<{ data: any }>(`/channels/${r.channex_channel_id}`)).data?.attributes ?? {};
  const props: string[] = ch.properties ?? [];
  if (!props.includes(prop.data.id)) {
    await cx(`/channels/${r.channex_channel_id}`, { method: "PUT", body: JSON.stringify({ channel: { properties: [...props, prop.data.id] } }) });
  }
  const { grantPriceLabsAccess } = await import("@/lib/channex-twins.server");
  await grantPriceLabsAccess(prop.data.id).catch((e) => console.error("[full-connect] pricing key", e));
  const { error } = await d
    .from("property_listing_raw_data")
    .update({ channex_property_id: prop.data.id, channex_room_type_id: rt.data.id, channex_rate_plan_id: rp.data.id })
    .eq("property_id", r.property_id);
  if (error) throw new Error(error.message);
  // Calendário real + tarifa base já na criação, para a ferramenta de preços sincronizar de primeira.
  await seedUnitCalendar(r.property_id).catch((e) => console.error("[full-connect] seed", e));
  return prop.data.id;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Noites fechadas no calendário REAL do Airbnb (reservas + bloqueios manuais), lidas do iCal oficial. */
export async function airbnbClosedNights(icalUrl: string | null | undefined): Promise<Set<string> | null> {
  const url = String(icalUrl ?? "").trim();
  if (!url) return null;
  const { isAllowedIcalUrl } = await import("@/lib/airbnb-ical-url");
  if (!isAllowedIcalUrl(url)) return null;
  const res = await fetch(url, { headers: { Accept: "text/calendar" } });
  if (!res.ok) throw new Error(`iCal ${res.status}`);
  const text = (await res.text()).replace(/\r?\n[ \t]/g, "");
  const nights = new Set<string>();
  for (const ev of text.split("BEGIN:VEVENT").slice(1)) {
    const s = /DTSTART[^:]*:(\d{8})/.exec(ev)?.[1];
    const e = /DTEND[^:]*:(\d{8})/.exec(ev)?.[1];
    if (!s || !e) continue;
    const f = (x: string) => `${x.slice(0, 4)}-${x.slice(4, 6)}-${x.slice(6, 8)}`;
    const end = f(e);
    for (let d = new Date(`${f(s)}T00:00:00Z`); isoDay(d) < end; d = new Date(d.getTime() + 86_400_000)) nights.add(isoDay(d));
  }
  return nights;
}

export const SEED_BASE_RATE = 100;

/** Janela de reservas configurada NO ANÚNCIO (max_days_notice), lida ao vivo do canal. */
export async function listingWindowDays(channelId: string | null | undefined, listingId: string | null | undefined, fallback = 270): Promise<number> {
  if (!channelId || !listingId) return fallback;
  const c = await cx<{ data: any }>(`/channels/${channelId}`).catch(() => null);
  const rp = (c?.data?.attributes?.rate_plans ?? []).find((x: any) => String(x.settings?.listing_id) === String(listingId));
  const n = Number(rp?.settings?.availability_rule?.max_days_notice);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 730) : fallback;
}

/**
 * Carga inicial da unidade ainda NÃO mapeada: espelha o calendário real do Airbnb (fechado = 0,
 * livre = 1 até a janela de reservas do anúncio) e, se a unidade ainda não tem nenhuma diária, uma tarifa base para a
 * ferramenta de preços ter ponto de partida. Seguro: sem mapeamento, nada chega ao Airbnb.
 */
export async function seedUnitCalendar(propertyId: string, userId: string | null = null) {
  const d = await db();
  const { data: r } = await d
    .from("property_listing_raw_data")
    .select("channex_property_id, channex_room_type_id, channex_rate_plan_id, channex_channel_id, airbnb_listing_id, owner_id, properties(airbnb_ical_url)")
    .eq("property_id", propertyId)
    .maybeSingle();
  if (!r?.channex_property_id || !r.channex_room_type_id || !r.channex_rate_plan_id) return { ok: false, reason: "no_unit" };
  const closed = await airbnbClosedNights(r.properties?.airbnb_ical_url);
  if (!closed) return { ok: false, reason: "no_ical" };
  const { applyCalendarChanges, flushAriOutbox } = await import("@/lib/channex-ari.server");
  const base = { propertyId: r.channex_property_id, roomTypeId: r.channex_room_type_id, ratePlanId: r.channex_rate_plan_id };
  const changes: any[] = [];
  const now = Date.now();
  // Horizonte = janela de reservas do próprio anúncio (não um número fixo).
  const windowDays = await listingWindowDays(r.channex_channel_id, r.airbnb_listing_id);
  for (let i = 0; i <= Math.max(365, windowDays); i++) {
    const date = isoDay(new Date(now + i * 86_400_000));
    const availability = i > windowDays || closed.has(date) ? 0 : 1;
    const prev = changes[changes.length - 1];
    if (prev && prev.fields.availability === availability) prev.dateTo = date;
    else changes.push({ ...base, dateFrom: date, dateTo: date, fields: { availability } });
  }
  const start = isoDay(new Date(now));
  const end = isoDay(new Date(now + 29 * 86_400_000));
  const cur = await cx<{ data: Record<string, Record<string, { rate?: string | number }>> }>(
    `/restrictions?filter[property_id]=${r.channex_property_id}&filter[date][gte]=${start}&filter[date][lte]=${end}&filter[restrictions]=rate`,
  ).catch(() => null);
  const seedRate = !!cur && pricedDays(cur.data?.[r.channex_rate_plan_id]) === 0;
  if (seedRate) changes.push({ ...base, dateFrom: start, dateTo: isoDay(new Date(now + windowDays * 86_400_000)), fields: { rate: SEED_BASE_RATE } });
  await applyCalendarChanges(changes, userId, "full_connect_seed");
  const flushed = await flushAriOutbox();
  return { ok: flushed.batches.every((b: any) => b.ok), closedNights: closed.size, seedRate };
}

/**
 * O anúncio já está mapeado no canal (manda reservas pela API)? `false` só quando a conta é Full e a
 * Channex confirma que o anúncio NÃO está mapeado; qualquer dúvida ou conta Light => `null`.
 */
export async function isMappedOnChannel(propertyId: string): Promise<boolean | null> {
  try {
    const d = await db();
    const { data: r } = await d
      .from("property_listing_raw_data")
      .select("owner_id, airbnb_listing_id, channex_channel_id")
      .eq("property_id", propertyId)
      .maybeSingle();
    if (!r?.airbnb_listing_id || !r.channex_channel_id) return null;
    const { data: mode } = await d.from("channex_account_settings").select("operation_mode").eq("owner_id", r.owner_id).maybeSingle();
    if (mode?.operation_mode !== "full") return null;
    const c = await cx<{ data: any }>(`/channels/${r.channex_channel_id}`);
    return (c.data?.attributes?.rate_plans ?? []).some((rp: any) => String(rp.settings?.listing_id) === String(r.airbnb_listing_id));
  } catch {
    return null;
  }
}

/**
 * Blindagem para qualquer vínculo (De → Para, importação, troca de imóvel): se a unidade própria
 * ainda NÃO está mapeada no Airbnb, garante a carga inicial (calendário real + tarifa base se não
 * houver diárias), para a ferramenta de preços nunca encontrar a unidade zerada. Mapeada → nada.
 */
export async function seedIfUnmapped(propertyId: string) {
  const d = await db();
  const { data: r } = await d
    .from("property_listing_raw_data")
    .select("airbnb_listing_id, channex_channel_id, channex_rate_plan_id")
    .eq("property_id", propertyId)
    .maybeSingle();
  if (!r?.channex_rate_plan_id || !r.airbnb_listing_id) return { ok: false, reason: "no_unit" };
  if (r.channex_channel_id) {
    const c = await cx<{ data: any }>(`/channels/${r.channex_channel_id}`);
    const mapped = (c.data?.attributes?.rate_plans ?? []).some(
      (rp: any) => String(rp.settings?.listing_id) === String(r.airbnb_listing_id),
    );
    if (mapped) return { ok: true, reason: "mapped" };
  }
  return seedUnitCalendar(propertyId);
}


export async function listPendingFullConnections(ownerId: string): Promise<PendingFullConnection[]> {
  if (!FULL_CONNECT_ACCOUNTS.has(ownerId)) return [];
  const out: PendingFullConnection[] = [];
  const rows = await unmappedRows(ownerId);
  const extra = new Map<string, Pick<PendingFullConnection, "ownerName" | "ownerPhone" | "ownerPhoneCountry" | "imageUrl">>();
  try {
    const d = await db();
    const ids = rows.map((r: any) => r.property_id).filter(Boolean);
    if (ids.length) {
      const { data: props } = await d.from("properties").select("id, owner_contact_id, hero_image_url, gallery_images").in("id", ids);
      const oids = [...new Set(((props ?? []) as any[]).map((p) => p.owner_contact_id).filter(Boolean))];
      const { data: owners } = oids.length
        ? await d.from("property_owners").select("id, name, trade_name, phone, phone_country").in("id", oids)
        : { data: [] };
      const byId = new Map(((owners ?? []) as any[]).map((o) => [o.id, o]));
      for (const p of (props ?? []) as any[]) {
        const o = p.owner_contact_id ? byId.get(p.owner_contact_id) : undefined;
        extra.set(p.id, {
          ownerName: o ? String(o.trade_name || o.name || "") || null : null,
          ownerPhone: o?.phone ?? null,
          ownerPhoneCountry: o?.phone_country ?? null,
          imageUrl: p.hero_image_url || (p.gallery_images ?? [])[0] || null,
        });
      }
    }
  } catch (e) {
    console.error("[full-connect] extras", e);
  }
  for (const r of rows) {
    let unitCode: string | null = null;
    let error: string | null = null;
    try {
      unitCode = await ensureUnit(r);
    } catch (e) {
      console.error("[full-connect] unit", e);
      error = "Não foi possível preparar a unidade agora. Tente novamente em instantes.";
    }
    out.push({ propertyId: r.property_id, propertyName: r.properties?.name ?? "Imóvel", listingId: String(r.airbnb_listing_id), unitCode, error, ...(extra.get(r.property_id) ?? { ownerName: null, ownerPhone: null, ownerPhoneCountry: null, imageUrl: null }) });
  }
  return out;
}

/** Unidades Channex da conta (anúncios + gêmeos ativos). */
async function accountUnits(ownerId: string): Promise<string[]> {
  const d = await db();
  const { data: rows } = await d.from("property_listing_raw_data").select("property_id, channex_property_id").eq("owner_id", ownerId);
  const ids = new Set<string>();
  const propIds: string[] = [];
  for (const r of (rows ?? []) as any[]) {
    if (r.channex_property_id) ids.add(String(r.channex_property_id));
    if (r.property_id) propIds.push(r.property_id);
  }
  if (propIds.length) {
    const { data: twins } = await d.from("channex_twin_links").select("*").in("property_id", propIds).eq("status", "active");
    for (const t of (twins ?? []) as any[]) {
      for (const k of ["twin_channex_property_id", "channex_property_id", "primary_channex_property_id"]) if (t[k]) ids.add(String(t[k]));
    }
  }
  return [...ids];
}

/**
 * Chave de API COMPLETA da Channex, exclusiva da conta e restrita às unidades dela, aceita por
 * qualquer ferramenta de precificação integrada à Channex. Só a chave inteira é guardada
 * (tabela sem acesso pelo app) e é devolvida apenas ao usuário autorizado da conta.
 */
export async function ensureAccountPricingKey(ownerId: string): Promise<string | null> {
  if (!FULL_CONNECT_ACCOUNTS.has(ownerId)) return null;
  const d = await db();
  const units = await accountUnits(ownerId);
  if (!units.length) return null;
  const { data: row } = await d.from("channex_pricing_keys").select("channex_key_id, api_key").eq("owner_id", ownerId).maybeSingle();
  if (row) {
    const cur = await cx<{ data: any }>(`/api_keys/${row.channex_key_id}`).catch(() => null);
    const a = cur?.data?.attributes;
    if (a && !a.is_withdrawn) {
      const have: string[] = a.property_policy?.properties ?? [];
      if (units.some((u) => !have.includes(u))) {
        await cx(`/api_keys/${row.channex_key_id}`, {
          method: "PUT",
          body: JSON.stringify({ api_key: { property_policy: { mode: "selected", properties: [...new Set([...have, ...units])] } } }),
        });
      }
      return row.api_key;
    }
  }
  const created = await cx<{ data: { id: string; attributes: { key: string } } }>("/api_keys", {
    method: "POST",
    body: JSON.stringify({
      api_key: { title: `Precificação ConciergeIA ${ownerId.slice(0, 8)}`, property_policy: { mode: "selected", properties: units }, network_policy: { mode: "allow_all" } },
    }),
  });
  const key = created.data.attributes.key;
  const { error } = await d
    .from("channex_pricing_keys")
    .upsert({ owner_id: ownerId, channex_key_id: created.data.id, api_key: key, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  return key;
}

/** Dias com diária > 0 nos próximos 30 dias da unidade. */
export function pricedDays(days: Record<string, { rate?: string | number }> | undefined) {
  return Object.values(days ?? {}).filter((x) => Number(x?.rate ?? 0) > 0).length;
}

/** Dias com diária vinda da ferramenta de preços (ignora a tarifa base interna de carga inicial). */
export function toolPricedDays(days: Record<string, { rate?: string | number }> | undefined) {
  return Object.values(days ?? {}).filter((x) => {
    const r = Number(x?.rate ?? 0);
    return r > 0 && r !== SEED_BASE_RATE;
  }).length;
}

export async function confirmFullConnection(ownerId: string, propertyId: string, userId: string) {
  if (!FULL_CONNECT_ACCOUNTS.has(ownerId)) throw new Error("Recurso indisponível para esta conta.");
  const r = (await unmappedRows(ownerId)).find((x) => x.property_id === propertyId);
  if (!r) return { ok: true as const, already: true };
  await ensureUnit(r);
  const d = await db();
  const { data: fresh } = await d
    .from("property_listing_raw_data")
    .select("channex_property_id, channex_room_type_id, channex_rate_plan_id")
    .eq("property_id", propertyId)
    .single();
  const start = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + 29 * 86_400_000).toISOString().slice(0, 10);
  const res = await cx<{ data: Record<string, Record<string, { rate?: string | number }>> }>(
    `/restrictions?filter[property_id]=${fresh.channex_property_id}&filter[date][gte]=${start}&filter[date][lte]=${end}&filter[restrictions]=rate`,
  ).catch(() => ({ data: {} as Record<string, Record<string, { rate?: string | number }>> }));
  if (toolPricedDays(res.data?.[fresh.channex_rate_plan_id]) < 30) return { ok: false as const, reason: "no_rates" as const };
  // Regra do anfitrião: preço só vai ao Airbnb depois de definido pela ferramenta de pricing.
  // Se sobrou QUALQUER dia da janela do anúncio ainda com a tarifa-semente, não mapeia (senão a
  // semente viraria preço real e sobrescreveria o original do calendário).
  const windowDays = await listingWindowDays(String(r.channex_channel_id), String(r.airbnb_listing_id));
  for (let from = 0; from <= windowDays; from += 180) {
    const a = new Date(Date.now() + from * 86_400_000).toISOString().slice(0, 10);
    const b = new Date(Date.now() + Math.min(from + 179, windowDays) * 86_400_000).toISOString().slice(0, 10);
    const chunk = await cx<{ data: Record<string, Record<string, { rate?: string | number }>> }>(
      `/restrictions?filter[property_id]=${fresh.channex_property_id}&filter[date][gte]=${a}&filter[date][lte]=${b}&filter[restrictions]=rate`,
    ).catch(() => null);
    if (!chunk) return { ok: false as const, reason: "no_rates" as const };
    if (Object.values(chunk.data?.[fresh.channex_rate_plan_id] ?? {}).some((x) => Number(x?.rate ?? 0) === SEED_BASE_RATE)) {
      return { ok: false as const, reason: "no_rates" as const };
    }
  }
  const { safeMapAirbnbListing } = await import("@/lib/channex-mapping.server");
  await safeMapAirbnbListing(
    {
      channelId: String(r.channex_channel_id),
      listingId: String(r.airbnb_listing_id),
      channexPropertyId: fresh.channex_property_id,
      roomTypeId: fresh.channex_room_type_id,
      ratePlanId: fresh.channex_rate_plan_id,
      propertyId,
    },
    userId,
  );
  return { ok: true as const, already: false };
}
