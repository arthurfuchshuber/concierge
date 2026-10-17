// ENVIO DE VOLTA AO AIRBNB (sistema -> Channex -> Airbnb). Funções puras: montam os
// pedidos exatamente como a documentação da Channex descreve, validam limites e
// calculam o que mudou. Quem envia é `listing-writeback.server.ts`.
//
// Formatos (docs.channex.io, API do Airbnb):
//  - PUT /channels/{canal}/execute/update_booking_setting  { channel_rate_plan_id, data }
//  - PUT /channels/{canal}/mappings/{id}/pricing_settings   { pricing_settings }
//  - PUT /channels/{canal}/mappings/{id}/availability_settings { availability_settings }
//  - PUT /channels/{canal}/execute/publish | unpublish
// `{id}` e `channel_rate_plan_id` são o `rate_plans[].id` do canal (não o rate_plan_id).
import { POLICY_LABEL } from "@/lib/reservation-rich";

type Any = Record<string, any>;

export type GuestControlsPatch = Partial<{
  allows_children_as_host: boolean;
  allows_infants_as_host: boolean;
  allows_pets_as_host: boolean;
  pet_capacity: number;
  allows_events_as_host: boolean;
  allows_smoking_as_host: boolean;
}>;

export type AvailabilityPatch = Partial<{
  booking_lead_time: number;
  max_days_notice: number;
  default_min_nights: number;
  default_max_nights: number;
  turnover_days: number;
  seasonal_min_nights: Array<{ start_date: string; end_date: string; min_nights: number }>;
}>;

export type PricingPatch = Partial<{
  currency: string;
  default_daily_price: number;
  weekend_price: number;
  guests_included: number;
  price_per_extra_person: number;
}>;

export type ListingPatch = {
  checkin_time?: string | null;
  checkin_time_max?: string | null;
  checkout_time?: string | null;
  instant_booking?: boolean;
  cancellation_category?: string;
  guest_controls?: GuestControlsPatch;
  availability?: AvailabilityPatch;
  pricing?: PricingPatch;
  published?: boolean;
  unpublish_reason?: string;
};

export type WritebackRequest = {
  operation: string;
  method: "PUT";
  path: string;
  body: unknown;
  /** Quais chaves de `raw_settings` este pedido altera (para refletir no banco depois). */
  merge: { group: "booking_setting" | "pricing_setting" | "availability_rule" | null; values: Any };
  isPricing?: boolean;
};

export type BuildResult = { requests: WritebackRequest[]; errors: string[] };

/** "15:00" -> "15". O Airbnb só aceita horas cheias. */
export function hourOf(t: string | null | undefined): { ok: true; hour: string } | { ok: false; error: string } {
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(String(t ?? "").trim());
  if (!m) return { ok: false, error: `Horário inválido: "${t ?? ""}".` };
  const h = Number(m[1]);
  if (h > 24 || (m[2] && m[2] !== "00")) return { ok: false, error: "O Airbnb aceita apenas horas cheias (ex.: 15:00)." };
  return { ok: true, hour: String(h) };
}

const GUEST_KEYS = ["allows_children_as_host", "allows_infants_as_host", "allows_pets_as_host", "pet_capacity", "allows_events_as_host", "allows_smoking_as_host"] as const;

function inRange(v: unknown, lo: number, hi: number) {
  return typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
}

