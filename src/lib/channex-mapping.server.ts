/**
 * Mapeamento seguro de anúncios Airbnb na Channex.
 *
 * Um Room Type novo nasce com disponibilidade 0; mapear nesse estado faz o
 * Airbnb bloquear o calendário inteiro. Por isso, ANTES de mapear, abrimos
 * 1 vaga/dia por 365 dias (via outbox ARI, respeitando o limitador) e só
 * mapeamos depois que a Channex confirmou. Reservas reais continuam
 * bloqueando suas datas no Airbnb normalmente.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { applyCalendarChanges, flushAriOutbox } from "@/lib/channex-ari.server";

const CHANNEX_BASE = "https://app.channex.io/api/v1";

export type SafeMapTarget = {
  channelId: string;
  listingId: string;
  channexPropertyId: string;
  roomTypeId: string;
  ratePlanId: string;
  /** Imóvel no ConciergeIA (bloqueios e reservas locais também fecham datas). */
  propertyId?: string;
  /**
   * Anúncio gêmeo (mesma casa física) com unidade própria na Channex. As
   * reservas dele também fecham as datas deste anúncio, e vice-versa: cada
   * anúncio aparece sozinho no PriceLabs e os calendários travam juntos.
   */
  sibling?: { channexPropertyId: string; roomTypeId: string };
};

const AIRBNB_SIGMA = "9f7f35ab-3b40-4b84-8483-693122d9604b";
const AIRBNB_CLAYTON = "24c871d9-d6fd-46f5-944d-a38b8a4df189";

/** Monta os dois lados de um par de anúncios gêmeos, cada um apontando para o outro. */
function twinPair(
  a: Omit<SafeMapTarget, "sibling">,
  b: Omit<SafeMapTarget, "sibling" | "channelId" | "propertyId">,
): SafeMapTarget[] {
  return [
    { ...a, sibling: { channexPropertyId: b.channexPropertyId, roomTypeId: b.roomTypeId } },
    { ...b, channelId: a.channelId, propertyId: a.propertyId, sibling: { channexPropertyId: a.channexPropertyId, roomTypeId: a.roomTypeId } },
  ];
}

/** Anúncios liberados no piloto com seus IDs na Channex. */
export const PILOT_MAPPINGS: SafeMapTarget[] = [
  // Casa Charmosa ↔ Belíssima Casa
  ...twinPair(
    { channelId: AIRBNB_SIGMA, listingId: "1081915824812637088", channexPropertyId: "c1add170-eaed-42b8-bb12-dc2f3adcf9e3", roomTypeId: "763011b4-1941-4fa3-978a-641c8d0df782", ratePlanId: "164f4b12-c67c-4da9-aebc-ae093689b2e3", propertyId: "9a94ad7f-c259-4a66-aedf-c4e87c449d5c" },
    { listingId: "901415199481975174", channexPropertyId: "8509820d-fae1-4d88-a369-394a253abcb7", roomTypeId: "02c33006-7489-4987-a2f2-ff983295afc1", ratePlanId: "4d3bb035-f830-46b6-a087-52b2c228ae8e" },
  ),
  // Studio 101 ↔ Apartamento 101
  ...twinPair(
    { channelId: AIRBNB_CLAYTON, listingId: "1668247859065922881", channexPropertyId: "032fb0bc-9d2d-450f-9d9a-cf8da9b9ad60", roomTypeId: "f5911861-2f36-473a-943d-8c31598c22f6", ratePlanId: "d2275f4e-10fb-4b0a-9978-02fb2b6acf3a", propertyId: "3b1addff-85e6-488b-b019-bb0168df904c" },
    { listingId: "1792880398875841438", channexPropertyId: "0f4b07b8-b971-41c5-95c9-ccd151681a7f", roomTypeId: "96c805a1-11d5-4fe3-8f6c-30d0a7f88993", ratePlanId: "2612faa9-fedc-43de-a1eb-196465530666" },
  ),
  // Studio 102 ↔ Apartamento 102
  ...twinPair(
    { channelId: AIRBNB_CLAYTON, listingId: "1668250046816777608", channexPropertyId: "a9110e74-d7b2-4d72-8b9a-a38f7014f2dc", roomTypeId: "4151bb96-1bbc-4f75-b54a-e745408a00e1", ratePlanId: "232fc17c-2c39-4f55-8bde-861a78ae503b", propertyId: "4fe68806-2384-4cb5-9565-e3315eb4c4da" },
    { listingId: "1792882876333057974", channexPropertyId: "2016585c-1483-4015-9eca-bc1b9ae70499", roomTypeId: "643cd524-2b80-43cd-96ca-c1129ca64105", ratePlanId: "db8a76c4-40cf-4da9-8206-0eba3469d1db" },
  ),
  // Studio 103 ↔ Studio 103 Ponte da Amizade
  ...twinPair(
    { channelId: AIRBNB_CLAYTON, listingId: "1668251215421954022", channexPropertyId: "b94a9b9a-899f-438b-a0a2-3e2e84d31017", roomTypeId: "82acb151-c3b5-4b78-bcff-362ed42ac86b", ratePlanId: "75ba04db-e687-4fc8-9c5a-7dd43415b3ff", propertyId: "cc6fd3c8-dcb2-495c-83ff-936dd50f5f4f" },
    { listingId: "1792868987771365608", channexPropertyId: "6818915e-bd4a-4690-98a7-b9cbb6ff60e2", roomTypeId: "66fff8fa-20c8-49fb-89ca-77d7937ef051", ratePlanId: "8cef06d7-999c-43c3-9498-8a6b054869a9" },
  ),
];

