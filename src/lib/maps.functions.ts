import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const GATEWAY = "https://connector-gateway.lovable.dev/google_maps";

const ALLOWED_MAPS_HOSTS = new Set([
  "maps.app.goo.gl",
  "goo.gl",
  "www.google.com",
  "google.com",
  "maps.google.com",
  "www.google.com.br",
  "google.com.br",
  "maps.google.com.br",
]);

const InputSchema = z.object({
  mapsUrl: z
    .string()
    .url()
    .max(2048)
    .refine(
      (s) => {
        try {
          const u = new URL(s);
          if (u.protocol !== "https:" && u.protocol !== "http:") return false;
          return ALLOWED_MAPS_HOSTS.has(u.hostname.toLowerCase());
        } catch {
          return false;
        }
      },
      { message: "URL precisa ser um link do Google Maps." },
    ),
});

type PlaceItem = {
  place_id: string;
  name: string;
  rating: number | null;
  user_ratings_total: number | null;
  category: string;
  type: string;
  scope: "nearby" | "city";
  lat: number;
  lng: number;
  distance_meters: number;
  distance_text: string;
  drive_minutes: number | null;
  walk_minutes: number | null;
  opening_hours: string[] | null;
  image_url: string | null;
  maps_url: string | null;
  note: string | null;
};


type EnrichResult = {
  address: string;
  lat: number;
  lng: number;
  city: string;
  country: string;
  tagline: string;
  hero_image_url: string | null;
  gallery_images: string[];
  recommendations: PlaceItem[];
};

// `placesTypes` é o filtro enviado ao Places (includedTypes/includedType).
// `acceptedPrimaryTypes` é o que validamos no resultado — Google às vezes devolve
// estabelecimentos cujo primaryType não bate (ex.: salão de beleza retornado em "bar").
// Só aceitamos o item se o primaryType estiver na lista permitida.
const TYPE_MAP: {
  type: PlaceItem["type"];
  placesTypes: string[];
  acceptedPrimaryTypes: string[];
  category: string;
}[] = [
  { type: "restaurant", placesTypes: ["restaurant"], acceptedPrimaryTypes: ["restaurant", "pizza_restaurant", "italian_restaurant", "brazilian_restaurant", "steak_house", "seafood_restaurant", "japanese_restaurant", "sushi_restaurant", "mexican_restaurant", "fast_food_restaurant", "hamburger_restaurant", "barbecue_restaurant", "vegetarian_restaurant", "vegan_restaurant", "meal_takeaway", "meal_delivery"], category: "Restaurantes" },
  { type: "bar", placesTypes: ["bar"], acceptedPrimaryTypes: ["bar", "pub", "wine_bar", "sports_bar", "bar_and_grill", "night_club"], category: "Bares" },
  { type: "cafe", placesTypes: ["cafe", "coffee_shop"], acceptedPrimaryTypes: ["cafe", "coffee_shop", "bakery", "tea_house", "dessert_shop", "ice_cream_shop"], category: "Cafés" },
  { type: "beach", placesTypes: ["beach"], acceptedPrimaryTypes: ["beach"], category: "Praias" },
  { type: "attraction", placesTypes: ["tourist_attraction"], acceptedPrimaryTypes: ["tourist_attraction", "museum", "art_gallery", "amusement_park", "aquarium", "zoo", "historical_landmark", "monument", "cultural_center", "national_park"], category: "Atrações" },
  { type: "market", placesTypes: ["supermarket", "grocery_store"], acceptedPrimaryTypes: ["supermarket", "grocery_store", "convenience_store", "food_store"], category: "Mercados" },
  { type: "pharmacy", placesTypes: ["pharmacy"], acceptedPrimaryTypes: ["pharmacy", "drugstore"], category: "Farmácias" },
  { type: "park", placesTypes: ["park"], acceptedPrimaryTypes: ["park", "national_park", "state_park"], category: "Parques" },
  { type: "nightlife", placesTypes: ["night_club"], acceptedPrimaryTypes: ["night_club", "bar", "pub"], category: "Vida noturna" },
  { type: "shopping", placesTypes: ["shopping_mall"], acceptedPrimaryTypes: ["shopping_mall", "department_store"], category: "Compras" },
];


