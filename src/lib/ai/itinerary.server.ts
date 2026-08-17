/**
 * Itinerário vivo do hóspede — a IA vai construindo e ajustando ao longo da
 * conversa (ferramentas add/remove_itinerary_item), e o hóspede acompanha
 * numa tela própria do guia. Uma linha por (imóvel, hóspede); o conteúdo
 * inteiro fica no JSONB `days`, reescrito a cada mudança.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type Admin = SupabaseClient;

export type ItineraryItem = {
  id: string;
  time: string | null; // "HH:MM" ou null (sem horário definido)
  title: string;
  note: string | null;
  /** De onde veio a sugestão original — auditoria/anti-alucinação. */
  source: "recommendation" | "maps" | "guest_request" | "ai";
};

export type ItineraryDay = {
  date: string; // "YYYY-MM-DD"
  items: ItineraryItem[];
};

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export async function getItinerary(params: {
  supabase: Admin;
  propertyId: string;
  guestKey: string;
}): Promise<ItineraryDay[]> {
  const { data } = await params.supabase
    .from("guest_itineraries")
    .select("days")
    .eq("property_id", params.propertyId)
    .eq("guest_key", params.guestKey)
    .maybeSingle();
  return Array.isArray(data?.days) ? (data!.days as ItineraryDay[]) : [];
}

async function saveItinerary(params: {
  supabase: Admin;
  propertyId: string;
  ownerId: string;
  guestKey: string;
  guestName: string | null;
  days: ItineraryDay[];
}): Promise<void> {
  await params.supabase.from("guest_itineraries").upsert(
    {
      property_id: params.propertyId,
      owner_id: params.ownerId,
      guest_key: params.guestKey,
      guest_name: params.guestName,
      days: params.days,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "property_id,guest_key" },
  );
}

export async function addItineraryItem(params: {
  supabase: Admin;
  propertyId: string;
  ownerId: string;
  guestKey: string;
  guestName: string | null;
  date: string;
  time: string | null;
  title: string;
  note: string | null;
  source: ItineraryItem["source"];
}): Promise<ItineraryDay[]> {
  const days = await getItinerary(params);
  let day = days.find((d) => d.date === params.date);
  if (!day) {
    day = { date: params.date, items: [] };
    days.push(day);
    days.sort((a, b) => a.date.localeCompare(b.date));
  }
  day.items.push({
    id: randomId(),
    time: params.time,
    title: params.title.slice(0, 140),
    note: params.note ? params.note.slice(0, 300) : null,
    source: params.source,
  });
  day.items.sort((a, b) => (a.time ?? "99:99").localeCompare(b.time ?? "99:99"));
  await saveItinerary({ ...params, days });
  return days;
}

export async function removeItineraryItem(params: {
  supabase: Admin;
  propertyId: string;
  ownerId: string;
  guestKey: string;
  guestName: string | null;
  itemId: string;
}): Promise<{ days: ItineraryDay[]; removed: boolean }> {
  const days = await getItinerary(params);
  let removed = false;
  for (const day of days) {
    const before = day.items.length;
    day.items = day.items.filter((it) => it.id !== params.itemId);
    if (day.items.length !== before) removed = true;
  }
  if (removed) await saveItinerary({ ...params, days });
  return { days, removed };
}
