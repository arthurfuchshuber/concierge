/**
 * Modalidade de cancelamento DA RESERVA do turno (playbook de cancelamento, 10/11/2026). Somente leitura, com a
 * projeção `RESERVATION_CANCELLATION_COLUMNS` (sem valores, contatos ou texto livre). Reserva de outro imóvel ou
 * inexistente ⇒ `null`. Erro de leitura lança (o builder trata como "desconhecido").
 */
import { assertIssued } from "@/lib/guest-ai/trust";
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import { getGuestAiDb, type GuestAiDb } from "./client.server";
import { RESERVATION_CANCELLATION_COLUMNS, cols } from "./projections";

export interface CancellationTerms {
  category: string | null;
  isNonRefundable: boolean | null;
  nights: number | null;
  /** Melhor dado disponível de quando a reserva foi confirmada (chegada ao sistema). */
  bookedAt: string | null;
  /** Ocupação da reserva (16/11/2026: concordância de número). Opcional: `null`/ausente = não informada. */
  guests?: { adults: number; children: number; infants: number } | null;
}

const DAY_MS = 86_400_000;
const isoDate = (v: unknown): number | null => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const t = Date.parse(`${v}T00:00:00Z`);
  return Number.isNaN(t) ? null : t;
};

export async function fetchCancellationTerms(turn: ValidatedTurn, deps?: { db?: GuestAiDb }): Promise<CancellationTerms | null> {
  assertIssued("turn", turn, "data_requires_validated_turn");
  if (!turn.reservationId) return null;
  const db = deps?.db ?? (await getGuestAiDb());
  const { data, error } = await db
    .from("property_reservations")
    .select(cols(RESERVATION_CANCELLATION_COLUMNS))
    .eq("id", turn.reservationId)
    .maybeSingle();
  if (error) throw new Error("cancellation_terms_lookup_failed");
  const r = (data ?? null) as Record<string, unknown> | null;
  if (!r || r["property_id"] !== turn.propertyId) return null;
  const ci = isoDate(r["checkin_date"]);
  const co = isoDate(r["checkout_date"]);
  const category = typeof r["cancellation_policy_category"] === "string" && r["cancellation_policy_category"].trim() ? r["cancellation_policy_category"].trim() : null;
  return {
    category,
    isNonRefundable: typeof r["is_non_refundable"] === "boolean" ? r["is_non_refundable"] : null,
    nights: ci !== null && co !== null && co > ci ? Math.round((co - ci) / DAY_MS) : null,
    bookedAt: typeof r["created_at"] === "string" ? r["created_at"] : null,
    guests: occupancyOf(r["occupancy"]),
  };
}

/** Ocupação da reserva (Channex): adultos, crianças e bebês. Só números; ausente ou inválida ⇒ `null`. */
export function occupancyOf(v: unknown): { adults: number; children: number; infants: number } | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 50 ? x : 0);
  const adults = n(o["adults"]);
  if (adults < 1) return null;
  return { adults, children: n(o["children"]), infants: n(o["infants"]) };
}
