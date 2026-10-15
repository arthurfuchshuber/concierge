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
  const name = String(r.properties?.name ?? "Imóvel").slice(0, 200);
  const title = String(r.listing_meta?.title ?? r.listing_meta?.name ?? name).slice(0, 200);
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
  return prop.data.id;
}

export async function listPendingFullConnections(ownerId: string): Promise<PendingFullConnection[]> {
  if (!FULL_CONNECT_ACCOUNTS.has(ownerId)) return [];
  const out: PendingFullConnection[] = [];
  for (const r of await unmappedRows(ownerId)) {
    let unitCode: string | null = null;
    let error: string | null = null;
    try {
      unitCode = await ensureUnit(r);
    } catch (e) {
      console.error("[full-connect] unit", e);
      error = "Não foi possível preparar a unidade agora. Tente novamente em instantes.";
    }
    out.push({ propertyId: r.property_id, propertyName: r.properties?.name ?? "Imóvel", listingId: String(r.airbnb_listing_id), unitCode, error });
  }
  return out;
}

/** Dias com diária > 0 nos próximos 30 dias da unidade. */
export function pricedDays(days: Record<string, { rate?: string | number }> | undefined) {
  return Object.values(days ?? {}).filter((x) => Number(x?.rate ?? 0) > 0).length;
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
  if (pricedDays(res.data?.[fresh.channex_rate_plan_id]) < 30) return { ok: false as const, reason: "no_rates" as const };
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
