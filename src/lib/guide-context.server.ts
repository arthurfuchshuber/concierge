/**
 * CONTEXTO DO ITEM CLICADO NA PÁGINA PRINCIPAL DO GUIA (Pilar 4) — conferido no servidor antes de gravar.
 *
 * Só os eventos da página principal ("O que rola na cidade") abrem o chat com contexto; o Explorar não abre o
 * chat (auditoria do PR #10, 07/11/2026: tocar no card continua abrindo o Google Maps).
 *
 * O guia manda só o TIPO e o ID do evento. Nada do que o aparelho manda como nome ou categoria é gravado: o
 * servidor localiza o evento na edição vigente da cidade DESTE imóvel (mesma janela do feed) e grava o título e
 * a categoria oficiais. Evento inexistente, de outra cidade, vencido ou id fora do formato ⇒ nada é gravado (a
 * mensagem segue normal, sem contexto). Nunca lança.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { cityKey } from "@/lib/city-key";
import {
  NEWS_LOOKBACK_DAYS,
  addDaysIso,
  cityNewsItemId,
  filterUpcoming,
} from "@/lib/city-news-window";
import { propertyTimeZone, todayInTZ } from "@/lib/property-timezone";

export type GuideContextInput = { kind: "city_event"; id: string };
export type GuideContextStored = {
  kind: "city_event";
  id: string;
  name: string;
  type: string | null;
  category: string | null;
};

const EVENT_ID = /^evt-[0-9a-f]{8}$/;

/** Forma do pedido (pura). Qualquer outra coisa ⇒ null. */
export function parseGuideContextInput(v: unknown): GuideContextInput | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const id = typeof o["id"] === "string" ? o["id"].trim() : "";
  return o["kind"] === "city_event" && EVENT_ID.test(id) ? { kind: "city_event", id } : null;
}

const s = (v: unknown, max: number) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

export async function resolveGuideContext(
  db: SupabaseClient,
  prop: { id: string; city: string | null; country: string | null },
  input: GuideContextInput,
  now: Date = new Date(),
): Promise<GuideContextStored | null> {
  try {
    const key = cityKey(prop.city);
    if (!key) return null;
    const today = todayInTZ(propertyTimeZone(prop.city, prop.country), now);
    const { data, error } = await db
      .from("city_daily_news")
      .select("items, date")
      .eq("city_key", key)
      .gte("date", addDaysIso(today, -NEWS_LOOKBACK_DAYS))
      .lte("date", today)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data || !Array.isArray((data as { items?: unknown }).items)) return null;
    const items = ((data as { items: unknown[] }).items as Array<Record<string, unknown>>).filter(
      (x) => x && typeof x === "object",
    ) as Array<{
      title?: string | null;
      category?: string | null;
      startDate?: string | null;
      endDate?: string | null;
    }>;
    const hit = filterUpcoming(items, today).find(
      (it) => s(it.title, 200) && cityNewsItemId(it) === input.id,
    );
    if (!hit) return null;
    const category = s(hit.category, 80);
    return { kind: "city_event", id: input.id, name: s(hit.title, 200)!, type: category, category };
  } catch {
    return null;
  }
}
