import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GATEWAY = "https://connector-gateway.lovable.dev/google_maps";

const InputSchema = z.object({
  mapsUrl: z.string().min(5).max(2048),
});

type PlaceItem = {
  place_id: string;
  name: string;
  rating: number | null;
  category: string;
  type: string;
  scope: "nearby" | "city";
  lat: number;
  lng: number;
  distance_meters: number;
  distance_text: string;
  drive_minutes: number | null;
  image_url: string | null;
  maps_url: string;
};

type EnrichResult = {
  address: string;
  lat: number;
  lng: number;
  city: string;
  country: string;
  recommendations: PlaceItem[];
};

const TYPE_MAP: { type: PlaceItem["type"]; placesTypes: string[]; category: string }[] = [
  { type: "restaurant", placesTypes: ["restaurant"], category: "Restaurantes" },
  { type: "bar", placesTypes: ["bar"], category: "Bares" },
  { type: "cafe", placesTypes: ["cafe", "coffee_shop"], category: "Cafés" },
  { type: "beach", placesTypes: ["beach"], category: "Praias" },
  { type: "attraction", placesTypes: ["tourist_attraction"], category: "Atrações" },
  { type: "market", placesTypes: ["supermarket", "grocery_store"], category: "Mercados" },
  { type: "pharmacy", placesTypes: ["pharmacy"], category: "Farmácias" },
  { type: "park", placesTypes: ["park"], category: "Parques" },
  { type: "nightlife", placesTypes: ["night_club"], category: "Vida noturna" },
  { type: "shopping", placesTypes: ["shopping_mall"], category: "Compras" },
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

function formatDistance(meters: number): { text: string; driveMin: number | null } {
  if (meters < 1000) return { text: `${meters} m`, driveMin: null };
  const km = meters / 1000;
  if (meters <= 1500) return { text: `${km.toFixed(1)} km a pé`, driveMin: null };
  // ~40 km/h average urban speed
  const driveMin = Math.max(2, Math.round((km / 40) * 60));
  return { text: `${km.toFixed(1)} km · ${driveMin} min de carro`, driveMin };
}

async function resolveShortUrl(url: string): Promise<string> {
  if (!/maps\.app\.goo\.gl|goo\.gl\/maps/.test(url)) return url;
  try {
    const res = await fetch(url, { method: "GET", redirect: "follow" });
    return res.url || url;
  } catch {
    return url;
  }
}

function extractCoords(url: string): { lat: number; lng: number } | null {
  const at = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (at) return { lat: parseFloat(at[1]), lng: parseFloat(at[2]) };
  const bang = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (bang) return { lat: parseFloat(bang[1]), lng: parseFloat(bang[2]) };
  const q = url.match(/[?&]q=(-?\d+\.\d+)[%2C,](-?\d+\.\d+)/);
  if (q) return { lat: parseFloat(q[1]), lng: parseFloat(q[2]) };
  return null;
}

async function gatewayFetch(path: string, init: RequestInit = {}) {
  const apiKey = process.env.LOVABLE_API_KEY;
  const mapsKey = process.env.GOOGLE_MAPS_API_KEY;
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

async function placesNearby(lat: number, lng: number, includedTypes: string[]) {
  const res = await gatewayFetch(`/places/v1/places:searchNearby`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.location,places.rating,places.googleMapsUri,places.photos",
    },
    body: JSON.stringify({
      includedTypes,
      maxResultCount: 8,
      locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: 1500 } },
    }),
  });
  if (!res.ok) return [];
  const j = (await res.json()) as { places?: PlaceRaw[] };
  return j.places ?? [];
}

async function placesText(query: string, lat: number, lng: number, includedType: string) {
  const res = await gatewayFetch(`/places/v1/places:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.location,places.rating,places.googleMapsUri,places.photos",
    },
    body: JSON.stringify({
      textQuery: query,
      includedType,
      maxResultCount: 8,
      locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 15000 } },
    }),
  });
  if (!res.ok) return [];
  const j = (await res.json()) as { places?: PlaceRaw[] };
  return j.places ?? [];
}

type PlaceRaw = {
  id: string;
  displayName?: { text?: string };
  location?: { latitude: number; longitude: number };
  rating?: number;
  googleMapsUri?: string;
  photos?: Array<{ name: string }>;
};

function buildPhotoUrl(photoName: string | undefined): string | null {
  if (!photoName) return null;
  // Photo URL via gateway, with browser key works for direct image fetch. Use server gateway path.
  const browserKey = process.env.GOOGLE_MAPS_BROWSER_KEY;
  if (!browserKey) return null;
  return `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=800&key=${browserKey}`;
}

export const enrichFromMapsLink = createServerFn({ method: "POST" })
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

    const recommendations: PlaceItem[] = [];
    const seen = new Set<string>();

    // 1) Nearby por categoria
    for (const cat of TYPE_MAP) {
      const items = await placesNearby(coords.lat, coords.lng, cat.placesTypes);
      for (const p of items) {
        if (!p.id || !p.location || seen.has(p.id)) continue;
        seen.add(p.id);
        const dist = haversineMeters(coords, { lat: p.location.latitude, lng: p.location.longitude });
        const { text, driveMin } = formatDistance(dist);
        recommendations.push({
          place_id: p.id,
          name: p.displayName?.text ?? "Sem nome",
          rating: typeof p.rating === "number" ? Number(p.rating.toFixed(1)) : null,
          category: cat.category,
          type: cat.type,
          scope: "nearby",
          lat: p.location.latitude,
          lng: p.location.longitude,
          distance_meters: dist,
          distance_text: text,
          drive_minutes: driveMin,
          image_url: buildPhotoUrl(p.photos?.[0]?.name),
          maps_url: p.googleMapsUri ?? `https://www.google.com/maps/search/?api=1&query_place_id=${p.id}`,
        });
      }
    }

    // 2) City-wide para os mesmos tipos, deduplicando
    if (city) {
      for (const cat of TYPE_MAP) {
        const primary = cat.placesTypes[0];
        const items = await placesText(`${cat.category} em ${city}`, coords.lat, coords.lng, primary);
        for (const p of items) {
          if (!p.id || !p.location || seen.has(p.id)) continue;
          const dist = haversineMeters(coords, { lat: p.location.latitude, lng: p.location.longitude });
          if (dist < 1500) continue; // pertence a "nearby"
          seen.add(p.id);
          const { text, driveMin } = formatDistance(dist);
          recommendations.push({
            place_id: p.id,
            name: p.displayName?.text ?? "Sem nome",
            rating: typeof p.rating === "number" ? Number(p.rating.toFixed(1)) : null,
            category: cat.category,
            type: cat.type,
            scope: "city",
            lat: p.location.latitude,
            lng: p.location.longitude,
            distance_meters: dist,
            distance_text: text,
            drive_minutes: driveMin,
            image_url: buildPhotoUrl(p.photos?.[0]?.name),
            maps_url: p.googleMapsUri ?? `https://www.google.com/maps/search/?api=1&query_place_id=${p.id}`,
          });
        }
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
      recommendations,
    };
  });
