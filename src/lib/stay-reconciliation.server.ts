type DbClient = {
  from: (table: string) => any;
};

/**
 * Fecha etapas antigas que ficaram abertas quando uma nova estadia do mesmo
 * imóvel já começou. Não registra tipo, preço ou execução de limpeza: apenas
 * retira da operação um estado que já foi superado pela ocupação seguinte.
 */
export async function reconcileSupersededStays(
  supabase: DbClient,
  propertyIds: string[],
  today: string,
): Promise<number> {
  if (propertyIds.length === 0) return 0;

  const { data: reservations, error: reservationsError } = await supabase
    .from("property_reservations")
    .select("id, property_id, checkin_date, checkout_date, status")
    .in("property_id", propertyIds)
    .eq("source", "airbnb")
    .lte("checkin_date", today)
    .order("checkin_date", { ascending: false });
  if (reservationsError) throw reservationsError;

  const begunByProperty = new Map<string, { id: string; checkin_date: string }>();
  for (const reservation of reservations ?? []) {
    const status = String(reservation.status ?? "").toLowerCase();
    if (status.includes("cancel") || status === "blocked") continue;
    if (!begunByProperty.has(reservation.property_id)) {
      begunByProperty.set(reservation.property_id, {
        id: reservation.id,
        checkin_date: reservation.checkin_date,
      });
    }
  }
  if (begunByProperty.size === 0) return 0;

  const supersededReservationIds = (reservations ?? [])
    .filter((reservation: { id: string; property_id: string; checkout_date: string | null }) => {
      const current = begunByProperty.get(reservation.property_id);
      return (
        !!current &&
        reservation.id !== current.id &&
        !!reservation.checkout_date &&
        reservation.checkout_date <= current.checkin_date &&
        // Same-day turnover: never close on the checkout day itself — the
        // cleaning card must stay on the board until the day is over.
        reservation.checkout_date < today
      );
    })
    .map((reservation: { id: string }) => reservation.id);
  if (supersededReservationIds.length === 0) return 0;

  const { data: openStatuses, error: statusesError } = await supabase
    .from("guest_arrival_status")
    .select("id")
    .in("reservation_id", supersededReservationIds)
    .is("concluded_at", null);
  if (statusesError) throw statusesError;
  const statusIds = (openStatuses ?? []).map((status: { id: string }) => status.id);
  if (statusIds.length === 0) return 0;

  const { error: updateError } = await supabase
    .from("guest_arrival_status")
    .update({ concluded_at: new Date().toISOString() })
    .in("id", statusIds);
  if (updateError) throw updateError;
  return statusIds.length;
}