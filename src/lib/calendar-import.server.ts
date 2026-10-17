/* eslint-disable @typescript-eslint/no-explicit-any */
// Importação INSTANTÂNEA do calendário do Airbnb (via Channex). Somente leitura: o sistema guarda
// bloqueios manuais, reservas, disponibilidade e restrições como estão na plataforma, e nunca
// trava o calendário do anfitrião lá.
import { groupByShape, rowsFromAvailability, rowsFromRestrictions, rowsFromWebhook, type CalendarRow } from "@/lib/calendar-import";

async function admin(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

async function save(rows: Array<CalendarRow & { property_id?: string | null }>, source: string): Promise<number> {
  if (!rows.length) return 0;
  const sb = await admin();
  const now = new Date().toISOString();
  let saved = 0;
  for (const group of groupByShape(rows)) {
    for (let i = 0; i < group.length; i += 500) {
      const chunk = group.slice(i, i + 500).map((r) => ({ ...r, source, synced_at: now }));
      const { error } = await sb.from("channex_calendar_import").upsert(chunk as never, { onConflict: "rate_plan_id,date" });
      if (error) console.error("[calendar-import]", error.message);
      else saved += chunk.length;
    }
  }
  return saved;
}

/** Evento `ari` do webhook: grava o que mudou no calendário, na hora. */
export async function importAriWebhook(payload: unknown): Promise<number> {
  const rows = rowsFromWebhook(payload);
  if (!rows.length) return 0;
  const sb = await admin();
  const cpid = rows[0]!.channex_property_id;
  let propertyId: string | null = null;
  if (cpid) {
    const { data } = await sb.from("property_listing_raw_data").select("property_id").eq("channex_property_id", cpid);
    if (data && data.length === 1) propertyId = data[0].property_id as string;
  }
  if (!propertyId) {
    const { data } = await sb
      .from("property_listing_raw_data")
      .select("property_id")
      .in("channex_room_type_id", Array.from(new Set(rows.map((r) => r.room_type_id).filter(Boolean))))
      .limit(1);
    propertyId = (data?.[0]?.property_id as string | undefined) ?? null;
  }
  return save(rows.map((r) => ({ ...r, property_id: propertyId })), "webhook");
}

/** Janela completa de um imóvel (carga inicial e conferência periódica). */
export async function importCalendarWindow(propertyId: string, days = 500): Promise<number> {
  const sb = await admin();
  const { data: t } = await sb
    .from("property_listing_raw_data")
    .select("channex_property_id, channex_room_type_id, channex_rate_plan_id")
    .eq("property_id", propertyId)
    .maybeSingle();
  if (!t?.channex_property_id) return 0;
  const { channexGet } = await import("@/lib/channex-listing.server");
  const start = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  const q = `filter[property_id]=${t.channex_property_id}&filter[date][gte]=${start}&filter[date][lte]=${end}`;
  const restr = await channexGet<{ data: any }>(
    `/restrictions?${q}&filter[restrictions]=rate,min_stay_arrival,max_stay,stop_sell,closed_to_arrival,closed_to_departure`,
  ).catch(() => null);
  const avail = await channexGet<{ data: any }>(`/availability?${q}`).catch(() => null);
  const plansByRoom: Record<string, string[]> = {};
  if (t.channex_room_type_id && t.channex_rate_plan_id) plansByRoom[t.channex_room_type_id] = [t.channex_rate_plan_id];
  const rows = [
    ...rowsFromRestrictions(restr?.data, t.channex_property_id),
    ...rowsFromAvailability(avail?.data, t.channex_property_id, plansByRoom),
  ].map((r) => ({ ...r, property_id: propertyId }));
  return save(rows, "api");
}

/**
 * Rede de segurança (o webhook `ari` é o caminho principal e instantâneo): reimporta UM imóvel por
 * batida do cron se nada chegou nas últimas 24 h, ou se ele nunca foi importado.
 */
export async function importStaleCalendar(maxAgeMin = 1440): Promise<string | null> {
  const sb = await admin();
  const { data: props } = await sb.from("property_listing_raw_data").select("property_id").not("channex_property_id", "is", null);
  const ids = ((props ?? []) as Array<{ property_id: string }>).map((p) => p.property_id);
  if (!ids.length) return null;
  const { data: last } = await sb.from("channex_calendar_import").select("property_id, synced_at").in("property_id", ids).order("synced_at", { ascending: false }).limit(5000);
  const latest = new Map<string, number>();
  for (const r of (last ?? []) as Array<{ property_id: string; synced_at: string }>) if (!latest.has(r.property_id)) latest.set(r.property_id, Date.parse(r.synced_at));
  const cutoff = Date.now() - maxAgeMin * 60_000;
  const stale = ids.filter((id) => (latest.get(id) ?? 0) < cutoff).sort((a, b) => (latest.get(a) ?? 0) - (latest.get(b) ?? 0))[0];
  if (!stale) return null;
  await importCalendarWindow(stale);
  return stale;
}
