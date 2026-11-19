/**
 * Leitura (somente GET) dos dados cadastrais do anúncio na API oficial do anfitrião
 * no Airbnb, com o token OAuth do canal conectado na Channex (lido ao vivo, nunca
 * gravado). Substitui a dependência do scraping público para endereço, coordenadas,
 * cômodos, fotos e tarefas de saída. Cada chamada falha sozinha sem derrubar as outras.
 */
import { getChannelCached } from "@/lib/channex-channel-cache.server";
import { parseHostListing, type HostListing } from "@/lib/airbnb-host-api";

const AIRBNB = "https://api.airbnb.com/v2";

/** Token OAuth do canal Airbnb, lido pelo cache de canais (regra de 24/10/2026: nada de `GET /channels/:id` ao vivo). */
async function channelToken(channelId: string): Promise<string | null> {
  const r = await getChannelCached(channelId);
  const a = r?.data?.attributes;
  if (a?.channel !== "AirBNB") return null;
  const s = a?.settings ?? {};
  if (s.token_invalid) return null;
  const t = s.tokens?.access_token;
  const exp = Number(s.tokens?.expires_at ?? 0);
  if (!t || (exp && exp * 1000 < Date.now() + 60_000)) return null;
  return String(t);
}

async function get(path: string, token: string): Promise<unknown> {
  const res = await fetch(`${AIRBNB}${path}`, {
    headers: { "X-Airbnb-OAuth-Token": token, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Airbnb ${res.status} ${path.split("?")[0]}`);
  return res.json();
}

export async function fetchAirbnbHostListingData(channelId: string, listingId: string): Promise<HostListing | null> {
  if (!channelId || !/^\d{5,}$/.test(listingId)) return null;
  const token = await channelToken(channelId).catch(() => null);
  if (!token) return null;
  const id = encodeURIComponent(listingId);
  const [listing, descriptions, rooms, photos] = await Promise.allSettled([
    get(`/listings/${id}?_format=v1_legacy_for_p3`, token),
    get(`/listing_descriptions?listing_id=${id}`, token),
    get(`/listing_rooms?listing_id=${id}`, token),
    get(`/listing_photos?listing_id=${id}`, token),
  ]);
  const val = (r: PromiseSettledResult<unknown>) => (r.status === "fulfilled" ? r.value : undefined);
  for (const r of [listing, descriptions, rooms, photos]) {
    if (r.status === "rejected") console.warn("[airbnb-host-api]", listingId, r.reason instanceof Error ? r.reason.message : r.reason);
  }
  return parseHostListing(listingId, { listing: val(listing), descriptions: val(descriptions), rooms: val(rooms), photos: val(photos) });
}
