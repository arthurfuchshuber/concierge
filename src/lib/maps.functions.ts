import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { AI_MODELS } from "@/lib/ai/models";

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
  // Quando informado, exclui do resultado os pontos "pertinho" (nearby) cujo place_id
  // ou nome já esteja cadastrado como recomendação "Pela cidade" (scope=city) —
  // evita duplicar sugestões do Sigma/city_references.
  propertyId: z.string().uuid().optional(),
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
  state: string | null;
  tagline: string;
  hero_image_url: string | null;
  gallery_images: string[];
  recommendations: PlaceItem[];
};

// `placesTypes` é o filtro enviado ao Places (includedTypes/includedType).
// `acceptedPrimaryTypes` é o que validamos no resultado — Google às vezes devolve
// estabelecimentos cujo primaryType não bate (ex.: salão de beleza retornado em "bar").
// Só aceitamos o item se o primaryType estiver na lista permitida.
// Ordem é PRIORIDADE: categorias mais específicas/preferidas primeiro.
// Atrações vêm ANTES de parques porque "national_park" / "tourist_attraction"
// devem ser classificados como Atração (ex.: Iguaçu/Iguazú).
export let TYPE_MAP: {
  type: PlaceItem["type"];
  placesTypes: string[];
  acceptedPrimaryTypes: string[];
  category: string;
  queryVariants?: string[];
}[] = [
  { type: "restaurant", placesTypes: ["restaurant"], acceptedPrimaryTypes: ["restaurant", "pizza_restaurant", "italian_restaurant", "brazilian_restaurant", "steak_house", "seafood_restaurant", "japanese_restaurant", "sushi_restaurant", "mexican_restaurant", "fast_food_restaurant", "hamburger_restaurant", "barbecue_restaurant", "vegetarian_restaurant", "vegan_restaurant", "meal_takeaway", "meal_delivery", "fine_dining_restaurant", "american_restaurant", "chinese_restaurant", "french_restaurant"], category: "Restaurantes", queryVariants: ["melhores restaurantes em", "restaurantes famosos em", "restaurantes tradicionais em", "alta gastronomia em"] },
  { type: "attraction", placesTypes: ["tourist_attraction"], acceptedPrimaryTypes: ["tourist_attraction", "museum", "art_gallery", "amusement_park", "aquarium", "zoo", "historical_landmark", "monument", "cultural_center", "national_park", "observation_deck", "performing_arts_theater", "planetarium", "amusement_center", "water_park", "wildlife_park", "ecological_park", "garden", "botanical_garden", "stadium", "arena", "skydiving_center", "scenic_lookout"], category: "Atrações", queryVariants: ["pontos turísticos em", "atrações turísticas famosas em", "o que fazer em", "passeios imperdíveis em", "marcos históricos em", "museus famosos em", "mirantes em", "experiências turísticas em", "tours em"] },
  { type: "nightlife", placesTypes: ["night_club"], acceptedPrimaryTypes: ["night_club", "comedy_club", "dance_club", "karaoke"], category: "Vida noturna", queryVariants: ["vida noturna em", "baladas em", "casas noturnas em", "clubes noturnos em", "danceterias em"] },
  { type: "bar", placesTypes: ["bar"], acceptedPrimaryTypes: ["bar", "pub", "wine_bar", "sports_bar", "bar_and_grill"], category: "Bares", queryVariants: ["melhores bares em", "bares famosos em", "pubs em", "wine bars em", "happy hour em"] },
  { type: "cafe", placesTypes: ["cafe", "coffee_shop"], acceptedPrimaryTypes: ["cafe", "coffee_shop", "bakery", "tea_house", "dessert_shop", "ice_cream_shop", "donut_shop"], category: "Cafés", queryVariants: ["melhores cafés em", "cafeterias famosas em", "padarias artesanais em", "doceria em"] },
  { type: "beach", placesTypes: ["beach"], acceptedPrimaryTypes: ["beach"], category: "Praias", queryVariants: ["melhores praias em", "praias famosas em", "praias para visitar em"] },
  { type: "market", placesTypes: ["supermarket", "grocery_store"], acceptedPrimaryTypes: ["supermarket", "grocery_store", "convenience_store", "food_store", "market"], category: "Mercados", queryVariants: ["supermercados em", "mercados em", "hipermercados em"] },
  { type: "pharmacy", placesTypes: ["pharmacy"], acceptedPrimaryTypes: ["pharmacy", "drugstore"], category: "Farmácias", queryVariants: ["farmácias em", "drogarias em", "farmácia 24 horas em", "drogaria 24h em", "rede de farmácia em"] },
  { type: "park", placesTypes: ["park"], acceptedPrimaryTypes: ["park", "state_park", "dog_park", "city_park", "plaza", "town_square"], category: "Praças, Lagos e Parques", queryVariants: ["praças famosas em", "parques urbanos em", "parques municipais em", "lagos em", "áreas verdes em", "espaços públicos de lazer em", "jardins públicos em"] },
  { type: "shopping", placesTypes: ["shopping_mall"], acceptedPrimaryTypes: ["shopping_mall", "department_store"], category: "Compras", queryVariants: ["shoppings em", "shopping centers em", "centros de compras em"] },
];

export type TypeMapEntry = (typeof TYPE_MAP)[number];