export function buildWriteback(args: { channelId: string; mappingId: string; current: Any; patch: ListingPatch }): BuildResult {
  const { channelId, mappingId, current, patch } = args;
  const requests: WritebackRequest[] = [];
  const errors: string[] = [];
  const cur = current ?? {};
  const bs: Any = cur.booking_setting ?? {};

  // ---- booking settings
  const data: Any = {};
  const wants =
    patch.checkin_time !== undefined || patch.checkin_time_max !== undefined || patch.checkout_time !== undefined ||
    patch.instant_booking !== undefined || patch.cancellation_category !== undefined || patch.guest_controls !== undefined;
  if (wants) {
    for (const [key, field] of [["checkin_time", "check_in_time_start"], ["checkin_time_max", "check_in_time_end"], ["checkout_time", "check_out_time"]] as const) {
      const v = patch[key];
      if (v === undefined) continue;
      if (v === null || v === "") { errors.push(`${field}: não pode ficar em branco no Airbnb.`); continue; }
      const h = hourOf(v);
      if (!h.ok) { errors.push(`${field}: ${h.error}`); continue; }
      data[field] = field === "check_out_time" ? Number(h.hour) : h.hour;
    }
    if (patch.instant_booking === false) {
      errors.push("Reserva instantânea: a Channex só permite escolher 'todos' ou 'hóspedes bem avaliados'; desligar é feito no Airbnb.");
    } else if (patch.instant_booking === true && !bs.instant_booking_allowed_category) {
      data.instant_booking_allowed_category = "everyone";
    }
    if (patch.cancellation_category !== undefined) {
      if (!POLICY_LABEL[patch.cancellation_category]) errors.push(`Política de cancelamento desconhecida: ${patch.cancellation_category}.`);
      else data.cancellation_policy_settings = { ...(bs.cancellation_policy_settings ?? {}), cancellation_policy_category: patch.cancellation_category };
    }
    if (patch.guest_controls) {
      const gc: Any = {};
      for (const k of GUEST_KEYS) if (patch.guest_controls[k] !== undefined) gc[k] = patch.guest_controls[k];
      if (Object.keys(gc).length) data.guest_controls = { ...(bs.guest_controls ?? {}), ...gc };
    }
    if (Object.keys(data).length) {
      const category = bs.instant_booking_allowed_category ?? data.instant_booking_allowed_category;
      if (!category) errors.push("Reserva instantânea: categoria atual desconhecida; sincronize o anúncio antes de enviar.");
      else {
        const body = { channel_rate_plan_id: mappingId, data: { instant_booking_allowed_category: category, ...data } };
        requests.push({
          operation: "listing_booking_settings",
          method: "PUT",
          path: `/channels/${channelId}/execute/update_booking_setting`,
          body,
          merge: { group: "booking_setting", values: body.data },
        });
      }
    }
  }

  // ---- availability
  if (patch.availability && Object.keys(patch.availability).length) {
    const a = patch.availability;
    const bad = [
      a.default_min_nights !== undefined && !inRange(a.default_min_nights, 1, 1000) && "estadia mínima",
      a.default_max_nights !== undefined && !inRange(a.default_max_nights, 1, 1000) && "estadia máxima",
      a.booking_lead_time !== undefined && !inRange(a.booking_lead_time, 0, 365) && "antecedência",
      a.max_days_notice !== undefined && !inRange(a.max_days_notice, 0, 1095) && "janela de reservas",
    ].filter(Boolean);
    if (bad.length) errors.push(`Valor fora do limite: ${bad.join(", ")}.`);
    else
      requests.push({
        operation: "listing_availability_settings",
        method: "PUT",
        path: `/channels/${channelId}/mappings/${mappingId}/availability_settings`,
        body: { availability_settings: a },
        merge: { group: "availability_rule", values: a as Any },
      });
  }

  // ---- pricing (exige o aval explícito de quem chama)
  if (patch.pricing && Object.keys(patch.pricing).length) {
    const cp: Any = cur.pricing_setting ?? {};
    const p: Any = { ...cp, ...patch.pricing };
    const out: Any = {
      currency: p.currency,
      default_daily_price: p.default_daily_price,
      guests_included: p.guests_included,
      price_per_extra_person: p.price_per_extra_person ?? 0,
    };
    if (p.weekend_price != null) out.weekend_price = p.weekend_price;
    const bad: string[] = [];
    if (!p.currency) bad.push("moeda");
    if (!inRange(out.default_daily_price, 10, 100000)) bad.push("diária base (10 a 100.000)");
    if (out.weekend_price != null && !inRange(out.weekend_price, 10, 100000)) bad.push("diária de fim de semana (10 a 100.000)");
    if (!inRange(out.guests_included, 1, 100)) bad.push("hóspedes incluídos (mínimo 1)");
    if (!(out.price_per_extra_person === 0 || inRange(out.price_per_extra_person, 5, 300))) bad.push("valor por hóspede extra (0 ou 5 a 300)");
    if (bad.length) errors.push(`Preço fora do limite: ${bad.join(", ")}.`);
    else
      requests.push({
        operation: "listing_pricing_settings",
        method: "PUT",
        path: `/channels/${channelId}/mappings/${mappingId}/pricing_settings`,
        body: { pricing_settings: out },
        merge: { group: "pricing_setting", values: out },
        isPricing: true,
      });
  }

  // ---- publicar / despublicar
  if (patch.published !== undefined) {
    requests.push({
      operation: patch.published ? "listing_publish" : "listing_unpublish",
      method: "PUT",
      path: `/channels/${channelId}/execute/${patch.published ? "publish" : "unpublish"}`,
      body: patch.published ? {} : { deactivation_reason: patch.unpublish_reason ?? "other", deactivation_details: "Alterado pelo ConciergeIA" },
      merge: { group: null, values: {} },
    });
  }
  return { requests, errors };
}

/** Campos do imóvel que são enviados ao Airbnb quando alguém os altera no sistema. */
export function diffBidirectional(before: Any | null | undefined, after: Any): ListingPatch {
  const patch: ListingPatch = {};
  const b = before ?? {};
  const changed = (k: string) => after[k] !== undefined && after[k] !== null && String(after[k]) !== String(b[k] ?? "");
  const hh = (v: unknown) => String(v ?? "").slice(0, 5);
  if (changed("checkin_time") && hh(after.checkin_time) !== hh(b.checkin_time)) patch.checkin_time = hh(after.checkin_time);
  if (changed("checkin_time_max") && hh(after.checkin_time_max) !== hh(b.checkin_time_max)) patch.checkin_time_max = hh(after.checkin_time_max);
  if (changed("checkout_time") && hh(after.checkout_time) !== hh(b.checkout_time)) patch.checkout_time = hh(after.checkout_time);
  if (changed("airbnb_cancellation_category")) patch.cancellation_category = String(after.airbnb_cancellation_category);
  if (after.airbnb_instant_booking === true && b.airbnb_instant_booking !== true) patch.instant_booking = true;
  return patch;
}

/** Mescla o que foi enviado em `raw_settings` (reflexo imediato no banco). */
export function mergeIntoSettings(settings: Any, req: WritebackRequest): Any {
  const g = req.merge.group;
  if (!g) return settings;
  const next = { ...(settings ?? {}) };
  next[g] = { ...(next[g] ?? {}), ...req.merge.values };
  return next;
}
