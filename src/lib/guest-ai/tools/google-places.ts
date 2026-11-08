/**
 * Ferramenta `search_city_places` — busca estabelecimentos reais no Google Places (consulta em tempo real).
 *
 * - Busca por texto na cidade do imóvel, com viés de localização ao redor da porta do imóvel quando há
 *   coordenadas; até `PLACES_MAX_RESULTS` resultados; estabelecimentos fechados definitivamente ou
 *   temporariamente são descartados.
 * - Cada resultado já vem com a distância REAL de trajeto a partir do imóvel (mesma regra de
 *   `calculate_property_distance`: a pé até 1 km, acima de carro) e ordenado do mais próximo para o mais
 *   distante; sem rota confiável, `distancia_m` é `null` (a IA não fala em metros).
 * - Devolve: nome, endereço, categoria, nota e total de avaliações no Google, se está aberto agora,
 *   coordenadas e, fora do Airbnb, o link oficial do Google Maps. Nunca tempo de deslocamento.
 * - Não usa o Explorar do anfitrião (o Explorar é navegação do hóspede, não base da IA).
 */
import type { GuestTool, GuestToolContext, ToolResult } from "./contracts";
import { routesFromProperty, validPoint, type PropertyRoute } from "./google-routes";

export const PLACES_MAX_RESULTS = 5;
export const PLACES_BIAS_RADIUS_M = 8_000;
export const PLACE_CATEGORIES = ["gastronomia", "conveniencia", "saude", "lazer"] as const;
export type PlaceCategory = (typeof PLACE_CATEGORIES)[number];

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.rating",
  "places.userRatingCount",
  "places.currentOpeningHours.openNow",
  "places.location",
  "places.primaryTypeDisplayName",
  "places.googleMapsUri",
  "places.businessStatus",
].join(",");

export interface PlacesArgs {
  query: string;
  category: PlaceCategory | null;
  city: string | null;
  openNow: boolean;
}

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : null;
const str = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Link do Maps só de host oficial do Google. */
export function officialMapsUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:") return null;
    return /^(maps\.google\.com|www\.google\.com|google\.com|maps\.app\.goo\.gl)$/.test(u.hostname)
      ? u.toString()
      : null;
  } catch {
    return null;
  }
}

export interface ParsedPlace {
  name: string;
  address: string | null;
  category: string | null;
  rating: number | null;
  ratingsTotal: number | null;
  openNow: boolean | null;
  location: { lat: number; lng: number } | null;
  mapsUrl: string | null;
}

/** Lê a resposta do `places:searchText` (pura; nunca lança). */
export function parsePlaces(json: unknown): ParsedPlace[] {
  const list = obj(json)?.["places"];
  if (!Array.isArray(list)) return [];
  const out: ParsedPlace[] = [];
  for (const raw of list) {
    const p = obj(raw);
    if (!p) continue;
    const status = p["businessStatus"];
    if (status === "CLOSED_PERMANENTLY" || status === "CLOSED_TEMPORARILY") continue;
    const name = str(obj(p["displayName"])?.["text"], 120);
    if (!name) continue;
    const loc = obj(p["location"]);
    const location =
      loc && validPoint({ lat: Number(loc["latitude"]), lng: Number(loc["longitude"]) })
        ? { lat: Number(loc["latitude"]), lng: Number(loc["longitude"]) }
        : null;
    const open = obj(p["currentOpeningHours"])?.["openNow"];
    const rating = num(p["rating"]);
    const total = num(p["userRatingCount"]);
    out.push({
      name,
      address: str(p["formattedAddress"], 200),
      category: str(obj(p["primaryTypeDisplayName"])?.["text"], 60),
      rating: rating !== null && rating >= 0 && rating <= 5 ? rating : null,
      ratingsTotal: total !== null && total >= 0 ? Math.round(total) : null,
      openNow: typeof open === "boolean" ? open : null,
      location,
      mapsUrl: officialMapsUrl(p["googleMapsUri"]),
    });
    if (out.length >= PLACES_MAX_RESULTS) break;
  }
  return out;
}