// Hidrata TYPE_MAP a partir das tabelas poi_tags/poi_categories. As tags-base
// (is_protected=true) preservam seu mapeamento Google original; o label/categoria
// pode ser renomeado. Tags customizadas (is_protected=false) entram como novas
// entradas no array. Chamado no início de cada handler.
let _typeMapHydratedAt = 0;
const TYPE_MAP_TTL_MS = 60_000;
async function hydrateTypeMap(): Promise<void> {
  if (Date.now() - _typeMapHydratedAt < TYPE_MAP_TTL_MS) return;
  try {
    const { loadTaxonomyCached } = await import("./poi-taxonomy.functions");
    const tax = await loadTaxonomyCached();
    if (!tax.tags.length) return;
    const baseBySlug = new Map(TYPE_MAP.map((t) => [t.type, t]));
    const next: typeof TYPE_MAP = [];
    for (const t of tax.tags) {
      const base = baseBySlug.get(t.slug);
      if (base) {
        // Tag-base: preserva mapping Google, sobrescreve apenas label/categoria.
        next.push({ ...base, category: t.category_label });
      } else if (t.accepted_primary_types.length || t.places_types.length) {
        // Tag custom com mapping → IA classifica.
        next.push({
          type: t.slug,
          placesTypes: t.places_types,
          acceptedPrimaryTypes: t.accepted_primary_types,
          category: t.category_label,
          queryVariants: t.query_variants.length ? t.query_variants : undefined,
        });
      }
      // Tag custom sem mapping → não participa da geração por IA (só seleção manual).
    }
    if (next.length) {
      TYPE_MAP = next;
      _typeMapHydratedAt = Date.now();
    }
  } catch (e) {
    console.error("[hydrateTypeMap]", e);
  }
}


export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const toRad = (n: number) => (n * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

export function formatDistance(meters: number): { text: string; driveMin: number | null; walkMin: number } {
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
  if (!apiKey || !mapsKey) throw new Error("Google Maps connector não configurado. Verifique LOVABLE_API_KEY e GOOGLE_MAPS_API_KEY nas variáveis de ambiente.");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${apiKey}`);
  headers.set("X-Connection-Api-Key", mapsKey);
  const url = `${GATEWAY}${path}`;
  // Throttle Places API calls (searchText / searchNearby) — cache identical
  // POST bodies for 24h and cap parallelism to avoid quota bursts (HTTP 429).
  const isPlaces = path.startsWith("/places/v1/places:");
  let cacheKey: string | undefined;
  if (isPlaces && typeof init.body === "string") {
    const fieldMask = headers.get("X-Goog-FieldMask") ?? "";
    cacheKey = `${path}::${fieldMask}::${init.body}`;
  }
  const res = isPlaces
    ? await (await import("@/lib/places-throttle.server")).throttledFetch(url, { ...init, headers }, cacheKey)
    : await fetch(url, { ...init, headers });
  if (!res.ok) {
    const body = await res.clone().text().catch(() => "");
    console.error(`[Maps Gateway] ${res.status} ${path}`, body.slice(0, 300));
  }
  return res;
}


type GeoComponent = { types: string[]; long_name: string; short_name?: string };

async function geocodeText(text: string) {
  const res = await gatewayFetch(`/maps/api/geocode/json?address=${encodeURIComponent(text)}`);
  if (!res.ok) return null;
  const j = (await res.json()) as { results?: Array<{ geometry?: { location?: { lat: number; lng: number } }; formatted_address?: string; address_components?: GeoComponent[] }> };
  return j.results?.[0] ?? null;
}

async function reverseGeocode(lat: number, lng: number) {
  const res = await gatewayFetch(`/maps/api/geocode/json?latlng=${lat},${lng}`);
  if (!res.ok) return null;
  const j = (await res.json()) as { results?: Array<{ formatted_address?: string; address_components?: GeoComponent[] }> };
  return j.results?.[0] ?? null;
}

function extractCityCountry(comps: GeoComponent[] | undefined) {
  let city = "";
  let country = "";
  let state: string | null = null;
  for (const c of comps ?? []) {
    if (c.types.includes("locality") || c.types.includes("administrative_area_level_2")) {
      city ||= c.long_name;
    }
    if (c.types.includes("administrative_area_level_1")) {
      state ||= (c.short_name && /^[A-Z]{2}$/.test(c.short_name)) ? c.short_name : c.long_name;
    }
    if (c.types.includes("country")) country = c.long_name;
  }
  return { city, country, state };
}

const PLACE_FIELD_MASK =
  "places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.googleMapsUri,places.photos.name,places.photos.widthPx,places.photos.heightPx,places.primaryType,places.editorialSummary,places.generativeSummary,places.regularOpeningHours";

// Idioma padrão para todas as chamadas Places. Garante que displayName,
// editorialSummary, generativeSummary e regularOpeningHours venham em
// português — antes voltava em inglês por padrão.
const DEFAULT_LANGUAGE = "pt-BR";
const DEFAULT_REGION = "BR";

async function placesNearby(
  lat: number,
  lng: number,
  includedTypes: string[],
  radius = 6000,
) {
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
      languageCode: DEFAULT_LANGUAGE,
      regionCode: DEFAULT_REGION,
      locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius } },
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
    languageCode: DEFAULT_LANGUAGE,
    regionCode: DEFAULT_REGION,
    // locationBias (não restriction) — permite marcos famosos um pouco fora do raio
    // (Cataratas/Itaipu em Foz ficam a 20-25km do centro), mas mantém viés geográfico.
    locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: radiusMeters } },
  };
  if (includedType) body.includedType = includedType;
  const res = await gatewayFetch(`/places/v1/places:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-FieldMask": PLACE_FIELD_MASK,
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
        "places.id,places.displayName,places.formattedAddress,places.editorialSummary,places.generativeSummary,places.photos.name,places.photos.widthPx,places.photos.heightPx,places.location",
    },
    body: JSON.stringify({
      textQuery: hint,
      maxResultCount: 1,
      languageCode: DEFAULT_LANGUAGE,
      regionCode: DEFAULT_REGION,
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
      photos?: PlacePhoto[];
      location?: { latitude: number; longitude: number };
    }>;
  };
  return j.places?.[0] ?? null;
}