function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const toRad = (n: number) => (n * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

function formatDistance(meters: number): { text: string; driveMin: number | null; walkMin: number } {
  // 80 m/min ≈ 4.8 km/h — caminhada conservadora.
  const walkMin = Math.max(1, Math.round(meters / 80));
  if (meters < 1000) return { text: `${meters} m · ${walkMin} min a pé`, driveMin: null, walkMin };
  const km = meters / 1000;
  if (meters <= 1500) return { text: `${km.toFixed(1)} km · ${walkMin} min a pé`, driveMin: null, walkMin };
  // ~40 km/h average urban speed
  const driveMin = Math.max(2, Math.round((km / 40) * 60));
  return { text: `${km.toFixed(1)} km · ${driveMin} min de carro`, driveMin, walkMin };
}


async function resolveShortUrl(url: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.protocol !== "https:") return url;
  const host = parsed.hostname.toLowerCase();
  // Só seguimos redirecionamento para hosts de short-link conhecidos do Google.
  if (host !== "maps.app.goo.gl" && host !== "goo.gl") return url;
  try {
    const res = await fetch(parsed.toString(), { method: "GET", redirect: "follow" });
    // Valida que o destino final ainda é um host permitido (evita open redirect / SSRF).
    try {
      const finalHost = new URL(res.url).hostname.toLowerCase();
      if (!ALLOWED_MAPS_HOSTS.has(finalHost)) return url;
    } catch {
      return url;
    }
    return res.url || url;
  } catch {
    return url;
  }
}

function extractCoords(url: string): { lat: number; lng: number } | null {
  // Prefer !3d!4d (actual place coords) over @ (viewport center, often shifted).
  const bang = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (bang) return { lat: parseFloat(bang[1]), lng: parseFloat(bang[2]) };
  const q = url.match(/[?&]q=(-?\d+\.\d+)[%2C,](-?\d+\.\d+)/);
  if (q) return { lat: parseFloat(q[1]), lng: parseFloat(q[2]) };
  const at = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (at) return { lat: parseFloat(at[1]), lng: parseFloat(at[2]) };
  return null;
}

async function gatewayFetch(path: string, init: RequestInit = {}) {
  const apiKey = process.env.LOVABLE_API_KEY;
  const mapsKey = process.env.GOOGLE_MAPS_API_KEY_2 ?? process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey || !mapsKey) throw new Error("Google Maps connector não configurado.");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${apiKey}`);
  headers.set("X-Connection-Api-Key", mapsKey);
  return fetch(`${GATEWAY}${path}`, { ...init, headers });
}

async function geocodeText(text: string) {
  const res = await gatewayFetch(`/maps/api/geocode/json?address=${encodeURIComponent(text)}`);
  if (!res.ok) return null;
  const j = (await res.json()) as { results?: Array<{ geometry?: { location?: { lat: number; lng: number } }; formatted_address?: string; address_components?: Array<{ types: string[]; long_name: string }> }> };
  return j.results?.[0] ?? null;
}

async function reverseGeocode(lat: number, lng: number) {
  const res = await gatewayFetch(`/maps/api/geocode/json?latlng=${lat},${lng}`);
  if (!res.ok) return null;
  const j = (await res.json()) as { results?: Array<{ formatted_address?: string; address_components?: Array<{ types: string[]; long_name: string }> }> };
  return j.results?.[0] ?? null;
}

function extractCityCountry(comps: Array<{ types: string[]; long_name: string }> | undefined) {
  let city = "";
  let country = "";
  for (const c of comps ?? []) {
    if (c.types.includes("locality") || c.types.includes("administrative_area_level_2")) {
      city ||= c.long_name;
    }
    if (c.types.includes("country")) country = c.long_name;
  }
  return { city, country };
}

const PLACE_FIELD_MASK =
  "places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.googleMapsUri,places.photos.name,places.photos.widthPx,places.photos.heightPx,places.primaryType,places.editorialSummary,places.generativeSummary,places.regularOpeningHours";

async function placesNearby(lat: number, lng: number, includedTypes: string[]) {
  const res = await gatewayFetch(`/places/v1/places:searchNearby`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-FieldMask": PLACE_FIELD_MASK,
    },
    body: JSON.stringify({
      includedTypes,
      maxResultCount: 20,
      rankPreference: "POPULARITY",
      locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: 3000 } },
    }),
  });
  if (!res.ok) return [];
  const j = (await res.json()) as { places?: PlaceRaw[] };
  return j.places ?? [];
}

async function placesText(
  query: string,
  lat: number,
  lng: number,
  includedType?: string,
  radiusMeters = 30000,
) {
  const body: Record<string, unknown> = {
    textQuery: query,
    maxResultCount: 20,
    // locationBias (não restriction) — permite marcos famosos um pouco fora do raio
    // (Cataratas/Itaipu em Foz ficam a 20-25km do centro), mas mantém viés geográfico.
    locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: radiusMeters } },
  };
  if (includedType) body.includedType = includedType;
  const res = await gatewayFetch(`/places/v1/places:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.googleMapsUri,places.photos,places.primaryType,places.editorialSummary,places.generativeSummary,places.regularOpeningHours",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return [];
  const j = (await res.json()) as { places?: PlaceRaw[] };
  return j.places ?? [];
}

