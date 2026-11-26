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

/**
 * Diárias REAIS do calendário do anúncio (26/11/2026, caso Izabela): o preço que o hóspede vê, vindo do próprio
 * Airbnb (inclusive o definido por ferramenta de preço), por noite. Serve para a IA comparar imóveis parecidos no
 * portfólio; nunca é gravado. Somente GET. Formato desconhecido, sem token ou erro ⇒ `null` (nada é estimado).
 */
export async function fetchAirbnbNightlyPrices(
  channelId: string,
  listingId: string,
  start: string,
  end: string,
  timeoutMs = 4_000,
): Promise<Map<string, number> | null> {
  if (!channelId || !/^\d{5,}$/.test(listingId) || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return null;
  const token = await channelToken(channelId).catch(() => null);
  if (!token) return null;
  const id = encodeURIComponent(listingId);
  const paths = [
    `/calendars/${id}/${start}/${end}`,
    `/calendar_days?listing_id=${id}&start_date=${start}&end_date=${end}&_format=host_calendar_detailed`,
  ];
  for (const path of paths) {
    try {
      const res = await fetch(`${AIRBNB}${path}`, {
        headers: { "X-Airbnb-OAuth-Token": token, Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) continue;
      const prices = parseAirbnbCalendarPrices(await res.json());
      if (prices && prices.size) return prices;
    } catch {
      /* tenta o próximo formato */
    }
  }
  console.warn("[airbnb-host-api] diárias não lidas", listingId);
  return null;
}

const PRICE_KEYS = ["daily_price", "local_price", "native_price", "price", "amount", "nightly_price"] as const;

function priceOf(day: Record<string, unknown>): number | null {
  for (const k of PRICE_KEYS) {
    const v = day[k];
    if (typeof v === "number" && v > 0) return v;
    if (typeof v === "string" && Number(v) > 0) return Number(v);
    if (v && typeof v === "object") {
      const inner = priceOf(v as Record<string, unknown>);
      if (inner) return inner;
    }
  }
  return null;
}

/** Lê `{ calendar: { days: [...] } }`, `{ calendar_days: [...] }` ou `{ days: [...] }`; data em `date`/`day`. Pura. */
export function parseAirbnbCalendarPrices(raw: unknown): Map<string, number> | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const cal = (r["calendar"] && typeof r["calendar"] === "object" ? (r["calendar"] as Record<string, unknown>) : null) ?? null;
  const days = (cal?.["days"] ?? cal?.["calendar_days"] ?? r["calendar_days"] ?? r["days"]) as unknown;
  if (!Array.isArray(days)) return null;
  const out = new Map<string, number>();
  for (const d of days) {
    if (!d || typeof d !== "object") continue;
    const day = d as Record<string, unknown>;
    const date = typeof day["date"] === "string" ? day["date"] : typeof day["day"] === "string" ? day["day"] : null;
    const p = priceOf(day);
    if (date && /^\d{4}-\d{2}-\d{2}/.test(date) && p) out.set(date.slice(0, 10), p);
  }
  return out;
}