type PlacePhoto = { name: string; widthPx?: number; heightPx?: number };
type PlaceRaw = {
  id: string;
  displayName?: { text?: string };
  location?: { latitude: number; longitude: number };
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  photos?: PlacePhoto[];
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

// Escolhe a melhor foto do lugar: prioriza a MAIOR foto landscape em alta
// resolução (≥1600×900, proporção 1.2-2.5). Quando há várias boas, pega a
// de maior área — fotos profissionais/institucionais quase sempre são as
// maiores. Evita retratos, quadrados e thumbs pequenas (fotos "ruins").
export function pickBestPlacePhoto(photos: PlacePhoto[] | undefined): string | null {
  if (!photos || photos.length === 0) return null;
  const area = (p: PlacePhoto) => (p.widthPx ?? 0) * (p.heightPx ?? 0);
  const isGood = (p: PlacePhoto) => {
    const w = p.widthPx ?? 0;
    const h = p.heightPx ?? 0;
    if (w < 1600 || h < 900) return false;
    const ar = w / h;
    return ar >= 1.2 && ar <= 2.5;
  };
  const good = [...photos].filter(isGood).sort((a, b) => area(b) - area(a));
  if (good.length > 0) return buildPhotoUrl(good[0].name);
  // Fallback: pega a maior foto disponível (por área), evitando portraits muito altos
  const ranked = [...photos]
    .filter((p) => {
      const w = p.widthPx ?? 0;
      const h = p.heightPx ?? 0;
      if (!w || !h) return true;
      return w / h >= 0.9; // descarta portraits estreitos
    })
    .sort((a, b) => area(b) - area(a));
  return buildPhotoUrl((ranked[0] ?? photos[0]).name);
}

// Curadoria via Gemini: lista os lugares mais famosos/queridos da cidade por categoria.
// Retorna { restaurant: [...], bar: [...], ... }. Em caso de erro, retorna {}.
async function fetchIconicPlacesFromGemini(
  city: string,
  country: string,
  state?: string | null,
): Promise<Record<string, string[]>> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey || !city) return {};

  const locationLabel = [city, state, country].filter(Boolean).join(", ");
  const categoriesPrompt = TYPE_MAP.map((c) => `- ${c.type}: ${c.category}`).join("\n");
  const prompt = `Você é um concierge local com profundo conhecimento de ${locationLabel}. Sua missão é montar uma curadoria PRECISA e ABRANGENTE dos melhores lugares em cada categoria.

REGRAS CRÍTICAS:
1. Inclua APENAS estabelecimentos consolidados, com no MÍNIMO 200 avaliações no Google Maps. Se você não tem certeza que o lugar tem 200+ avaliações, NÃO inclua.
2. Respeite RIGOROSAMENTE a categoria. NÃO misture tipos:
   - NÃO coloque hotéis/pousadas/sorveterias em "bar"
   - NÃO coloque lanchonetes em "cafe"
   - NÃO coloque shopping em "attraction"
   - Parques NACIONAIS, ESTADUAIS e ECOLÓGICOS (ex.: Parque Nacional do Iguaçu, Iguazú National Park) sempre vão em "attraction", NUNCA em "park". "park" é só para parques urbanos/municipais/praças.
   - "nightlife" é só balada/casa noturna/dance club — bares tradicionais vão em "bar".
3. Para "attraction" (pontos turísticos) seja ABRANGENTE: marcos, monumentos, museus, parques nacionais, parques temáticos, aquários, zoológicos, mirantes, observatórios, jardins botânicos, experiências turísticas radicais (paraquedismo, rapel, tirolesa, sobrevoos), roda-gigante, passeios de barco famosos, tours clássicos. Inclua TUDO que um turista busca fazer na cidade.
4. Para restaurantes/bares/cafés: lugares clássicos e consagrados da cidade, conhecidos por moradores e turistas, com volume alto de avaliações.
5. Para farmácias: inclua as principais redes presentes na cidade (Drogaria, Pague Menos, Panvel, Droga Raia, Drogasil, Farma D, etc.) — várias unidades movimentadas.
6. Use o nome EXATO como aparece no Google Maps.
7. Não invente lugares. Em caso de dúvida, OMITA.

Categorias:
${categoriesPrompt}

Para cada categoria, retorne entre 12 e 25 nomes — busque PROFUNDIDADE sem sacrificar qualidade. Para "attraction" especificamente, vá até 30 se houver volume real na cidade.

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
        model: AI_MODELS.recommendations,
        messages: [
          { role: "system", content: "Você é um concierge local que conhece em profundidade as cidades brasileiras e seus estados. Responda sempre com JSON válido, sem markdown." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) {
      console.error("[Gemini] gateway error", res.status, await res.text().catch(() => ""));
      return {};
    }
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = j.choices?.[0]?.message?.content ?? "";
    const cleaned = content.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const out: Record<string, string[]> = {};
    for (const cat of TYPE_MAP) {
      const arr = parsed[cat.type];
      if (Array.isArray(arr)) {
        const limit = cat.type === "attraction" ? 30 : 25;
        out[cat.type] = arr.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, limit);
      }
    }
    return out;
  } catch (err) {
    console.error("[Gemini] fetchIconicPlacesFromGemini error:", err);
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
    await hydrateTypeMap();
    const hasCoords = typeof data.lat === "number" && typeof data.lng === "number";
    const lat = hasCoords ? (data.lat as number) : 0;
    const lng = hasCoords ? (data.lng as number) : 0;

    const body: Record<string, unknown> = {
      textQuery: data.query,
      maxResultCount: 8,
      languageCode: DEFAULT_LANGUAGE,
      regionCode: DEFAULT_REGION,
    };
    if (hasCoords) {
      body.locationBias = { circle: { center: { latitude: lat, longitude: lng }, radius: 50000 } };
    }
    const res = await gatewayFetch(`/places/v1/places:searchText`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.googleMapsUri,places.photos.name,places.photos.widthPx,places.photos.heightPx,places.primaryType,places.editorialSummary,places.generativeSummary,places.regularOpeningHours",
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
          image_url: pickBestPlacePhoto(p.photos),
          maps_url: p.googleMapsUri ?? `https://www.google.com/maps/search/?api=1&query_place_id=${p.id}`,
          note: note && note.length > 240 ? note.slice(0, 237).trimEnd() + "…" : note,
          formatted_address: p.formattedAddress ?? null,
        };
      });
  });