async function findPropertyPlace(lat: number, lng: number, hint: string) {
  const res = await gatewayFetch(`/places/v1/places:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.editorialSummary,places.generativeSummary,places.photos,places.location",
    },
    body: JSON.stringify({
      textQuery: hint,
      maxResultCount: 1,
      locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 200 } },
    }),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as {
    places?: Array<{
      id: string;
      displayName?: { text?: string };
      formattedAddress?: string;
      editorialSummary?: { text?: string };
      generativeSummary?: { overview?: { text?: string } };
      photos?: Array<{ name: string }>;
      location?: { latitude: number; longitude: number };
    }>;
  };
  return j.places?.[0] ?? null;
}

type PlaceRaw = {
  id: string;
  displayName?: { text?: string };
  location?: { latitude: number; longitude: number };
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  photos?: Array<{ name: string }>;
  primaryType?: string;
  editorialSummary?: { text?: string };
  generativeSummary?: { overview?: { text?: string } };
  regularOpeningHours?: { weekdayDescriptions?: string[] };
};



function buildPhotoUrl(photoName: string | undefined): string | null {
  if (!photoName) return null;
  // Servimos via proxy server-side (/api/public/place-photo) que usa o
  // gateway do Google Maps. Não depende de chave de browser nem de restrição
  // de referrer — funciona em domínios custom e em iframes do preview.
  return `/api/public/place-photo?name=${encodeURIComponent(photoName)}&w=1600`;
}

// Curadoria via Gemini: lista os lugares mais famosos/queridos da cidade por categoria.
// Retorna { restaurant: [...], bar: [...], ... }. Em caso de erro, retorna {}.
async function fetchIconicPlacesFromGemini(
  city: string,
  country: string,
): Promise<Record<string, string[]>> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey || !city) return {};

  const categoriesPrompt = TYPE_MAP.map((c) => `- ${c.type}: ${c.category}`).join("\n");
  const prompt = `Você é um concierge local com profundo conhecimento de ${city}${country ? `, ${country}` : ""}. Sua missão é montar uma curadoria EXAUSTIVA e MINUCIOSA dos lugares de relevância local em cada categoria abaixo.

REGRAS CRÍTICAS:
1. Inclua TODOS os estabelecimentos icônicos da cidade, mesmo que tenham poucas avaliações no Google. Pense: "se um morador local recomendasse, indicaria este lugar?"
2. Para "attraction" (pontos turísticos), seja AINDA MAIS abrangente: inclua passeios icônicos (sobrevoos de helicóptero como Helisul/FlyFoz, safáris, tours de barco), marcos urbanos famosos (avenidas, praças, gramadões, mirantes), monumentos, museus, parques temáticos, e qualquer experiência turística clássica da cidade — SEM exceção.
3. Para restaurantes/bares/cafés/padarias/confeitarias: inclua os clássicos locais que "todo mundo da cidade conhece" (churrascarias tradicionais, chopperias famosas, confeitarias históricas, padarias renomadas, redes locais consagradas).
4. Para market/shopping/pharmacy: inclua redes nacionais grandes presentes na cidade E redes/lojas locais relevantes.
5. Use o nome EXATO como aparece no Google Maps (incluindo "Restaurante", "Bar", "Cafeteria" no nome se for assim que o estabelecimento se chama).
6. Não invente lugares. Se não tiver certeza, omita.

Categorias:
${categoriesPrompt}

Para cada categoria, retorne entre 15 e 30 nomes (quanto mais completo, melhor — desde que sejam realmente relevantes localmente). Para "attraction" especificamente, retorne até 40 nomes incluindo TODAS as experiências turísticas da cidade.

Responda APENAS com JSON válido (sem markdown) no formato:
{"restaurant": ["Nome 1", "Nome 2"], "bar": [...], "cafe": [...], "beach": [...], "attraction": [...], "market": [...], "pharmacy": [...], "park": [...], "nightlife": [...], "shopping": [...]}`;

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "Você é um concierge local que conhece em profundidade as cidades brasileiras. Responda sempre com JSON válido, sem markdown." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) return {};
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = j.choices?.[0]?.message?.content ?? "";
    const cleaned = content.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const out: Record<string, string[]> = {};
    for (const cat of TYPE_MAP) {
      const arr = parsed[cat.type];
      if (Array.isArray(arr)) {
        const limit = cat.type === "attraction" ? 40 : 30;
        out[cat.type] = arr.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, limit);
      }
    }
    return out;
  } catch {
    return {};
  }
}

// ----- Busca manual de lugares (autocomplete no admin) ---------------------
const SearchInputSchema = z.object({
  query: z.string().min(2).max(120),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
});

function inferCategoryFromPrimaryType(primaryType: string | undefined) {
  if (primaryType) {
    for (const cat of TYPE_MAP) {
      if (cat.acceptedPrimaryTypes.includes(primaryType) || cat.placesTypes.includes(primaryType)) {
        return cat;
      }
    }
  }
  return { type: "other", placesTypes: [], acceptedPrimaryTypes: [], category: "Outros" } as typeof TYPE_MAP[number];
}

export type PlaceSearchResult = Omit<PlaceItem, "scope"> & { formatted_address: string | null };

export const searchPlacesForRec = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SearchInputSchema.parse(input))
  .handler(async ({ data }): Promise<PlaceSearchResult[]> => {
    const hasCoords = typeof data.lat === "number" && typeof data.lng === "number";
    const lat = hasCoords ? (data.lat as number) : 0;
    const lng = hasCoords ? (data.lng as number) : 0;

    const body: Record<string, unknown> = {
      textQuery: data.query,
      maxResultCount: 8,
    };
    if (hasCoords) {
      body.locationBias = { circle: { center: { latitude: lat, longitude: lng }, radius: 50000 } };
    }
    const res = await gatewayFetch(`/places/v1/places:searchText`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.googleMapsUri,places.photos,places.primaryType,places.editorialSummary,places.generativeSummary,places.regularOpeningHours",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return [];
    const j = (await res.json()) as { places?: (PlaceRaw & { formattedAddress?: string })[] };
    const places = j.places ?? [];

    return places
      .filter((p) => p.id && p.location)
      .slice(0, 8)
      .map((p) => {
        const cat = inferCategoryFromPrimaryType(p.primaryType);
        const dist = hasCoords
          ? haversineMeters({ lat, lng }, { lat: p.location!.latitude, lng: p.location!.longitude })
          : 0;
        const fmt = hasCoords ? formatDistance(dist) : { text: "", driveMin: null, walkMin: 0 };
        const note = p.editorialSummary?.text ?? p.generativeSummary?.overview?.text ?? null;
        return {
          place_id: p.id,
          name: p.displayName?.text ?? "Sem nome",
          rating: typeof p.rating === "number" ? Number(p.rating.toFixed(1)) : null,
          user_ratings_total: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
          category: cat.category,
          type: cat.type,
          lat: p.location!.latitude,
          lng: p.location!.longitude,
          distance_meters: dist,
          distance_text: fmt.text,
          drive_minutes: fmt.driveMin,
          walk_minutes: fmt.walkMin,
          opening_hours: p.regularOpeningHours?.weekdayDescriptions ?? null,
          image_url: buildPhotoUrl(p.photos?.[0]?.name),
          maps_url: p.googleMapsUri ?? `https://www.google.com/maps/search/?api=1&query_place_id=${p.id}`,
          note: note && note.length > 240 ? note.slice(0, 237).trimEnd() + "…" : note,
          formatted_address: p.formattedAddress ?? null,
        };
      });
  });



