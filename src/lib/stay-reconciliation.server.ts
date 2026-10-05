import { isStaleDateOverride } from "@/lib/arrival-date-base";

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

/**
 * SAÍDA ADIADA COM PREVISÃO VELHA (05/10/2026, caso LF001).
 *
 * O hóspede (ou a equipe) deu uma previsão de saída para a data que a reserva
 * tinha na época; depois o calendário empurrou a saída para frente. A previsão
 * ficou velha, mas a saída automática confirmou a saída no dia antigo e a
 * estadia foi encerrada — o card ficou na Fila de Limpeza com a reserva ainda
 * em curso.
 *
 * Reconhece a previsão velha por `arrival_date_base` (a data da reserva sobre
 * a qual ela foi dada) diferente da data atual da reserva. Nesse caso, e só
 * enquanto a limpeza não foi feita nem a etapa concluída: limpa a previsão de
 * DATA (o horário continua), reabre a saída e reabre a chegada encerrada —
 * o card volta para "Em estadia". É a mesma regra da "saída adiada" do sync
 * do calendário, mas independe de quando o sync rodou.
 */
export async function reconcilePostponedCheckouts(
  supabase: DbClient,
  propertyIds: string[],
  today: string,
): Promise<number> {
  if (propertyIds.length === 0) return 0;

  const { data: reservations, error } = await supabase
    .from("property_reservations")
    .select("id, checkout_date, status")
    .in("property_id", propertyIds)
    .eq("source", "airbnb")
    .gt("checkout_date", today);
  if (error) throw error;
  const live = new Map<string, string>();
  for (const r of reservations ?? []) {
    const st = String(r.status ?? "").toLowerCase();
    if (st.includes("cancel") || st === "blocked") continue;
    live.set(r.id as string, r.checkout_date as string);
  }
  if (live.size === 0) return 0;

  const { data: rows, error: rowsError } = await supabase
    .from("guest_arrival_status")
    .select("id, reservation_id, arrival_date_override, arrival_date_base, cleaning_type, concluded_at")
    .in("reservation_id", Array.from(live.keys()))
    .eq("kind", "checkout")
    .not("arrival_date_base", "is", null)
    .not("arrival_date_override", "is", null);
  if (rowsError) throw rowsError;

  let healed = 0;
  for (const row of rows ?? []) {
    const current = live.get(row.reservation_id as string);
    if (!current || !isStaleDateOverride(row.arrival_date_override, row.arrival_date_base, current)) continue;
    // Limpeza já feita / etapa concluída: não desfaz nada.
    if (row.cleaning_type || row.concluded_at) continue;
    const { error: upErr } = await supabase
      .from("guest_arrival_status")
      .update({
        arrival_date_override: null,
        arrival_date_base: null,
        status: "pending",
        done_at: null,
      })
      .eq("id", row.id);
    if (upErr) throw upErr;
    // A chegada foi encerrada junto com a saída automática: reabre.
    const { error: ciErr } = await supabase
      .from("guest_arrival_status")
      .update({ concluded_at: null })
      .eq("reservation_id", row.reservation_id)
      .eq("kind", "checkin")
      .not("concluded_at", "is", null);
    if (ciErr) throw ciErr;
    healed++;
  }
  return healed;
}
