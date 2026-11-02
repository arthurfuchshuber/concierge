/**
 * Estado operacional da reserva vinculada à conversa.
 *
 * NÃO presume que toda conversa tem reserva e NUNCA vincula por data, nome ou
 * coincidência parcial: só vale o `reservation_id` já gravado na conversa (que
 * o canal gravou por CÓDIGO da reserva). `property_chat_conversations.reservation_id`
 * não tem chave estrangeira no banco, então aqui se exige que a reserva exista E
 * pertença ao MESMO imóvel da conversa; qualquer divergência vira "sem reserva"
 * + conflito (nunca uma reserva alheia).
 */
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import { assertIssued } from "@/lib/guest-ai/trust";
import { getGuestAiDb, type GuestAiDb } from "./client.server";
import { ACCESS_LOG_COLUMNS, ARRIVAL_STATUS_COLUMNS, RESERVATION_COLUMNS, cols } from "./projections";
import {
  deriveReservationFacts,
  emptyReservationState,
  type ArrivalStatusRow,
  type ReservationRow,
  type ReservationState,
} from "./reservation-facts";

export type ReservationLookup =
  | { kind: "none" }
  | { kind: "state"; state: ReservationState }
  | { kind: "conflict"; code: "reservation_property_mismatch" | "reservation_not_found" };

export async function fetchReservationState(
  turn: ValidatedTurn,
  deps?: { db?: GuestAiDb },
): Promise<ReservationLookup> {
  assertIssued("turn", turn, "data_requires_validated_turn");
  if (!turn.reservationId) return { kind: "none" };
  const db = deps?.db ?? (await getGuestAiDb());

  const { data: resData, error: resErr } = await db
    .from("property_reservations")
    .select(cols(RESERVATION_COLUMNS))
    .eq("id", turn.reservationId)
    .maybeSingle();
  if (resErr) throw new Error("reservation_lookup_failed");
  const res = (resData as ReservationRow | null) ?? null;
  if (!res) return { kind: "conflict", code: "reservation_not_found" };
  if (res.property_id !== turn.propertyId) return { kind: "conflict", code: "reservation_property_mismatch" };

  // Reservas irmãs da MESMA estadia (mesmo imóvel + check-in + check-out): o histórico unificado
  // por gatilho deixa a linha antiga como `cancelled_duplicate` e o status da equipe pode estar em qualquer uma.
  let siblingIds: string[] = [res.id];
  let logIds: string[] = [];
  if (res.checkin_date) {
    const [sib, logs] = await Promise.all([
      res.checkout_date
        ? db
            .from("property_reservations")
            .select("id")
            .eq("property_id", turn.propertyId)
            .eq("checkin_date", res.checkin_date)
            .eq("checkout_date", res.checkout_date)
            .limit(20)
        : Promise.resolve({ data: [] as Array<{ id: string }>, error: null }),
      db
        .from("guide_access_logs")
        .select(cols(ACCESS_LOG_COLUMNS))
        .eq("property_id", turn.propertyId)
        .eq("checkin_date", res.checkin_date)
        .limit(50),
    ]);
    if (sib.error || logs.error) throw new Error("reservation_lookup_failed");
    siblingIds = Array.from(new Set([res.id, ...((sib.data ?? []) as Array<{ id: string }>).map((r) => r.id)]));
    logIds = ((logs.data ?? []) as Array<{ id: string }>).map((r) => r.id);
  }

  const [byRes, byLog] = await Promise.all([
    db
      .from("guest_arrival_status")
      .select(cols(ARRIVAL_STATUS_COLUMNS))
      .eq("property_id", turn.propertyId)
      .in("reservation_id", siblingIds),
    logIds.length > 0
      ? db
          .from("guest_arrival_status")
          .select(cols(ARRIVAL_STATUS_COLUMNS))
          .eq("property_id", turn.propertyId)
          .in("log_id", logIds)
      : Promise.resolve({ data: [] as ArrivalStatusRow[], error: null }),
  ]);
  if (byRes.error || byLog.error) throw new Error("arrival_status_lookup_failed");
  const rows = [...((byRes.data ?? []) as ArrivalStatusRow[]), ...((byLog.data ?? []) as ArrivalStatusRow[])];

  return { kind: "state", state: deriveReservationFacts(res, rows) };
}

export { emptyReservationState };