export const enrichFromMapsLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<EnrichResult> => {
    const resolved = await resolveShortUrl(data.mapsUrl);
    let coords = extractCoords(resolved);
    let geocoded: Awaited<ReturnType<typeof reverseGeocode>> = null;

    if (!coords) {
      // try treating the URL as a place query
      const q = decodeURIComponent(resolved.split("/place/")[1]?.split("/")[0] ?? "");
      if (q) {
        const g = await geocodeText(q);
        if (g?.geometry?.location) {
          coords = { lat: g.geometry.location.lat, lng: g.geometry.location.lng };
          geocoded = { formatted_address: g.formatted_address, address_components: g.address_components } as never;
        }
      }
    }
    if (!coords) throw new Error("Não consegui ler as coordenadas desse link. Cole um link do Google Maps que aponte para o endereço do imóvel.");

    if (!geocoded) geocoded = await reverseGeocode(coords.lat, coords.lng);
    const { city, country } = extractCityCountry(geocoded?.address_components);
    const address = geocoded?.formatted_address ?? "";

    // Lookup do próprio imóvel para tagline + foto de capa
    let tagline = "";
    let hero_image_url: string | null = null;
    let gallery_images: string[] = [];
    const placeNameFromUrl = decodeURIComponent(resolved.split("/place/")[1]?.split("/")[0] ?? "").replace(/\+/g, " ");
    const hint = placeNameFromUrl || address;
    if (hint) {
      const self = await findPropertyPlace(coords.lat, coords.lng, hint);
      if (self) {
        tagline =
          self.editorialSummary?.text ??
          self.generativeSummary?.overview?.text ??
          "";
        const photoUrls = (self.photos ?? [])
          .slice(0, 4)
          .map((p) => buildPhotoUrl(p.name))
          .filter((u): u is string => !!u);
        hero_image_url = photoUrls[0] ?? null;
        gallery_images = photoUrls;
      }
    }

    // Filtros de qualidade — afrouxados para abranger marcos da cidade e
    // grandes estabelecimentos (mercados, shoppings, marcos turísticos).
    const MIN_RATING = 4.0;
    const NEARBY_MIN_REVIEWS: Record<string, number> = {
      restaurant: 40, bar: 25, cafe: 20, nightlife: 30,
      attraction: 20, beach: 15, park: 15,
      market: 10, pharmacy: 10, shopping: 20,
    };
    const CITY_MIN_REVIEWS: Record<string, number> = {
      restaurant: 80, bar: 40, cafe: 40, nightlife: 40,
      attraction: 30, beach: 20, park: 20,
      market: 20, pharmacy: 15, shopping: 40,
    };
    const MAX_PER_TYPE = 10;
    // 35 km — Foz tem atrações (Cataratas, Itaipu) longe do centro.
    const MAX_CITY_RADIUS_M = 35000;

    const isQuality = (p: PlaceRaw, minReviews: number) =>
      typeof p.rating === "number" &&
      p.rating >= MIN_RATING &&
      typeof p.userRatingCount === "number" &&
      p.userRatingCount >= minReviews;

    const buildNote = (p: PlaceRaw): string | null => {
      const t = p.editorialSummary?.text ?? p.generativeSummary?.overview?.text ?? null;
      if (!t) return null;
      return t.length > 240 ? t.slice(0, 237).trimEnd() + "…" : t;
    };

    const normalizeName = (s: string) =>
      s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

    const recommendations: PlaceItem[] = [];
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();

    const push = (p: PlaceRaw, cat: typeof TYPE_MAP[number], scope: "nearby" | "city") => {
      if (!p.id || !p.location) return;
      if (seenIds.has(p.id)) return;
      const nm = normalizeName(p.displayName?.text ?? "");
      if (!nm || seenNames.has(nm)) return;
      seenIds.add(p.id);
      seenNames.add(nm);
      const dist = haversineMeters(coords!, { lat: p.location.latitude, lng: p.location.longitude });
      const { text, driveMin, walkMin } = formatDistance(dist);
      const openingHours = p.regularOpeningHours?.weekdayDescriptions ?? null;
      recommendations.push({
        place_id: p.id,
        name: p.displayName?.text ?? "Sem nome",
        rating: typeof p.rating === "number" ? Number(p.rating.toFixed(1)) : null,
        user_ratings_total: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
        category: cat.category,
        type: cat.type,
        scope,
        lat: p.location.latitude,
        lng: p.location.longitude,
        distance_meters: dist,
        distance_text: text,
        drive_minutes: driveMin,
        walk_minutes: walkMin,
        opening_hours: openingHours && openingHours.length > 0 ? openingHours : null,
        image_url: buildPhotoUrl(p.photos?.[0]?.name),
        maps_url: p.googleMapsUri ?? `https://www.google.com/maps/search/?api=1&query_place_id=${p.id}`,
        note: buildNote(p),
      });
    };


    // 1) Nearby por categoria — sem filtro de primaryType (confia no filtro do Places)
    for (const cat of TYPE_MAP) {
      const min = NEARBY_MIN_REVIEWS[cat.type] ?? 20;
      const items = (await placesNearby(coords.lat, coords.lng, cat.placesTypes))
        .filter((p) => isQuality(p, min))
        .sort((a, b) => {
          const ra = a.rating ?? 0;
          const rb = b.rating ?? 0;
          if (rb !== ra) return rb - ra;
          return (b.userRatingCount ?? 0) - (a.userRatingCount ?? 0);
        })
        .slice(0, MAX_PER_TYPE);
      for (const p of items) push(p, cat, "nearby");
    }

    // 2) City-wide via Places Text Search — sem filtro de includedType (permite marcos
    //    classificados em primaryType "inesperado", ex.: Marco das Três Fronteiras).
    if (city) {
      await Promise.all(
        TYPE_MAP.map(async (cat) => {
          const isTouristLike = cat.type === "attraction" || cat.type === "beach" || cat.type === "park";
          // Pontos turísticos: sem filtro de qualidade (mostrar todos); para outros: respeitar mínimo.
          const min = CITY_MIN_REVIEWS[cat.type] ?? 40;
          const limit = isTouristLike ? 25 : MAX_PER_TYPE;
          const items = (
            await placesText(
              `melhores ${cat.category.toLowerCase()} em ${city}`,
              coords!.lat,
              coords!.lng,
              undefined,
              MAX_CITY_RADIUS_M,
            )
          )
            .filter((p) => (isTouristLike ? !!p.location : isQuality(p, min)))
            .filter((p) => {
              if (!p.location) return false;
              if (isTouristLike) return true;
              const d = haversineMeters(coords!, { lat: p.location.latitude, lng: p.location.longitude });
              return d <= MAX_CITY_RADIUS_M;
            })
            .sort((a, b) => {
              const ra = a.rating ?? 0;
              const rb = b.rating ?? 0;
              if (rb !== ra) return rb - ra;
              return (b.userRatingCount ?? 0) - (a.userRatingCount ?? 0);
            })
            .slice(0, limit);
          for (const p of items) push(p, cat, "city");
        }),
      );
    }

    // 3) Curadoria via Gemini: pede os lugares icônicos da cidade por categoria
    //    e resolve cada nome via Places Text Search (sem includedType — o nome já é específico).
    if (city) {
      const iconic = await fetchIconicPlacesFromGemini(city, country);
      // Resolve em paralelo (com limite de concorrência) para não estourar timeout.
      const tasks: Array<{ name: string; cat: typeof TYPE_MAP[number] }> = [];
      for (const cat of TYPE_MAP) {
        const names = iconic[cat.type] ?? [];
        for (const name of names) {
          if (seenNames.has(normalizeName(name))) continue;
          tasks.push({ name, cat });
        }
      }
      const CONCURRENCY = 8;
      const results: Array<{ best: PlaceRaw | undefined; cat: typeof TYPE_MAP[number] }> = [];
      for (let i = 0; i < tasks.length; i += CONCURRENCY) {
        const batch = tasks.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.all(
          batch.map(async ({ name, cat }) => {
            const resolved = await placesText(`${name} ${city}`, coords!.lat, coords!.lng, undefined, MAX_CITY_RADIUS_M);
            const isAttractionLike = cat.type === "attraction" || cat.type === "beach" || cat.type === "park";
            const best = resolved
              .filter((p) => p.location)
              .filter((p) => {
                if (isAttractionLike) return true;
                const d = haversineMeters(coords!, { lat: p.location!.latitude, lng: p.location!.longitude });
                return d <= MAX_CITY_RADIUS_M;
              })
              .sort((a, b) => (b.userRatingCount ?? 0) - (a.userRatingCount ?? 0))[0];
            return { best, cat };
          }),
        );
        results.push(...batchResults);
      }
      for (const { best, cat } of results) {
        if (best) push(best, cat, "city");
      }
    }


    // Ordena: nearby por distância, city por rating desc dentro de cada categoria
    recommendations.sort((a, b) => {
      if (a.scope !== b.scope) return a.scope === "nearby" ? -1 : 1;
      if (a.type !== b.type) return a.type.localeCompare(b.type);
      if (a.scope === "nearby") return a.distance_meters - b.distance_meters;
      return (b.rating ?? 0) - (a.rating ?? 0);
    });

    return {
      address,
      lat: coords.lat,
      lng: coords.lng,
      city,
      country,
      tagline,
      hero_image_url,
      gallery_images,
      recommendations,
    };
  });

