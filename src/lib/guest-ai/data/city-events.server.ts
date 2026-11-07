/**
 * EVENTOS DA CIDADE para a IA — LEITURA da mesma edição que a Home do Guia Digital mostra ("O que rola na
 * cidade", `city_daily_news`), somente leitura e com projeção própria (Pilar 1, 06/11/2026).
 *
 * - Cidade SEMPRE do imóvel do turno validado (posse conferida pelo `owner_id`), nunca de parâmetro.
 * - Mesma regra de janela do feed público (`filterUpcoming`): nada que já aconteceu, evento só com data.
 * - Vão para a IA: id estável (o mesmo que o guia usa ao abrir o chat), título, categoria, datas, local e o
 *   resumo da curadoria. FORA: links de fonte e imagens (nenhum link externo chega ao modelo por aqui).
 * - Enriquecimento: falha de leitura ⇒ `unavailable` (a IA diz que não tem a informação), nunca derruba o
 *   turno. Só o cancelamento interrompe (`GuestAiAbortedError`).
 */
import { cityKey } from "@/lib/city-key";
import { NEWS_LOOKBACK_DAYS, addDaysIso, cityNewsItemId, filterUpcoming } from "@/lib/city-news-window";
import { propertyTimeZoneOrNull, todayInTZ } from "@/lib/property-timezone";
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import { assertIssued } from "@/lib/guest-ai/trust";
import { GuestAiAbortedError, abortableDb, getGuestAiDb, throwIfAborted, type GuestAiDb } from "./client.server";
import { CITY_NEWS_COLUMNS, PROPERTY_CITY_COLUMNS, cols } from "./projections";

/** Teto de itens levados ao modelo (a Home raramente passa de 25). */
export const CITY_EVENTS_MAX = 30;

export interface CityEvent {
  id: string;
  title: string;
  category: string;
  startDate: string | null;
  endDate: string | null;
  venue: string | null;
  summary: string | null;
}

export type CityEventsLoad =
  | { status: "available"; city: string; today: string; items: CityEvent[] }
  | { status: "unavailable"; reason: "no_city" | "no_timezone" | "no_edition" | "lookup_failed" };

const str = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

/** Normaliza a edição gravada (pura; exportada para teste). */
export function normalizeCityEvents(raw: unknown, today: string): CityEvent[] {
  if (!Array.isArray(raw)) return [];
  const items = raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({
      title: str(x["title"], 200),
      category: str(x["category"], 40) ?? "outro",
      startDate: str(x["startDate"], 10),
      endDate: str(x["endDate"], 10),
      venue: str(x["venue"], 200),
      summary: str(x["summary"], 600),
    }))
    .filter((x): x is typeof x & { title: string } => !!x.title);
  const seen = new Set<string>();
  const out: CityEvent[] = [];
  for (const it of filterUpcoming(items, today)) {
    const id = cityNewsItemId(it);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, ...it });
    if (out.length >= CITY_EVENTS_MAX) break;
  }
  return out;
}

export async function fetchCityEvents(
  turn: ValidatedTurn,
  deps: { db?: GuestAiDb; signal?: AbortSignal; now?: Date } = {},
): Promise<CityEventsLoad> {
  assertIssued("turn", turn, "data_requires_validated_turn");
  throwIfAborted(deps.signal);
  const db = abortableDb(deps.db ?? (await getGuestAiDb()), deps.signal);
  try {
    const prop = await db
      .from("properties")
      .select(cols(PROPERTY_CITY_COLUMNS))
      .eq("id", turn.propertyId)
      .maybeSingle();
    if (prop.error) return { status: "unavailable", reason: "lookup_failed" };
    const p = prop.data as Record<string, unknown> | null;
    if (!p || p["id"] !== turn.propertyId || p["owner_id"] !== turn.tenantId)
      return { status: "unavailable", reason: "lookup_failed" };
    const city = str(p["city"], 80);
    const key = cityKey(city);
    if (!city || !key) return { status: "unavailable", reason: "no_city" };
    // fuso comprovado do imóvel (sem padrão presumido — mesma regra do módulo)
    const tz = propertyTimeZoneOrNull(city, str(p["country"], 40));
    if (!tz) return { status: "unavailable", reason: "no_timezone" };
    const today = todayInTZ(tz, deps.now ?? new Date());
    const ed = await db
      .from("city_daily_news")
      .select(cols(CITY_NEWS_COLUMNS))
      .eq("city_key", key)
      .gte("date", addDaysIso(today, -NEWS_LOOKBACK_DAYS))
      .lte("date", today)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();
    throwIfAborted(deps.signal);
    if (ed.error) return { status: "unavailable", reason: "lookup_failed" };
    const row = ed.data as Record<string, unknown> | null;
    if (!row) return { status: "unavailable", reason: "no_edition" };
    return { status: "available", city, today, items: normalizeCityEvents(row["items"], today) };
  } catch (e) {
    if (e instanceof GuestAiAbortedError || deps.signal?.aborted) throw new GuestAiAbortedError();
    return { status: "unavailable", reason: "lookup_failed" };
  }
}
