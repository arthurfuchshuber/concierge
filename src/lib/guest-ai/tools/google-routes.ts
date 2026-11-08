/**
 * Ferramenta `calculate_property_distance` — distância REAL de trajeto a partir da porta do imóvel.
 *
 * - Origem: SEMPRE as coordenadas do cadastro do imóvel do turno (`GuestToolContext.origin`); o modelo
 *   nunca escolhe a origem. Sem coordenadas ⇒ `sem_origem` (a IA não fala em metros).
 * - Destino: endereço/nome do lugar ou "lat,lng". Texto sem a cidade recebe a cidade do imóvel, para o
 *   Google não resolver um homônimo em outro lugar.
 * - Modo: trajeto a pé primeiro; até 1 km vale a pé, acima disso vale o trajeto de carro (sem rota de
 *   carro, fica o a pé). Distância Matrix do Google pelo mesmo gateway do Maps.
 * - Devolve só distância (metros + texto "420 m" / "1,8 km") e modalidade. NUNCA tempo de deslocamento.
 * - Trajeto acima de `ROUTE_MAX_PLAUSIBLE_M` ⇒ `sem_rota` (sinal de que o Google achou outro lugar).
 */
import { parseDistanceMatrix, type LatLng } from "@/lib/route-distance";
import type { GuestTool, GuestToolContext, MapsHttp, ToolResult } from "./contracts";

export const WALK_LIMIT_M = 1_000;
export const ROUTE_MAX_PLAUSIBLE_M = 150_000;
/** Destinos por consulta (a ferramenta de lugares mede vários de uma vez). */
export const ROUTE_MAX_BATCH = 10;

export type Destination = LatLng | string;
export type PropertyRoute = { meters: number; text: string; mode: "a_pe" | "carro" };

const COORDS = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

export function validPoint(p: LatLng | null | undefined): p is LatLng {
  return (
    !!p &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180 &&
    !(p.lat === 0 && p.lng === 0)
  );
}

/** "420 m" até 1 km; acima, "1,8 km" (uma casa decimal, vírgula). */
export function formatDistance(meters: number): string {
  if (meters < 1_000) return `${Math.max(1, Math.round(meters))} m`;
  return `${(meters / 1_000).toFixed(1).replace(".", ",")} km`;
}

/** Destino textual com a cidade do imóvel quando ela não foi citada (evita homônimos). */
export function anchoredDestination(
  dest: string,
  ctx: Pick<GuestToolContext, "city" | "region" | "country">,
): string {
  const m = COORDS.exec(dest);
  if (m) return `${Number(m[1]).toFixed(6)},${Number(m[2]).toFixed(6)}`;
  const clean = dest.replace(/\s+/g, " ").trim();
  const city = ctx.city?.trim();
  if (!city || clean.toLowerCase().includes(city.toLowerCase())) return clean;
  return [clean, city, ctx.region?.trim(), ctx.country?.trim()].filter(Boolean).join(", ");
}

function destParam(d: Destination): string {
  return typeof d === "string" ? d : `${d.lat.toFixed(6)},${d.lng.toFixed(6)}`;
}

function matrixPath(
  origin: LatLng,
  dests: readonly Destination[],
  mode: "walking" | "driving",
): string {
  const q = new URLSearchParams({
    origins: `${origin.lat.toFixed(6)},${origin.lng.toFixed(6)}`,
    destinations: dests.map(destParam).join("|"),
    mode,
    units: "metric",
  });
  return `/maps/api/distancematrix/json?${q.toString()}`;
}

async function matrix(
  http: MapsHttp,
  origin: LatLng,
  dests: readonly Destination[],
  mode: "walking" | "driving",
  signal: AbortSignal,
) {
  const res = await http(matrixPath(origin, dests, mode), { method: "GET", signal });
  if (!res.ok) throw new Error("maps_http_error");
  return parseDistanceMatrix(await res.json(), dests.length, mode);
}

/**
 * Trajeto real do imóvel até cada destino (mesma ordem). `null` onde não há rota confiável.
 * Lança só em falha de rede/HTTP (o chamador converte em `indisponivel`).
 */
export async function routesFromProperty(
  origin: LatLng,
  dests: readonly Destination[],
  http: MapsHttp,
  signal: AbortSignal,
): Promise<Array<PropertyRoute | null>> {
  if (!validPoint(origin) || dests.length === 0) return dests.map(() => null);
  const batch = dests.slice(0, ROUTE_MAX_BATCH);
  const walk = await matrix(http, origin, batch, "walking", signal);
  const far = batch.map((_, i) => i).filter((i) => !walk[i] || walk[i]!.meters >= WALK_LIMIT_M);
  const drive: Array<{ meters: number } | null> = batch.map(() => null);
  if (far.length > 0) {
    try {
      const d = await matrix(
        http,
        origin,
        far.map((i) => batch[i]!),
        "driving",
        signal,
      );
      far.forEach((i, k) => (drive[i] = d[k] ? { meters: d[k]!.meters } : null));
    } catch (e) {
      if (signal.aborted) throw e;
      // sem trajeto de carro: os destinos longe ficam com o trajeto a pé (quando houver)
    }
  }
  const out: Array<PropertyRoute | null> = batch.map((_, i) => {
    const w = walk[i];
    const d = drive[i];
    let meters: number | null = null;
    let mode: "a_pe" | "carro" = "a_pe";
    if (w && w.meters < WALK_LIMIT_M) meters = w.meters;
    else if (d) {
      meters = d.meters;
      mode = "carro";
    } else if (w) meters = w.meters;
    if (meters === null || meters > ROUTE_MAX_PLAUSIBLE_M) return null;
    return { meters, text: formatDistance(meters), mode };
  });
  return [...out, ...dests.slice(ROUTE_MAX_BATCH).map(() => null)];
}

export interface DistanceArgs {
  destination: string;
}

export const calculatePropertyDistance: GuestTool<DistanceArgs> = {
  spec: {
    name: "calculate_property_distance",
    description:
      "Calcula a distância REAL de trajeto (Google Maps) da porta do imóvel do hóspede até um destino. Use antes de citar metros ou quilômetros de um lugar que não veio com distância. Devolve só distância e modalidade (a pé até 1 km; acima, de carro); nunca tempo.",
    parameters: {
      type: "object",
      properties: {
        destination_address_or_coords: {
          type: "string",
          description: "Nome oficial do lugar com endereço, ou coordenadas no formato 'lat,lng'.",
        },
      },
      required: ["destination_address_or_coords"],
      additionalProperties: false,
    },
  },
  parse(raw) {
    const r = raw as Record<string, unknown> | null;
    const d = r && typeof r === "object" ? r["destination_address_or_coords"] : undefined;
    if (typeof d !== "string") return null;
    const v = d.replace(/\s+/g, " ").trim();
    if (v.length < 3 || v.length > 200) return null;
    return { destination: v };
  },
  async execute(args, ctx, deps): Promise<ToolResult> {
    if (!ctx.origin || !validPoint(ctx.origin)) return { ok: false, erro: "sem_origem" };
    const [route] = await routesFromProperty(
      ctx.origin,
      [anchoredDestination(args.destination, ctx)],
      deps.http,
      deps.signal,
    );
    if (!route) return { ok: false, erro: "sem_rota" };
    return {
      ok: true,
      destino: args.destination,
      distancia_m: route.meters,
      distancia_texto: route.text,
      modalidade: route.mode,
    };
  },
};