// ============= Sincronização automática com Google =============
// Atualiza nome, avaliação, total de reviews, horários, foto, link e distância
// de cada recomendação a partir do place_id salvo. Usado pelo botão manual no
// admin e pelo cron diário (`/api/public/cron/refresh-recommendations`).

type RecRow = {
  id: string;
  place_id: string | null;
  property_id: string;
  type: string | null;
};

const PLACE_DETAILS_FIELD_MASK =
  "id,displayName,location,rating,userRatingCount,googleMapsUri,photos,regularOpeningHours";

async function fetchPlaceDetails(placeId: string): Promise<PlaceRaw | null> {
  if (!placeId) return null;
  const res = await gatewayFetch(`/places/v1/places/${encodeURIComponent(placeId)}`, {
    headers: { "X-Goog-FieldMask": PLACE_DETAILS_FIELD_MASK },
  });
  if (!res.ok) return null;
  return (await res.json()) as PlaceRaw;
}

async function refreshRecommendationsForProperty(
  supabaseAdmin: typeof import("@/integrations/supabase/client.server").supabaseAdmin,
  property: { id: string; lat: number | null; lng: number | null },
  recs: RecRow[],
): Promise<{ updated: number; failed: number }> {
  let updated = 0;
  let failed = 0;
  const hasCoords = typeof property.lat === "number" && typeof property.lng === "number";

  // Limita concorrência simples — Places API é pago por chamada.
  const BATCH = 5;
  for (let i = 0; i < recs.length; i += BATCH) {
    const slice = recs.slice(i, i + BATCH);
    await Promise.all(
      slice.map(async (r) => {
        if (!r.place_id) return;
        try {
          const p = await fetchPlaceDetails(r.place_id);
          if (!p || !p.location) {
            failed += 1;
            // marca como sincronizado mesmo assim para não travar a fila
            await supabaseAdmin
              .from("property_recommendations")
              .update({ last_synced_at: new Date().toISOString() })
              .eq("id", r.id);
            return;
          }
          const patch: Record<string, unknown> = {
            name: p.displayName?.text ?? undefined,
            rating: typeof p.rating === "number" ? Number(p.rating.toFixed(1)) : null,
            user_ratings_total: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
            opening_hours: p.regularOpeningHours?.weekdayDescriptions ?? null,
            image_url: buildPhotoUrl(p.photos?.[0]?.name) ?? undefined,
            maps_url:
              p.googleMapsUri ?? `https://www.google.com/maps/search/?api=1&query_place_id=${p.id}`,
            last_synced_at: new Date().toISOString(),
          };
          if (hasCoords) {
            const dist = haversineMeters(
              { lat: property.lat as number, lng: property.lng as number },
              { lat: p.location.latitude, lng: p.location.longitude },
            );
            const fmt = formatDistance(dist);
            patch.distance_meters = dist;
            patch.distance_text = fmt.text;
            patch.drive_minutes = fmt.driveMin;
            patch.walk_minutes = fmt.walkMin;
          }
          // remove undefined para não sobrescrever com null indesejado
          for (const k of Object.keys(patch)) {
            if (patch[k] === undefined) delete patch[k];
          }
          const { error } = await supabaseAdmin
            .from("property_recommendations")
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .update(patch as any)
            .eq("id", r.id);

          if (error) {
            failed += 1;
            return;
          }
          updated += 1;
        } catch {
          failed += 1;
        }
      }),
    );
  }
  return { updated, failed };
}

