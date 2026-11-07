/**
 * Distância de TRAJETO (Google Maps) entre o imóvel e as recomendações — parte pura (sem rede).
 *
 * Diretriz de 06/11/2026 (Pilar 2): a distância informada ao hóspede é a do caminho real, não a linha reta.
 * Usamos a Distance Matrix do Google pelo mesmo gateway do Maps:
 *  - modo `walking` primeiro (caminho de pedestre: calçadas e travessias, sem rodovias — a rota mais segura
 *    para quem está a pé);
 *  - sem rota a pé para um destino, modo `driving` para aquele destino;
 *  - sem rota nenhuma, o chamador mantém a linha reta e grava `distance_kind = 'straight_line'`.
 * Até 25 destinos por chamada (limite da API). O tempo vem do próprio trajeto (`duration`), nunca de
 * velocidade presumida.
 */

export const ROUTE_MAX_DESTINATIONS = 25;

export type LatLng = { lat: number; lng: number };

export type RouteLeg = { meters: number; seconds: number | null; mode: "walking" | "driving" };

type MatrixElement = {
  status?: string;
  distance?: { value?: number };
  duration?: { value?: number };
};
export type DistanceMatrixResponse = {
  status?: string;
  rows?: Array<{ elements?: MatrixElement[] }>;
};

const coord = (p: LatLng) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

const validPoint = (p: LatLng | null | undefined): p is LatLng =>
  !!p &&
  Number.isFinite(p.lat) &&
  Number.isFinite(p.lng) &&
  Math.abs(p.lat) <= 90 &&
  Math.abs(p.lng) <= 180;

/** Caminho (path + query) da Distance Matrix no gateway do Maps. */
export function distanceMatrixPath(
  origin: LatLng,
  destinations: readonly LatLng[],
  mode: "walking" | "driving",
): string {
  if (!validPoint(origin)) throw new Error("route_origin_invalid");
  if (destinations.length === 0 || destinations.length > ROUTE_MAX_DESTINATIONS)
    throw new Error("route_destinations_invalid");
  if (!destinations.every(validPoint)) throw new Error("route_destination_invalid");
  const q = new URLSearchParams({
    origins: coord(origin),
    destinations: destinations.map(coord).join("|"),
    mode,
    units: "metric",
  });
  return `/maps/api/distancematrix/json?${q.toString()}`;
}

/** Lê a resposta: um trecho por destino (na mesma ordem), `null` onde não há rota. Nunca lança. */
export function parseDistanceMatrix(
  json: unknown,
  count: number,
  mode: "walking" | "driving",
): Array<RouteLeg | null> {
  const out: Array<RouteLeg | null> = Array.from({ length: count }, () => null);
  const r = json as DistanceMatrixResponse | null;
  if (!r || r.status !== "OK" || !Array.isArray(r.rows) || r.rows.length < 1) return out;
  const elements = r.rows[0]?.elements;
  if (!Array.isArray(elements)) return out;
  for (let i = 0; i < count; i += 1) {
    const e = elements[i];
    const meters = e?.distance?.value;
    if (!e || e.status !== "OK" || typeof meters !== "number" || !Number.isFinite(meters) || meters < 0)
      continue;
    const secs = e.duration?.value;
    out[i] = {
      meters: Math.round(meters),
      seconds: typeof secs === "number" && Number.isFinite(secs) && secs >= 0 ? Math.round(secs) : null,
      mode,
    };
  }
  return out;
}

/**
 * Valores gravados na recomendação a partir do trajeto (mesmo formato de texto que o guia já exibe, para não
 * mudar nada visualmente): a pé até 1,5 km; acima disso, minutos de carro do trajeto de carro, quando houver.
 */
export function routeFields(
  walk: RouteLeg,
  drive: RouteLeg | null,
): {
  distance_meters: number;
  distance_text: string;
  walk_minutes: number | null;
  drive_minutes: number | null;
  distance_kind: "route";
} {
  const meters = walk.meters;
  const walkMin =
    walk.mode === "walking" && walk.seconds !== null ? Math.max(1, Math.round(walk.seconds / 60)) : null;
  const driveLeg = walk.mode === "driving" ? walk : drive;
  const driveMin =
    driveLeg && driveLeg.seconds !== null ? Math.max(1, Math.round(driveLeg.seconds / 60)) : null;
  const km = (meters / 1000).toFixed(1);
  let text: string;
  if (meters < 1000) text = walkMin !== null ? `${meters} m · ${walkMin} min a pé` : `${meters} m`;
  else if (meters <= 1500 || driveMin === null)
    text = walkMin !== null ? `${km} km · ${walkMin} min a pé` : `${km} km`;
  else text = `${km} km · ${driveMin} min de carro`;
  return {
    distance_meters: meters,
    distance_text: text,
    walk_minutes: walkMin,
    drive_minutes: meters > 1500 ? driveMin : null,
    distance_kind: "route",
  };
}

/** Linha da recomendação já gravada (o que o servidor confirmou na última sincronização). */
export type StoredRouteRow = {
  scope: string | null;
  place_id: string | null;
  distance_kind: string | null;
  distance_meters: number | null;
  distance_text: string | null;
  walk_minutes: number | null;
  drive_minutes: number | null;
  last_synced_at: string | null;
};

/**
 * O editor do guia regrava a lista inteira a cada salvamento. A distância que vem do aparelho NUNCA é marcada
 * como trajeto (`distance_kind` fica nulo); para o mesmo lugar (scope + place_id) que o servidor já tinha
 * confirmado por rota, a medição do servidor é mantida no lugar da do aparelho.
 */
export function carryServerRoutes<T extends { scope?: unknown; place_id?: unknown }>(
  before: readonly StoredRouteRow[],
  incoming: readonly T[],
): Array<T & Partial<Omit<StoredRouteRow, "scope" | "place_id">>> {
  const confirmed = new Map<string, StoredRouteRow>();
  for (const b of before) {
    if (b.distance_kind === "route" && b.place_id && typeof b.distance_meters === "number")
      confirmed.set(`${b.scope ?? ""}:${b.place_id}`, b);
  }
  return incoming.map((r) => {
    const { distance_kind: _ignored, ...rest } = r as T & { distance_kind?: unknown };
    const key = typeof r.place_id === "string" && r.place_id ? `${String(r.scope ?? "")}:${r.place_id}` : null;
    const b = key ? confirmed.get(key) : undefined;
    if (!b) return { ...(rest as T), distance_kind: null };
    return {
      ...(rest as T),
      distance_kind: "route",
      distance_meters: b.distance_meters,
      distance_text: b.distance_text,
      walk_minutes: b.walk_minutes,
      drive_minutes: b.drive_minutes,
      last_synced_at: b.last_synced_at,
    };
  });
}
