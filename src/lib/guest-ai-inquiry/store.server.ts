/**
 * CONSULTA DO AIRBNB — leitura (15/11/2026, caso Lauriete). A Channex envia o evento `inquiry` com período, hóspedes e
 * valor; o webhook já é gravado em `channex_raw_records` (entity_type `webhook:inquiry`). Esta leitura devolve o evento
 * MAIS RECENTE da conversa (a consulta pode ser atualizada, p.ex. depois de uma pré-aprovação). Somente leitura;
 * falha ou ausência ⇒ `null` (a IA nunca presume o período). Fica fora de `guest-ai/` (fronteira de dados).
 */
import type { InquiryDetails } from "@/lib/guest-ai/types";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const int = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 1000 ? n : null;
};
const money = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n < 1e9 ? n : null;
};
const str = (v: unknown, max = 40): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** Converte o corpo do webhook `inquiry` da Channex. Sem datas válidas e coerentes ⇒ `null`. Puro. */
export function parseInquiryPayload(raw: unknown, receivedAt: string | null = null): InquiryDetails | null {
  const root = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const payload = root && typeof root["payload"] === "object" && root["payload"] ? (root["payload"] as Record<string, unknown>) : null;
  const d = payload && typeof payload["booking_details"] === "object" && payload["booking_details"] ? (payload["booking_details"] as Record<string, unknown>) : null;
  if (!payload || !d) return null;
  const checkin = d["checkin_date"];
  const checkout = d["checkout_date"];
  if (typeof checkin !== "string" || typeof checkout !== "string" || !ISO.test(checkin) || !ISO.test(checkout) || checkout <= checkin) return null;
  return {
    checkinDate: checkin,
    checkoutDate: checkout,
    nights: int(d["nights"]),
    guests: int(d["number_of_guests"]),
    adults: int(d["number_of_adults"]),
    children: int(d["number_of_children"]),
    infants: int(d["number_of_infants"]),
    pets: int(d["number_of_pets"]),
    payoutAmount: money(d["payout_amount"]),
    currency: str(d["currency"], 8),
    status: str(payload["status"], 20),
    receivedAt,
  };
}

/** Thread da Channex a partir da sessão da conversa (`airbnb:<thread>`); outros canais ⇒ `null`. */
export function threadIdFromSession(guestSessionId: string | null | undefined): string | null {
  const m = /^airbnb:([0-9a-f-]{36})$/i.exec(guestSessionId ?? "");
  return m ? m[1]! : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadInquiryDetails(db: any, guestSessionId: string | null | undefined): Promise<InquiryDetails | null> {
  try {
    const threadId = threadIdFromSession(guestSessionId);
    if (!threadId) return null;
    const { data, error } = await db
      .from("channex_raw_records")
      .select("payload, first_seen_at")
      .eq("entity_type", "webhook:inquiry")
      .eq("payload->payload->>message_thread_id", threadId)
      .order("first_seen_at", { ascending: false })
      .limit(1);
    if (error || !Array.isArray(data) || data.length === 0) return null;
    const row = data[0] as { payload?: unknown; first_seen_at?: string | null };
    return parseInquiryPayload(row.payload, typeof row.first_seen_at === "string" ? row.first_seen_at : null);
  } catch {
    return null;
  }
}
