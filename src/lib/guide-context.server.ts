/**
 * CONTEXTO DO ITEM CLICADO NO GUIA (Pilar 4, 06/11/2026) — conferido no servidor antes de gravar.
 *
 * O guia manda só o TIPO e o ID do item tocado (evento da Home ou recomendação do Explorar). Nada do que o
 * aparelho manda como nome ou categoria é gravado: o servidor localiza o item nos dados reais DESTE imóvel e
 * grava o nome e a categoria oficiais. Item inexistente, de outro imóvel, vencido ou id fora do formato ⇒
 * nada é gravado (a mensagem segue normal, sem contexto). Nunca lança.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { cityKey } from "@/lib/city-key";
import { NEWS_LOOKBACK_DAYS, addDaysIso, cityNewsItemId, filterUpcoming } from "@/lib/city-news-window";
import { propertyTimeZone, todayInTZ } from "@/lib/property-timezone";

export type GuideContextInput = { kind: "city_event" | "place"; id: string };
export type GuideContextStored = {
  kind: "city_event" | "place";
  id: string;
  name: string;
  type: string | null;
  category: string | null;
};

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const EVENT_ID = /^evt-[0-9a-f]{8}$/;
const PLACE_ID = new RegExp(`^(rec|cref):(${UUID})$`, "i");

/** Forma do pedido (pura). Qualquer outra coisa ⇒ null. */
export function parseGuideContextInput(v: unknown): GuideContextInput | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const id = typeof o["id"] === "string" ? o["id"].trim() : "";
  if (o["kind"] === "city_event" && EVENT_ID.test(id)) return { kind: "city_event", id };
  if (o["kind"] === "place" && PLACE_ID.test(id)) return { kind: "place", id: id.toLowerCase() };
  return null;
}

const s = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export async function resolveGuideContext(
  db: SupabaseClient,
  prop: { id: string; city: string | null; country: string | null },
  input: GuideContextInput,
  now: Date = new Date(),
): Promise<GuideContextStored | null> {
  try {
    if (input.kind === "city_event") {
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
      ) as Array<{ title?: string | null; category?: string | null; startDate?: string | null; endDate?: string | null }>;
      const hit = filterUpcoming(items, today).find((it) => s(it.title, 200) && cityNewsItemId(it) === input.id);
      if (!hit) return null;
      const category = s(hit.category, 80);
      return { kind: "city_event", id: input.id, name: s(hit.title, 200)!, type: category, category };
    }

    const m = PLACE_ID.exec(input.id)!;
    const [prefix, rowId] = [m[1]!.toLowerCase(), m[2]!.toLowerCase()];
    if (prefix === "rec") {
      const { data, error } = await db
        .from("property_recommendations")
        .select("id, property_id, scope, name, type, category")
        .eq("id", rowId)
        .eq("property_id", prop.id)
        .eq("scope", "nearby")
        .maybeSingle();
      const r = data as Record<string, unknown> | null;
      if (error || !r || !s(r["name"], 200)) return null;
      return { kind: "place", id: `rec:${rowId}`, name: s(r["name"], 200)!, type: s(r["type"], 40), category: s(r["category"], 80) };
    }
    // referência da cidade: mesma resolução do guia público (grupo vinculado ou o próprio imóvel)
    const { data: member } = await db
      .from("city_reference_group_members")
      .select("group_id")
      .eq("property_id", prop.id)
      .maybeSingle();
    const groupId = (member as { group_id?: string | null } | null)?.group_id ?? null;
    let q = db
      .from("city_references")
      .select("id, property_id, group_id, name, type, category, is_hidden")
      .eq("id", rowId)
      .eq("is_hidden", false);
    q = groupId ? q.eq("group_id", groupId) : q.eq("property_id", prop.id).is("group_id", null);
    const { data, error } = await q.maybeSingle();
    const r = data as Record<string, unknown> | null;
    if (error || !r || !s(r["name"], 200)) return null;
    return { kind: "place", id: `cref:${rowId}`, name: s(r["name"], 200)!, type: s(r["type"], 40), category: s(r["category"], 80) };
  } catch {
    return null;
  }
}
