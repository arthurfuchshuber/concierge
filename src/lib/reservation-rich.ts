/**
 * CAMPOS RICOS DA RESERVA (17/10/2026, pedido do Lovable + anfitrião).
 *
 * A Channex/Airbnb entrega, dentro do JSON bruto da reserva, a modalidade de
 * reserva (instantânea ou pedido), a POLÍTICA DE CANCELAMENTO DA PRÓPRIA RESERVA
 * (moderada, não reembolsável...) e a discriminação de valores. Aqui isso vira
 * colunas. É a única fonte que a IA aceita como "certeza" da modalidade.
 *
 * Funções puras: servem ao webhook, ao backfill e aos testes.
 */

export type RichReservation = {
  booking_modality: "instant_book" | "request_to_book" | null;
  cancellation_policy_category: string | null;
  cancellation_policy_id: string | null;
  is_non_refundable: boolean;
  is_humanitarian_stay: boolean;
  listing_base_price: number | null;
  cleaning_fee: number | null;
  channel_host_fee: number | null;
  cohost_payout: number | null;
  /** Valor total LÍQUIDO: o que sobra depois da comissão do canal (o `amount` do Airbnb já vem líquido dela). */
  net_total: number | null;
  /** Valor líquido do anfitrião: total líquido menos o repasse automático do co-anfitrião. */
  host_net_payout: number | null;
  financial_breakdown: Record<string, number | null> | null;
};

const txt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) && /\d/.test(String(v)) ? n : null;
};

/** `raw_message` chega como objeto ou como TEXTO JSON (visto no banco). */
export function reservationOf(booking: unknown): Record<string, unknown> {
  const b = (booking ?? {}) as Record<string, unknown>;
  let rm: unknown = b["raw_message"];
  if (typeof rm === "string") {
    try {
      rm = JSON.parse(rm);
    } catch {
      rm = null;
    }
  }
  const r = (rm as Record<string, unknown> | null)?.["reservation"];
  return r && typeof r === "object" ? (r as Record<string, unknown>) : {};
}

/** "Chave: valor" linha a linha. "N/A" vira null. */
export function parseNotes(notes: unknown): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  if (typeof notes !== "string") return out;
  for (const line of notes.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    const raw = line.slice(i + 1).trim();
    if (!key) continue;
    out[key] = /^n\/?a$/i.test(raw) ? null : num(raw);
  }
  return out;
}

export function richReservationFields(booking: unknown): RichReservation {
  const b = (booking ?? {}) as Record<string, unknown>;
  const res = reservationOf(b);
  const notes = parseNotes(b["notes"]);
  const ib = res["instant_booked"];
  const category = txt(res["cancellation_policy_category"]);
  const hostFee =
    num(res["host_fee_base"]) != null
      ? (num(res["host_fee_base"]) ?? 0) + (num(res["host_fee_vat"]) ?? 0)
      : (notes["Listing Cancellation Host Fee"] ?? null);
  const amount = num(b["amount"]);
  const cohost = notes["Cohost Payout"] ?? null;
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    net_total: amount != null && amount > 0 ? round(amount) : null,
    host_net_payout: amount != null && amount > 0 ? round(Math.max(0, amount - (cohost ?? 0))) : null,
    booking_modality: ib === true || ib === "true" ? "instant_book" : ib === false || ib === "false" ? "request_to_book" : null,
    cancellation_policy_category: category,
    cancellation_policy_id: txt(res["cancellation_policy_id"]),
    is_non_refundable: category === "tiered_pricing_non_refundable",
    is_humanitarian_stay: res["is_airbnborg_stay"] === true || res["is_airbnborg_stay"] === "true",
    listing_base_price: notes["Listing Base Price"] ?? null,
    cleaning_fee: notes["Cleaning Fee"] ?? null,
    channel_host_fee: hostFee != null ? Math.round(hostFee * 100) / 100 : null,
    cohost_payout: notes["Cohost Payout"] ?? null,
    financial_breakdown: Object.keys(notes).length ? notes : null,
  };
}

export const POLICY_LABEL: Record<string, string> = {
  moderate: "Moderada",
  flexible: "Flexível",
  firm: "Firme",
  strict: "Rígida",
  tiered_pricing_non_refundable: "Não reembolsável",
};

/**
 * Valor que o HÓSPEDE vê: o total BRUTO da reserva. O `amount` do Airbnb já vem líquido da comissão
 * do anfitrião; somando a comissão de volta obtém-se o bruto. Sem a comissão não dá para afirmar o
 * bruto, então devolve null (a IA não cita valor).
 */
export function guestVisibleTotal(amount: unknown, hostFee: unknown): number | null {
  const a = num(amount);
  const f = num(hostFee);
  if (a == null || a <= 0 || f == null || f < 0) return null;
  return Math.round((a + f) * 100) / 100;
}
