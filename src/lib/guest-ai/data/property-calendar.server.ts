/**
 * Ocupação do calendário do imóvel do turno (11/11/2026, caso Gleison). Somente leitura, com a projeção fechada
 * `RESERVATION_COLUMNS` (id, imóvel, status, origem, datas): nenhum nome, contato, valor ou texto de outro hóspede.
 * Janela: de hoje (fuso do imóvel) até `CALENDAR_WINDOW_DAYS` dias. O imóvel vem SEMPRE do turno validado.
 * Erro de leitura lança (o builder trata como calendário indisponível; a IA não presume disponibilidade).
 */
import { assertIssued } from "@/lib/guest-ai/trust";
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import { CALENDAR_WINDOW_DAYS, addDays, buildOccupancy, type CalendarRow, type PropertyCalendarOccupancy } from "@/lib/guest-ai/calendar-occupancy";
import { getGuestAiDb, type GuestAiDb } from "./client.server";
import { RESERVATION_COLUMNS, cols } from "./projections";

export async function fetchPropertyOccupancy(
  turn: ValidatedTurn,
  opts: { today: string; windowDays?: number },
  deps?: { db?: GuestAiDb },
): Promise<PropertyCalendarOccupancy> {
  assertIssued("turn", turn, "data_requires_validated_turn");
  const windowDays = opts.windowDays ?? CALENDAR_WINDOW_DAYS;
  const db = deps?.db ?? (await getGuestAiDb());
  const { data, error } = await db
    .from("property_reservations")
    .select(cols(RESERVATION_COLUMNS))
    .eq("property_id", turn.propertyId)
    .in("status", ["confirmed", "blocked"])
    .gt("checkout_date", opts.today)
    .lte("checkin_date", addDays(opts.today, windowDays))
    .order("checkin_date", { ascending: true })
    .limit(300);
  if (error) throw new Error("property_calendar_lookup_failed");
  return buildOccupancy((data ?? []) as CalendarRow[], {
    propertyId: turn.propertyId,
    today: opts.today,
    windowDays,
    excludeReservationId: turn.reservationId,
  });
}