export const enrichFromMapsLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }): Promise<EnrichResult> => {
    await hydrateTypeMap();
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
    const { city, country, state } = extractCityCountry(geocoded?.address_components);
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
          .slice(0, 8)
          .map((p) => pickBestPlacePhoto([p]))
          .filter((u): u is string => !!u);
        hero_image_url = pickBestPlacePhoto(self.photos) ?? photoUrls[0] ?? null;
        gallery_images = photoUrls.slice(0, 4);
      }
    }

    // Regra global: mínimo 150 avaliações + rating ≥ 4.0 + primaryType deve
    // bater com a categoria. Recomendações do GUIA são SOMENTE "pertinho":
    // até 1,5km OU até 20 minutos a pé (≈1,6km a 80 m/min). Lugares city-wide
    // ficam em city_references, exibidos na seção "Na Cidade" do guia.
    const MIN_RATING = 3.8;
    const MIN_REVIEWS_GLOBAL = 20;   // permissivo para pertinho — captura ref locais
    const MAX_PER_TYPE = 500;       // sem limite prático — Google text/nearby retornam até 20 por busca
    const PERTINHO_MAX_M = 2500;     // filtro de exibição: até 2,5km (~30min a pé)
    const NEARBY_RADIUS_M = 3000;    // busca além do limite para garantir cobertura
    const NEARBY_TEXT_RADIUS_M = 4000;

    // Usa o classificador global (com BLOCKED_PRIMARY_TYPES) — definido mais abaixo.
    // Hotéis/agências/eventos/lojas são descartados mesmo quando aparecem no Nearby.

    const isQuality = (p: PlaceRaw) =>
      typeof p.rating === "number" &&
      p.rating >= MIN_RATING &&
      typeof p.userRatingCount === "number" &&
      p.userRatingCount >= MIN_REVIEWS_GLOBAL;

    const buildNote = (p: PlaceRaw): string | null => {
      const t = p.editorialSummary?.text ?? p.generativeSummary?.overview?.text ?? null;
      if (!t) return null;
      return t.length > 240 ? t.slice(0, 237).trimEnd() + "…" : t;
    };

    const normalizeName = (s: string) =>
      s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

    const byCategory = new Map<string, Array<PlaceRaw & { _dist: number; _cat: TypeMapEntry }>>();
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();

    const ingest = (p: PlaceRaw) => {
      if (!p.id || !p.location || !isQuality(p)) return;
      if (seenIds.has(p.id)) return;
      const cat = classifyByPrimaryType(p.primaryType);
      if (!cat) return;
      const dist = haversineMeters(coords!, { lat: p.location.latitude, lng: p.location.longitude });
      if (dist > PERTINHO_MAX_M) return; // só pertinho entra no guia
      const nm = normalizeName(p.displayName?.text ?? "");
      if (!nm || seenNames.has(nm)) return;
      seenIds.add(p.id);
      seenNames.add(nm);
      const arr = byCategory.get(cat.type) ?? [];
      arr.push({ ...p, _dist: dist, _cat: cat });
      byCategory.set(cat.type, arr);
    };

    // 1) Nearby por categoria — raio de 1,6km (pertinho).
    await Promise.all(
      TYPE_MAP.map(async (cat) => {
        const items = await placesNearby(coords!.lat, coords!.lng, cat.placesTypes, NEARBY_RADIUS_M);
        for (const p of items) ingest(p);
      }),
    );

    // 2) Text search por categoria — múltiplas variantes, biased ao redor da casa.
    // Traz referências locais que o Nearby não pega (filtros de tipo são rígidos).
    const textTasks: Array<{ q: string }> = [];
    for (const cat of TYPE_MAP) {
      const variants = cat.queryVariants ?? [`melhores ${cat.category.toLowerCase()}`];
      // Usa TODAS as variantes — mais abrangência no entorno
      for (const v of variants) textTasks.push({ q: `${v} perto` });
    }
    const TEXT_CONCURRENCY = 6;
    for (let i = 0; i < textTasks.length; i += TEXT_CONCURRENCY) {
      const batch = textTasks.slice(i, i + TEXT_CONCURRENCY);
      const results = await Promise.all(
        batch.map(({ q }) => placesTextRestricted(q, coords!.lat, coords!.lng, NEARBY_TEXT_RADIUS_M)),
      );
      for (const items of results) {
        for (const p of items) ingest(p);
      }
    }

    // 3) Monta saída — ordena por POPULARIDADE (reviews) com bônus por
    // proximidade. Lugares famosos perto da casa ganham prioridade sobre
    // lugares pouco conhecidos com nota alta.
    const recommendations: PlaceItem[] = [];
    for (const cat of TYPE_MAP) {
      const arr = (byCategory.get(cat.type) ?? [])
        .sort((a, b) => {
          // Score: log(reviews) * rating - penalidade leve por distância
          const score = (p: typeof a) => {
            const r = p.rating ?? 0;
            const n = p.userRatingCount ?? 0;
            const proxBonus = Math.max(0, 1 - p._dist / 10000); // até +1 dentro de 10km
            return Math.log10(n + 10) * r + proxBonus;
          };
          return score(b) - score(a);
        })
        .slice(0, MAX_PER_TYPE);

      for (const p of arr) {
        const { text, driveMin, walkMin } = formatDistance(p._dist);
        const openingHours = p.regularOpeningHours?.weekdayDescriptions ?? null;
        recommendations.push({
          place_id: p.id!,
          name: p.displayName?.text ?? "Sem nome",
          rating: typeof p.rating === "number" ? Number(p.rating.toFixed(1)) : null,
          user_ratings_total: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
          category: p._cat.category,
          type: p._cat.type,
          scope: "nearby",
          lat: p.location!.latitude,
          lng: p.location!.longitude,
          distance_meters: p._dist,
          distance_text: text,
          drive_minutes: driveMin,
          walk_minutes: walkMin,
          opening_hours: openingHours && openingHours.length > 0 ? openingHours : null,
          image_url: pickBestPlacePhoto(p.photos),
          maps_url: p.googleMapsUri ?? `https://www.google.com/maps/search/?api=1&query_place_id=${p.id}`,
          note: buildNote(p),
        });
      }
    }

    // NOTE: Recomendações "city-wide" não são geradas aqui.
    // Pontos icônicos da cidade inteira são gerenciados separadamente em
    // "Recomendações da Cidade" (city_references) e exibidos no guia em
    // aba/categoria própria — sem misturar com o "pertinho da residência".

    // Dupla checagem: se o cliente informou o propertyId, buscamos as recomendações
    // já cadastradas em escopo "city" e removemos daqui qualquer coincidência
    // (por place_id ou nome normalizado) — evita replicar pontos que o hóspede
    // já veria em "Pela cidade", inclusive quando vindos do Sigma Concierge.
    let filtered = recommendations;
    if (data.propertyId) {
      const { data: cityRows } = await context.supabase
        .from("property_recommendations")
        .select("place_id, name")
        .eq("property_id", data.propertyId)
        .eq("scope", "city");
      const cityPlaceIds = new Set<string>();
      const cityNames = new Set<string>();
      for (const r of (cityRows ?? []) as Array<{ place_id: string | null; name: string | null }>) {
        if (r.place_id) cityPlaceIds.add(r.place_id);
        if (r.name) cityNames.add(normalizeName(r.name));
      }
      if (cityPlaceIds.size || cityNames.size) {
        filtered = recommendations.filter((r) => {
          if (r.place_id && cityPlaceIds.has(r.place_id)) return false;
          if (r.name && cityNames.has(normalizeName(r.name))) return false;
          return true;
        });
      }
    }

    // Ordena para exibição: agrupa por categoria, dentro da categoria por
    // distância crescente.
    filtered.sort((a, b) => {
      if (a.type !== b.type) return a.type.localeCompare(b.type);
      return a.distance_meters - b.distance_meters;
    });

    return {
      address,
      lat: coords.lat,
      lng: coords.lng,
      city,
      country,
      state,
      tagline,
      hero_image_url,
      gallery_images,
      recommendations: filtered,
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
  "id,displayName,location,rating,userRatingCount,googleMapsUri,photos.name,photos.widthPx,photos.heightPx,regularOpeningHours,editorialSummary,generativeSummary,primaryType,formattedAddress";

export async function fetchPlaceDetails(placeId: string): Promise<PlaceRaw | null> {
  if (!placeId) return null;
  const res = await gatewayFetch(
    `/places/v1/places/${encodeURIComponent(placeId)}?languageCode=${DEFAULT_LANGUAGE}&regionCode=${DEFAULT_REGION}`,
    { headers: { "X-Goog-FieldMask": PLACE_DETAILS_FIELD_MASK } },
  );
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
          const noteText = p.editorialSummary?.text ?? p.generativeSummary?.overview?.text ?? null;
          const noteTrimmed = noteText && noteText.length > 240 ? noteText.slice(0, 237).trimEnd() + "…" : noteText;
          const patch: Record<string, unknown> = {
            // NOTE: nome NUNCA é atualizado automaticamente — pode estar personalizado pelo usuário.
            rating: typeof p.rating === "number" ? Number(p.rating.toFixed(1)) : null,
            user_ratings_total: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
            opening_hours: p.regularOpeningHours?.weekdayDescriptions ?? null,
            image_url: pickBestPlacePhoto(p.photos) ?? undefined,
            note: noteTrimmed,
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
    await hydrateTypeMap();
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

// ============= Geração de Referências Macro por Cidade =============
// Diferente do fluxo "pertinho da residência", este gera os pontos icônicos
// da cidade INTEIRA — sem viés por coordenada da casa. Usado pelo admin e
// pelo cron semanal. Retorna linhas prontas para upsert em city_references.

export type CityReferenceRow = {
  place_id: string;
  category: string;
  type: string;
  name: string;
  note: string | null;
  address: string | null;
  rating: number | null;
  user_ratings_total: number | null;
  primary_type: string | null;
  lat: number;
  lng: number;
  image_url: string | null;
  maps_url: string | null;
  opening_hours: string[] | null;
};

const CITY_MIN_RATING = 4.0;
const CITY_MIN_REVIEWS_DEFAULT = 80;
const CITY_MAX_PER_TYPE = 500; // sem limite prático

function cityMinReviewsForType(type: string) {
  if (["market", "pharmacy"].includes(type)) return 40;
  if (["park", "nightlife"].includes(type)) return 80;
  if (["beach"].includes(type)) return 120;
  if (["restaurant", "bar", "cafe", "shopping"].includes(type)) return 150;
  if (["attraction"].includes(type)) return 200; // ícones de fato, não atrações secundárias
  return CITY_MIN_REVIEWS_DEFAULT;
}

// Normaliza um nome agressivamente para detectar duplicatas semânticas.
// Remove acentos, pontuação, parênteses, palavras genéricas que aparecem em
// variantes do mesmo lugar (park/parque/national/nacional/falls/cataratas/
// tour/visit/mirante/binacional/de/do/da/the/of/etc.) e ordena tokens para
// que "Iguazzu Falls Park" e "Parque Cataratas" caiam no mesmo bucket quando
// combinados com proximidade geográfica.
const DEDUPE_STOPWORDS = new Set([
  "de", "do", "da", "dos", "das", "the", "of", "and", "e",
  "park", "parque", "national", "nacional",
  "falls", "cataratas", "cataract", "waterfall", "waterfalls",
  "tour", "visit", "passeio",
  "mirante", "viewpoint", "lookout",
  "binacional", "binational",
  "centro", "center",
  "museu", "museum",
  "complexo", "complex",
]);
function dedupeKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[()[\]{}'"!?.,;:|/\\-]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !DEDUPE_STOPWORDS.has(t))
    .sort()
    .join(" ");
}

// Busca textual SEM bias geográfico — usada internamente como fallback
async function placesTextNoBias(query: string): Promise<(PlaceRaw & { formattedAddress?: string })[]> {
  const res = await gatewayFetch(`/places/v1/places:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-FieldMask": `${PLACE_FIELD_MASK},places.formattedAddress`,
    },
    body: JSON.stringify({
      textQuery: query,
      maxResultCount: 20,
      languageCode: DEFAULT_LANGUAGE,
      regionCode: DEFAULT_REGION,
    }),
  });
  if (!res.ok) return [];
  const j = (await res.json()) as { places?: (PlaceRaw & { formattedAddress?: string })[] };
  return j.places ?? [];
}

// Busca textual com viés geográfico circular. No Places Text Search (New),
// `locationRestriction.circle` é inválido; a API aceita círculo em
// `locationBias`. A validação final de distância continua no nosso código.
async function placesTextRestricted(
  query: string,
  lat: number,
  lng: number,
  radiusMeters: number,
): Promise<(PlaceRaw & { formattedAddress?: string })[]> {
  const res = await gatewayFetch(`/places/v1/places:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-FieldMask": `${PLACE_FIELD_MASK},places.formattedAddress`,
    },
    body: JSON.stringify({
      textQuery: query,
      maxResultCount: 20,
      languageCode: DEFAULT_LANGUAGE,
      regionCode: DEFAULT_REGION,
      locationBias: {
        circle: { center: { latitude: lat, longitude: lng }, radius: radiusMeters },
      },
    }),
  });
  if (!res.ok) return [];
  const j = (await res.json()) as { places?: (PlaceRaw & { formattedAddress?: string })[] };
  return j.places ?? [];
}

// Tipos do Google Places que NUNCA devem entrar em nenhuma categoria do guia.
// Defesa em profundidade: hotéis, agências, eventos, lojas, escritórios etc.
// — esses costumam aparecer em buscas por "pontos turísticos" e poluir o resultado.
const BLOCKED_PRIMARY_TYPES = new Set<string>([
  // Hospedagem
  "lodging", "hotel", "resort_hotel", "motel", "extended_stay_hotel",
  "bed_and_breakfast", "guest_house", "hostel", "campground", "rv_park",
  "cottage", "inn", "private_guest_room",
  // Turismo / agências / eventos
  "travel_agency", "tour_agency", "tourist_information_center",
  "event_venue", "wedding_venue", "banquet_hall", "convention_center",
  "auditorium", "conference_center",
  // Lojas/serviços genéricos
  "store", "book_store", "stationery_store", "office_supply_store",
  "clothing_store", "shoe_store", "electronics_store", "furniture_store",
  "hardware_store", "home_goods_store", "jewelry_store", "gift_shop",
  "beauty_salon", "hair_salon", "spa", "gym", "fitness_center",
  // Saúde/serviços
  "hospital", "doctor", "dentist", "veterinary_care", "bank", "atm",
  "real_estate_agency", "insurance_agency", "lawyer", "post_office",
  // POIs genéricos sem categoria útil
  "point_of_interest", "establishment", "premise", "subpremise",
]);

// Decide a categoria FINAL de um lugar com base em primaryType, respeitando
// a ordem de prioridade do TYPE_MAP (attraction antes de park, etc.).
function classifyByPrimaryType(primaryType: string | undefined): TypeMapEntry | null {
  if (!primaryType) return null;
  if (BLOCKED_PRIMARY_TYPES.has(primaryType)) return null;
  for (const cat of TYPE_MAP) {
    if (cat.acceptedPrimaryTypes.includes(primaryType)) return cat;
  }
  return null;
}

// Extrai um sufixo de localidade do endereço (cidade, estado/UF, país) — usado
// para desambiguar nomes idênticos (ex.: Iguaçu BR vs Iguazú AR).
function extractLocationSuffix(address: string | null | undefined): string {
  if (!address) return "";
  const parts = address.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return "";
  // Pega últimos 2 segmentos (geralmente "Estado/UF, País")
  const tail = parts.slice(-2).join(", ");
  return tail;
}

export async function generateCityReferencesFromMaps(input: {
  city_label: string;
  state: string | null;
  country: string;
  type?: string | null;
}): Promise<CityReferenceRow[]> {
  await hydrateTypeMap();
  const { city_label, state, country, type } = input;
  const cityQ = state ? `${city_label}, ${state}` : city_label;
  const targetTypes = type
    ? TYPE_MAP.filter((c) => c.type === type)
    : TYPE_MAP;

  // Geocodifica a cidade para obter coordenadas centrais.
  // Isso permite usar um viés geográfico forte e validar distância no nosso código.
  const cityCenter = await resolveCityCenter(city_label, state, country);

  // Raio da restrição geográfica em metros.
  // Google Places API New impõe um MÁXIMO de 50.000 m em
  // `locationBias.circle.radius`. Mantemos no limite aceito e filtramos distância localmente.
  const CITY_RADIUS_M = 35_000;
  const ATTRACTION_RADIUS_M = 50_000; // cap do Google — antes estava 60_000 (bug)

  const isQuality = (p: PlaceRaw, cat: TypeMapEntry) =>
    typeof p.rating === "number" &&
    p.rating >= CITY_MIN_RATING &&
    typeof p.userRatingCount === "number" &&
    p.userRatingCount >= cityMinReviewsForType(cat.type);

  const buildNote = (p: PlaceRaw): string | null => {
    const t = p.editorialSummary?.text ?? p.generativeSummary?.overview?.text ?? null;
    if (!t) return null;
    return t.length > 240 ? t.slice(0, 237).trimEnd() + "…" : t;
  };

  // Agrupa por categoria final (decidida via primaryType) para respeitar a
  // prioridade do TYPE_MAP — mesmo lugar nunca duplica entre Atrações/Parques.
  const byCategory = new Map<string, Array<PlaceRaw & { formattedAddress?: string; _cat: TypeMapEntry }>>();
  const seenIds = new Set<string>();

  // Diagnóstico — contadores para entender por que algo é descartado.
  const drop = { noLoc: 0, lowQuality: 0, dup: 0, noClass: 0, wrongType: 0, outOfScope: 0, tooFar: 0, kept: 0 };

  const ingest = (p: PlaceRaw & { formattedAddress?: string }, _hintCat: TypeMapEntry) => {
    if (!p.id || !p.location) { drop.noLoc++; return; }
    if (seenIds.has(p.id)) { drop.dup++; return; }
    // Classificação ESTRITA pelo primaryType. Se o Google não devolve um tipo
    // que bate exatamente com alguma categoria do TYPE_MAP (ou se for um tipo
    // explicitamente bloqueado — hotéis, agências, eventos, lojas), DESCARTA.
    // Antes caíamos no hintCat e isso poluía o resultado (hotel virando "ponto turístico").
    const realCat = classifyByPrimaryType(p.primaryType);
    if (!realCat) { drop.noClass++; return; }
    // Se o usuário pediu apenas 1 tipo (regen por categoria), filtra.
    if (type && realCat.type !== type) { drop.wrongType++; return; }
    if (!targetTypes.some((c) => c.type === realCat.type)) { drop.outOfScope++; return; }
    if (!isQuality(p, realCat)) { drop.lowQuality++; return; }

    // Validação geográfica extra: se temos coordenadas da cidade, descarta
    // qualquer lugar que esteja além do raio permitido para a categoria.
    if (cityCenter) {
      const dist = haversineMeters(cityCenter, { lat: p.location.latitude, lng: p.location.longitude });
      const maxDist = realCat.type === "attraction" || realCat.type === "beach"
        ? ATTRACTION_RADIUS_M
        : CITY_RADIUS_M;
      if (dist > maxDist) { drop.tooFar++; return; }
    }

    seenIds.add(p.id);
    drop.kept++;
    const arr = byCategory.get(realCat.type) ?? [];
    arr.push({ ...p, _cat: realCat });
    byCategory.set(realCat.type, arr);
  };

  // Função auxiliar: usa viés geográfico quando possível e cai para busca
  // ampla quando a API não devolve itens para a cidade.
  const searchForCity = async (query: string, cat: TypeMapEntry) => {
    if (!cityCenter) return placesTextNoBias(query);
    const radius = cat.type === "attraction" || cat.type === "beach"
      ? ATTRACTION_RADIUS_M
      : CITY_RADIUS_M;
    const biased = await placesTextRestricted(query, cityCenter.lat, cityCenter.lng, radius);
    return biased.length > 0 ? biased : placesTextNoBias(query);
  };

  // 1) Múltiplas queries por categoria com restrição geográfica
  const queryTasks: Array<{ q: string; cat: TypeMapEntry }> = [];
  for (const cat of targetTypes) {
    const variants = cat.queryVariants ?? [`melhores ${cat.category.toLowerCase()} em`];
    for (const v of variants) queryTasks.push({ q: `${v} ${cityQ}`, cat });
  }

  const QUERY_CONCURRENCY = 6;
  for (let i = 0; i < queryTasks.length; i += QUERY_CONCURRENCY) {
    const batch = queryTasks.slice(i, i + QUERY_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async ({ q, cat }) => ({ items: await searchForCity(q, cat), cat })),
    );
    for (const { items, cat } of results) {
      for (const p of items) ingest(p, cat);
    }
  }

  // 2) Curadoria via Gemini — nomes icônicos resolvidos com restrição geográfica.
  // O nome exato do Google Maps + cidade evita ambiguidade, e o círculo
  // garante que não pega homônimos de outras cidades.
  const iconic = await fetchIconicPlacesFromGemini(city_label, country, state);
  const tasks: Array<{ name: string; cat: TypeMapEntry }> = [];
  for (const cat of targetTypes) {
    const names = iconic[cat.type] ?? [];
    for (const name of names) tasks.push({ name, cat });
  }
  const CONCURRENCY = 6;
  for (let i = 0; i < tasks.length; i += CONCURRENCY) {
    const batch = tasks.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async ({ name, cat }) => {
        // Busca com restrição geográfica quando possível — evita pegar
        // lugares com nome igual em outras cidades ou estados.
        const resolved = await searchForCity(`${name} ${cityQ}`, cat);
        return { items: resolved, cat };
      }),
    );
    for (const { items, cat } of results) {
      for (const p of items) ingest(p, cat);
    }
  }

  // 3) Monta saída ordenada por categoria → top N por SCORE composto
  // (rating × log(reviews)) — qualidade + popularidade, não só nota.
  const qualityScore = (p: PlaceRaw) => {
    const r = p.rating ?? 0;
    const n = p.userRatingCount ?? 0;
    return r * Math.log10(n + 10);
  };
  const out: CityReferenceRow[] = [];
  // Dedupe global por chave semântica (mesmo lugar em variantes de nome).
  // Mantém o de maior score. Aplica ANTES de cortar top N para não desperdiçar
  // slots com duplicatas (Cataratas / Iguazzu Falls / Iguazu National Park ...).
  const globalDedupe = new Map<string, { p: PlaceRaw & { formattedAddress?: string; _cat: TypeMapEntry }; score: number }>();
  for (const cat of targetTypes) {
    const arr = byCategory.get(cat.type) ?? [];
    for (const p of arr) {
      const key = dedupeKey(p.displayName?.text ?? "");
      if (!key) continue;
      const score = qualityScore(p);
      const prev = globalDedupe.get(key);
      if (!prev || score > prev.score) globalDedupe.set(key, { p, score });
    }
  }
  const survivorIds = new Set(Array.from(globalDedupe.values()).map((v) => v.p.id));

  for (const cat of targetTypes) {
    const arr = (byCategory.get(cat.type) ?? [])
      .filter((p) => survivorIds.has(p.id))
      .sort((a, b) => qualityScore(b) - qualityScore(a))
      .slice(0, CITY_MAX_PER_TYPE);

    // Desambiguação por nome: se houver mais de um lugar com o mesmo nome
    // normalizado, anexa o sufixo de localidade (Estado/País) ao nome.
    const normalize = (s: string) =>
      s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
    const nameCounts = new Map<string, number>();
    for (const p of arr) {
      const nm = normalize(p.displayName?.text ?? "");
      nameCounts.set(nm, (nameCounts.get(nm) ?? 0) + 1);
    }

    for (const p of arr) {
      const rawName = p.displayName?.text ?? "Sem nome";
      const nm = normalize(rawName);
      const needsSuffix = (nameCounts.get(nm) ?? 0) > 1;
      const suffix = needsSuffix ? extractLocationSuffix(p.formattedAddress) : "";
      const finalName = suffix ? `${rawName} (${suffix})` : rawName;

      out.push({
        place_id: p.id!,
        category: p._cat.category,
        type: p._cat.type,
        name: finalName,
        note: buildNote(p),
        address: p.formattedAddress ?? null,
        rating: typeof p.rating === "number" ? Number(p.rating.toFixed(1)) : null,
        user_ratings_total: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
        primary_type: p.primaryType ?? null,
        lat: p.location!.latitude,
        lng: p.location!.longitude,
        image_url: pickBestPlacePhoto(p.photos),
        maps_url: p.googleMapsUri ?? `https://www.google.com/maps/search/?api=1&query_place_id=${p.id}`,
        opening_hours: p.regularOpeningHours?.weekdayDescriptions ?? null,
      });
    }
  }

  console.log(
    `[CityRefs] ${cityQ} center=${cityCenter ? `${cityCenter.lat.toFixed(3)},${cityCenter.lng.toFixed(3)}` : "null"} `
    + `drop=${JSON.stringify(drop)} out=${out.length}`,
  );

  return out;
}


