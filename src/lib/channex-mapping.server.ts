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
};

/** Anúncios liberados no piloto com seus IDs na Channex. */
export const PILOT_MAPPINGS: SafeMapTarget[] = [
  {
    channelId: "9f7f35ab-3b40-4b84-8483-693122d9604b",
    listingId: "1081915824812637088",
    channexPropertyId: "c1add170-eaed-42b8-bb12-dc2f3adcf9e3",
    roomTypeId: "763011b4-1941-4fa3-978a-641c8d0df782",
    ratePlanId: "164f4b12-c67c-4da9-aebc-ae093689b2e3",
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

/** Garante vaga aberta e só então mapeia. Idempotente. */
export async function safeMapAirbnbListing(t: SafeMapTarget, userId: string | null) {
  // 1) Já mapeado? Não mexe em nada.
  const channel = await call("GET", `/channels/${t.channelId}`);
  const mapped = (channel?.data?.attributes?.rate_plans ?? []).some(
    (r: any) => String(r.settings?.listing_id) === t.listingId,
  );
  if (mapped) return { listingId: t.listingId, status: "already_mapped" as const };

  // 2) Abre 1 vaga/dia por 365 dias pelo fluxo ARI oficial (diff → outbox → lote).
  const from = new Date();
  const to = new Date(from.getTime() + 365 * 86_400_000);
  await applyCalendarChanges(
    [{ propertyId: t.channexPropertyId, roomTypeId: t.roomTypeId, ratePlanId: t.ratePlanId, dateFrom: iso(from), dateTo: iso(to), fields: { availability: 1 } }],
    userId,
    "safe_mapping",
  );
  const flush = await flushAriOutbox();
  const avail = flush.batches.find((b) => b.kind === "availability");
  if (avail && !avail.ok) throw new Error("A Channex não confirmou a abertura do calendário; mapeamento cancelado para não bloquear o Airbnb.");

  // 3) Confere na Channex que a vaga está realmente aberta hoje.
  const check = await call("GET", `/availability?filter[property_id]=${t.channexPropertyId}&filter[date]=${iso(from)}`);
  const today = check?.data?.[t.roomTypeId]?.[iso(from)];
  if (!(Number(today) >= 1)) throw new Error("Calendário ainda fechado na Channex; mapeamento cancelado para não bloquear o Airbnb.");

  // 4) Mapeia o anúncio e carrega reservas futuras.
  await call("POST", `/channels/${t.channelId}/mappings`, { mapping: { rate_plan_id: t.ratePlanId, settings: { listing_id: t.listingId } } });
  await call("POST", `/channels/${t.channelId}/execute/load_future_reservations`, { listing_id: t.listingId }).catch(() => null);
  return { listingId: t.listingId, status: "mapped" as const };
}