/** Corpo do `places:searchText` (puro; exportado para teste). */
export function placesRequestBody(
  args: PlacesArgs,
  ctx: GuestToolContext,
): Record<string, unknown> {
  const city = args.city ?? ctx.city;
  const place = [city, ctx.region, ctx.country]
    .filter((x) => typeof x === "string" && x.trim())
    .join(", ");
  const body: Record<string, unknown> = {
    textQuery: place ? `${args.query} em ${place}` : args.query,
    languageCode: "pt-BR",
    maxResultCount: PLACES_MAX_RESULTS,
  };
  if (args.openNow) body["openNow"] = true;
  // viés ao redor do imóvel só quando a busca é na própria cidade do imóvel
  const sameCity =
    !args.city || !ctx.city || args.city.trim().toLowerCase() === ctx.city.trim().toLowerCase();
  if (ctx.origin && validPoint(ctx.origin) && sameCity) {
    body["locationBias"] = {
      circle: {
        center: { latitude: ctx.origin.lat, longitude: ctx.origin.lng },
        radius: PLACES_BIAS_RADIUS_M,
      },
    };
  }
  return body;
}

export const searchCityPlaces: GuestTool<PlacesArgs> = {
  spec: {
    name: "search_city_places",
    description:
      "Busca em tempo real, no Google Places, estabelecimentos reais na cidade do imóvel (restaurantes, mercados, farmácias, atrações, serviços). Cada resultado já traz nome, endereço, nota no Google, se está aberto agora e a distância REAL de trajeto a partir do imóvel, do mais próximo para o mais distante.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "O que o hóspede procura, em poucas palavras (ex.: 'pizzaria', 'farmácia 24 horas').",
        },
        category: {
          type: "string",
          enum: [...PLACE_CATEGORIES],
          description: "Categoria do pedido.",
        },
        city: {
          type: "string",
          description: "Cidade da busca. Omita para usar a cidade do imóvel.",
        },
        open_now: { type: "boolean", description: "true para só lugares abertos agora." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  parse(raw) {
    const r = obj(raw);
    if (!r) return null;
    const q = typeof r["query"] === "string" ? r["query"].replace(/\s+/g, " ").trim() : "";
    if (q.length < 2 || q.length > 120) return null;
    const cat = r["category"];
    if (
      cat !== undefined &&
      cat !== null &&
      !(PLACE_CATEGORIES as readonly unknown[]).includes(cat)
    )
      return null;
    const city = r["city"];
    if (
      city !== undefined &&
      city !== null &&
      (typeof city !== "string" || city.trim().length > 80)
    )
      return null;
    const open = r["open_now"];
    if (open !== undefined && open !== null && typeof open !== "boolean") return null;
    return {
      query: q,
      category: (cat as PlaceCategory | undefined) ?? null,
      city: typeof city === "string" && city.trim() ? city.trim() : null,
      openNow: open === true,
    };
  },
  async execute(args, ctx, deps): Promise<ToolResult> {
    if (!args.city && !ctx.city && !ctx.origin) return { ok: false, erro: "sem_origem" };
    const res = await deps.http("/places/v1/places:searchText", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-FieldMask": FIELD_MASK },
      body: JSON.stringify(placesRequestBody(args, ctx)),
      signal: deps.signal,
    });
    if (!res.ok) return { ok: false, erro: "indisponivel" };
    const places = parsePlaces(await res.json());
    if (places.length === 0) return { ok: false, erro: "sem_resultado" };

    // distância real de cada resultado; falha nas rotas não derruba a busca (distância fica null)
    let routes: Array<PropertyRoute | null> = places.map(() => null);
    const withLoc = places.map((p, i) => ({ p, i })).filter((x) => x.p.location);
    if (ctx.origin && validPoint(ctx.origin) && withLoc.length > 0) {
      try {
        const r = await routesFromProperty(
          ctx.origin,
          withLoc.map((x) => x.p.location!),
          deps.http,
          deps.signal,
        );
        withLoc.forEach((x, k) => (routes[x.i] = r[k] ?? null));
      } catch (e) {
        if (deps.signal.aborted) throw e;
        routes = places.map(() => null);
      }
    }

    const items = places
      .map((p, i) => ({ p, route: routes[i] }))
      .sort(
        (a, b) =>
          (a.route?.meters ?? Number.POSITIVE_INFINITY) -
          (b.route?.meters ?? Number.POSITIVE_INFINITY),
      )
      .map(({ p, route }) => ({
        nome: p.name,
        endereco: p.address,
        categoria: p.category,
        nota_google: p.rating,
        total_avaliacoes_google: p.ratingsTotal,
        aberto_agora: p.openNow,
        lat: p.location ? Number(p.location.lat.toFixed(5)) : null,
        lng: p.location ? Number(p.location.lng.toFixed(5)) : null,
        distancia_m: route?.meters ?? null,
        distancia_texto: route?.text ?? null,
        modalidade: route?.mode ?? null,
        ...(ctx.surface !== "airbnb" && p.mapsUrl ? { link_google_maps: p.mapsUrl } : {}),
      }));
    return { ok: true, busca: args.query, resultados: items };
  },
};