// Geocoder público — usado para validar/centralizar uma cidade quando admin
// cadastra manualmente. Reaproveita o geocode existente.
export async function resolveCityCenter(
  city_label: string,
  state: string | null,
  country: string,
): Promise<{ lat: number; lng: number } | null> {
  const q = [city_label, state, country].filter(Boolean).join(", ");
  const g = await geocodeText(q);
  if (!g?.geometry?.location) return null;
  return { lat: g.geometry.location.lat, lng: g.geometry.location.lng };
}

// Atualiza city_references (todos os place_id, manuais e auto) puxando os dados
// frescos do Google. Chamado pelo cron diário. Atualiza nome, nota, descrição,
// foto, horários, link e total de avaliações.
export async function refreshStaleCityReferencesByPlaceId(limit: number) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const cap = Math.max(1, Math.min(500, limit));
  const { data: refs, error } = await supabaseAdmin
    .from("city_references")
    .select("id, place_id")
    .not("place_id", "is", null)
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(cap);
  if (error) throw error;
  const list = (refs ?? []).filter((r) => !!(r as { place_id: string | null }).place_id) as Array<{ id: string; place_id: string }>;
  if (list.length === 0) return { updated: 0, failed: 0, total: 0 };

  let updated = 0;
  let failed = 0;
  const BATCH = 5;
  for (let i = 0; i < list.length; i += BATCH) {
    const slice = list.slice(i, i + BATCH);
    await Promise.all(
      slice.map(async (r) => {
        try {
          const p = await fetchPlaceDetails(r.place_id);
          if (!p || !p.location) {
            failed += 1;
            await supabaseAdmin
              .from("city_references")
              .update({ last_synced_at: new Date().toISOString() })
              .eq("id", r.id);
            return;
          }
          const noteText = p.editorialSummary?.text ?? p.generativeSummary?.overview?.text ?? null;
          const note = noteText && noteText.length > 240 ? noteText.slice(0, 237).trimEnd() + "…" : noteText;
          const patch: Record<string, unknown> = {
            // NOTE: nome NUNCA é atualizado automaticamente — pode estar personalizado pelo usuário.
            rating: typeof p.rating === "number" ? Number(p.rating.toFixed(1)) : null,
            user_ratings_total: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
            opening_hours: p.regularOpeningHours?.weekdayDescriptions ?? null,
            image_url: pickBestPlacePhoto(p.photos) ?? undefined,
            note,
            primary_type: p.primaryType ?? undefined,
            maps_url: p.googleMapsUri ?? `https://www.google.com/maps/search/?api=1&query_place_id=${p.id}`,
            lat: p.location.latitude,
            lng: p.location.longitude,
            last_synced_at: new Date().toISOString(),
          };
          for (const k of Object.keys(patch)) {
            if (patch[k] === undefined) delete patch[k];
          }
          const { error: upErr } = await supabaseAdmin
            .from("city_references")
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .update(patch as any)
            .eq("id", r.id);
          if (upErr) { failed += 1; return; }
          updated += 1;
        } catch {
          failed += 1;
        }
      }),
    );
  }
  return { updated, failed, total: list.length };
}
