/**
 * ORIGEM do imóvel para as ferramentas de consulta da IA (Google Places / rotas, 07/11/2026) — somente
 * leitura, projeção própria (`PROPERTY_ORIGIN_COLUMNS`: coordenadas do cadastro + cidade/estado/país).
 *
 * - Imóvel SEMPRE o do turno validado, com posse conferida pelo `owner_id`; nunca parâmetro do modelo.
 * - Coordenadas inválidas (fora do intervalo, 0,0 ou ausentes) ⇒ `origin: null` (rotas indisponíveis).
 * - Falha de leitura ⇒ `null` (as ferramentas ficam desligadas no turno; o turno segue). Só o cancelamento
 *   interrompe (`GuestAiAbortedError`).
 */
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import { assertIssued } from "@/lib/guest-ai/trust";
import {
  GuestAiAbortedError,
  abortableDb,
  getGuestAiDb,
  throwIfAborted,
  type GuestAiDb,
} from "./client.server";
import { PROPERTY_ORIGIN_COLUMNS, cols } from "./projections";

export interface PropertyOrigin {
  origin: { lat: number; lng: number } | null;
  city: string | null;
  region: string | null;
  country: string | null;
}

const str = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

/** Coordenada válida do cadastro (pura; exportada para teste). */
export function originFrom(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const a = typeof lat === "number" ? lat : typeof lat === "string" ? Number(lat) : NaN;
  const b = typeof lng === "number" ? lng : typeof lng === "string" ? Number(lng) : NaN;
  if (
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    Math.abs(a) > 90 ||
    Math.abs(b) > 180 ||
    (a === 0 && b === 0)
  )
    return null;
  return { lat: a, lng: b };
}

export async function fetchPropertyOrigin(
  turn: ValidatedTurn,
  deps: { db?: GuestAiDb; signal?: AbortSignal } = {},
): Promise<PropertyOrigin | null> {
  assertIssued("turn", turn, "data_requires_validated_turn");
  throwIfAborted(deps.signal);
  const db = abortableDb(deps.db ?? (await getGuestAiDb()), deps.signal);
  try {
    const res = await db
      .from("properties")
      .select(cols(PROPERTY_ORIGIN_COLUMNS))
      .eq("id", turn.propertyId)
      .maybeSingle();
    throwIfAborted(deps.signal);
    if (res.error) return null;
    const p = res.data as Record<string, unknown> | null;
    if (!p || p["id"] !== turn.propertyId || p["owner_id"] !== turn.tenantId) return null;
    return {
      origin: originFrom(p["lat"], p["lng"]),
      city: str(p["city"], 80),
      region: str(p["state"], 80),
      country: str(p["country"], 60),
    };
  } catch (e) {
    if (e instanceof GuestAiAbortedError || deps.signal?.aborted) throw new GuestAiAbortedError();
    return null;
  }
}
