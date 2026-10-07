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
};

/** Anúncios liberados no piloto com seus IDs na Channex. */
export const PILOT_MAPPINGS: SafeMapTarget[] = [
  {
    channelId: "9f7f35ab-3b40-4b84-8483-693122d9604b",
    listingId: "1081915824812637088",
    channexPropertyId: "c1add170-eaed-42b8-bb12-dc2f3adcf9e3",
    roomTypeId: "763011b4-1941-4fa3-978a-641c8d0df782",
    ratePlanId: "164f4b12-c67c-4da9-aebc-ae093689b2e3",
    propertyId: "9a94ad7f-c259-4a66-aedf-c4e87c449d5c",
  },
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

/** Noites ocupadas por reservas ativas do imóvel na Channex (paginado). */
async function activeBookingNights(t: SafeMapTarget): Promise<Set<string>> {
  const nights = new Set<string>();
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
  // Bloqueios do anfitrião / Airbnb (iCal) e reservas registradas no ConciergeIA também fecham a data.
  if (t.propertyId) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const today = iso(new Date());
    const { data } = await supabaseAdmin
      .from("property_reservations")
      .select("checkin_date, checkout_date, status")
      .eq("property_id", t.propertyId)
      .gte("checkout_date", today);
    for (const r of (data ?? []) as any[]) {
      const status = String(r.status ?? "").toLowerCase();
      if (status.includes("cancel")) continue;
      if (!r.checkin_date || !r.checkout_date) continue;
      // Bloqueios longos (> 30 dias) são artefatos do iCal do Airbnb (janela de
      // antecedência/"Not available" sintético), não bloqueios manuais reais.
      // A janela já é tratada por max_days_notice; contá-los fecha o ano inteiro.
      const span = (Date.parse(`${r.checkout_date}T00:00:00Z`) - Date.parse(`${r.checkin_date}T00:00:00Z`)) / 86_400_000;
      if (status === "blocked" && span > 30) continue;
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
  const nights = await activeBookingNights(t);

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