const RefreshInput = z.object({ propertyId: z.string().uuid() });

export const refreshRecommendationsFromGoogle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => RefreshInput.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: prop, error: propErr } = await supabaseAdmin
      .from("properties")
      .select("id, owner_id, lat, lng")
      .eq("id", data.propertyId)
      .maybeSingle();
    if (propErr || !prop) throw new Error("Imóvel não encontrado.");

    // Autoriza: dono OU admin
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (prop.owner_id !== userId && !isAdmin) {
      throw new Error("Sem permissão para sincronizar este imóvel.");
    }

    const { data: recs, error: recsErr } = await supabaseAdmin
      .from("property_recommendations")
      .select("id, place_id, property_id, type")
      .eq("property_id", prop.id)
      .not("place_id", "is", null);
    if (recsErr) throw new Error("Não foi possível carregar as recomendações.");

    const list: RecRow[] = (recs ?? [])
      .filter((r) => !!r.place_id)
      .map((r) => ({ id: r.id, place_id: r.place_id, property_id: r.property_id, type: r.type as string | null }));

    if (list.length === 0) return { updated: 0, failed: 0, total: 0 };

    const result = await refreshRecommendationsForProperty(
      supabaseAdmin,
      { id: prop.id, lat: prop.lat as number | null, lng: prop.lng as number | null },
      list,
    );
    return { ...result, total: list.length };
  });