async function call(method: string, path: string, body?: unknown): Promise<any> {
  const key = process.env["CHANNEX_API_KEY"] ?? process.env["CHANNEX_STAGING_API_KEY"];
  if (!key) throw new Error("Chave Channex ausente.");
  const res = await fetch(`${CHANNEX_BASE}${path}`, {
    method,
    headers: { "user-api-key": key, Accept: "application/json", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Channex ${res.status} em ${path}`);
  return json;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Garante calendário REAL aberto e só então mapeia. Idempotente. */
export async function safeMapAirbnbListing(t: SafeMapTarget, userId: string | null) {
  const channel = await call("GET", `/channels/${t.channelId}`);
  const mapped = (channel?.data?.attributes?.rate_plans ?? []).some(
    (r: any) => String(r.settings?.listing_id) === t.listingId,
  );
  // Já mapeado: só realinha a disponibilidade real (nunca abre datas reservadas).
  if (mapped) {
    const sync = await syncRealAvailability(t, userId);
    return { listingId: t.listingId, status: "already_mapped" as const, sync };
  }

  // 1) Disponibilidade REAL antes de mapear: reservas = 0, livres = 1.
  const pre = await syncRealAvailability(t, userId);
  if (!pre.ok) throw new Error("A Channex não confirmou o calendário; mapeamento cancelado para não bloquear o Airbnb.");

  // 2) Mapeia e carrega reservas futuras.
  await call("POST", `/channels/${t.channelId}/mappings`, { mapping: { rate_plan_id: t.ratePlanId, settings: { listing_id: t.listingId } } });
  await call("POST", `/channels/${t.channelId}/execute/load_future_reservations`, { listing_id: t.listingId }).catch(() => null);

  // 3) Recalcula com a janela exata do anfitrião e as reservas recém-importadas.
  const sync = await syncRealAvailability(t, userId);
  return { listingId: t.listingId, status: "mapped" as const, sync };
}

/** Noites ocupadas por reservas ativas de uma unidade na Channex (paginado). */
async function channexBookingNights(t: { channexPropertyId: string; roomTypeId: string }, nights: Set<string>) {
  for (let page = 1; page <= 50; page++) {
    const res = await call("GET", `/bookings?filter[property_id]=${t.channexPropertyId}&pagination[page]=${page}&pagination[limit]=100`);
    const rows = (res?.data ?? []) as any[];
    for (const b of rows) {
      const a = b?.attributes ?? {};
      if (String(a.status ?? "").toLowerCase() === "cancelled") continue;
      const rooms = (a.rooms ?? []) as any[];
      const own = rooms.length === 0 || rooms.some((r) => !r.room_type_id || r.room_type_id === t.roomTypeId);
      if (!own || !a.arrival_date || !a.departure_date) continue;
      for (let d = new Date(`${a.arrival_date}T00:00:00Z`); iso(d) < a.departure_date; d = new Date(d.getTime() + 86_400_000)) nights.add(iso(d));
    }
    if (rows.length < 100) break;
  }
}

/** Noites ocupadas: reservas deste anúncio, do gêmeo e do imóvel no ConciergeIA. */
async function activeBookingNights(t: SafeMapTarget, windowEnd?: string): Promise<Set<string>> {
  const nights = new Set<string>();
  const units = [{ channexPropertyId: t.channexPropertyId, roomTypeId: t.roomTypeId }, ...(t.sibling ? [t.sibling] : [])];
  for (const u of units) await channexBookingNights(u, nights);
    const rows = (res?.data ?? []) as any[];
    for (const b of rows) {
      const a = b?.attributes ?? {};
      if (String(a.status ?? "").toLowerCase() === "cancelled") continue;
      const rooms = (a.rooms ?? []) as any[];
      const own = rooms.length === 0 || rooms.some((r) => !r.room_type_id || r.room_type_id === t.roomTypeId);
      if (!own || !a.arrival_date || !a.departure_date) continue;
      for (let d = new Date(`${a.arrival_date}T00:00:00Z`); iso(d) < a.departure_date; d = new Date(d.getTime() + 86_400_000)) nights.add(iso(d));
    }
  // Bloqueios do anfitrião / Airbnb (iCal) e reservas registradas no ConciergeIA também fecham a data.
  if (t.propertyId) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const today = iso(new Date());
    const { data } = await supabaseAdmin
      .from("property_reservations")
      .select("checkin_date, checkout_date, status, source")
      .eq("property_id", t.propertyId)
      .gte("checkout_date", today);
    for (const r of (data ?? []) as any[]) {
      const status = String(r.status ?? "").toLowerCase();
      if (status.includes("cancel")) continue;
      if (!r.checkin_date || !r.checkout_date) continue;
      // Todo bloqueio (manual ou do Airbnb) dentro da janela de venda fecha a data.
      // Só ignoramos o "Not available" sintético do iCal que encosta no fim da
      // janela (max_days_notice): ele representa o horizonte, não um bloqueio.
      if (status === "blocked" && windowEnd && r.checkout_date > windowEnd) continue;
      for (let d = new Date(`${r.checkin_date}T00:00:00Z`); iso(d) < r.checkout_date; d = new Date(d.getTime() + 86_400_000)) nights.add(iso(d));
    }
  }
  return nights;
}

/**
 * Exporta a disponibilidade REAL do anúncio para a Channex (que o PriceLabs lê):
 * noite reservada = 0, noite livre dentro da janela do anfitrião = 1, além dela = 0.
 * Só o delta entra na outbox ARI (limitador 20/min). Preços não são tocados.
 */
export async function syncRealAvailability(t: SafeMapTarget, userId: string | null, fallbackWindow = 270) {
  const ch = await call("GET", `/channels/${t.channelId}`).catch(() => null);
  const rp = (ch?.data?.attributes?.rate_plans ?? []).find((r: any) => String(r.settings?.listing_id) === t.listingId);
  const notice = Number(rp?.settings?.availability_rule?.max_days_notice);
  const windowDays = Number.isFinite(notice) && notice > 0 ? notice : fallbackWindow;
  const windowEnd = iso(new Date(Date.now() + windowDays * 86_400_000));
  const nights = await activeBookingNights(t, windowEnd);

  const from = new Date();
  const merged: Parameters<typeof applyCalendarChanges>[0] = [];
  for (let i = 0; i <= 365; i++) {
    const date = iso(new Date(from.getTime() + i * 86_400_000));
    const availability = i > windowDays || nights.has(date) ? 0 : 1;
    const prev = merged[merged.length - 1];
    if (prev && prev.fields.availability === availability) prev.dateTo = date;
    else merged.push({ propertyId: t.channexPropertyId, roomTypeId: t.roomTypeId, ratePlanId: t.ratePlanId, dateFrom: date, dateTo: date, fields: { availability } });
  }
  await applyCalendarChanges(merged, userId, "real_availability");
  const flush = await flushAriOutbox();
  const avail = flush.batches.find((b) => b.kind === "availability");
  return { ok: !avail || avail.ok, bookedNights: nights.size, windowDays };
}

/** Realinha a disponibilidade real de todos os anúncios do piloto (após reservas novas/canceladas). */
export async function syncPilotAvailability(userId: string | null = null) {
  const out: unknown[] = [];
  for (const t of PILOT_MAPPINGS) out.push(await syncRealAvailability(t, userId).catch((e) => ({ ok: false, error: String(e) })));
  return out;
}