// Usado pelo cron público — não exige auth de usuário.
export async function refreshStaleRecommendations(limit: number) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const cap = Math.max(1, Math.min(500, limit));

  // Busca recomendações mais antigas (ou nunca sincronizadas) primeiro.
  const { data: recs, error } = await supabaseAdmin
    .from("property_recommendations")
    .select("id, place_id, property_id, type, last_synced_at")
    .not("place_id", "is", null)
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(cap);
  if (error) throw error;
  const list: RecRow[] = (recs ?? [])
    .filter((r) => !!r.place_id)
    .map((r) => ({ id: r.id, place_id: r.place_id, property_id: r.property_id, type: r.type as string | null }));

  if (list.length === 0) return { updated: 0, failed: 0, total: 0, properties: 0 };

  // Agrupa por propriedade para buscar coords uma vez.
  const byProperty = new Map<string, RecRow[]>();
  for (const r of list) {
    const arr = byProperty.get(r.property_id) ?? [];
    arr.push(r);
    byProperty.set(r.property_id, arr);
  }

  const propIds = Array.from(byProperty.keys());
  const { data: props } = await supabaseAdmin
    .from("properties")
    .select("id, lat, lng")
    .in("id", propIds);
  const propMap = new Map<string, { id: string; lat: number | null; lng: number | null }>();
  for (const p of props ?? []) {
    propMap.set(p.id as string, { id: p.id as string, lat: p.lat as number | null, lng: p.lng as number | null });
  }

  let updated = 0;
  let failed = 0;
  for (const [pid, prs] of byProperty) {
    const prop = propMap.get(pid);
    if (!prop) continue;
    const r = await refreshRecommendationsForProperty(supabaseAdmin, prop, prs);
    updated += r.updated;
    failed += r.failed;
  }
  return { updated, failed, total: list.length, properties: byProperty.size };
}
