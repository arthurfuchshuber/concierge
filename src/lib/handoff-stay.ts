/**
 * CABEÇALHO DA CONVERSA (11/11/2026): a reserva vem do VÍNCULO da própria conversa (`reservation_id`), o mesmo que a
 * IA usa. Nome/thread só entram quando não há vínculo. Puro (sem rede) para valer na lista e no cabeçalho.
 */
import type { HandoffReservationMatch } from "@/lib/handoff.schemas";

/** An unmatched narrow lookup must not erase the list's broader reservation match. */
export function selectConversationStay(
  fresh: HandoffReservationMatch | null | undefined,
  listed: HandoffReservationMatch | null | undefined,
): HandoffReservationMatch | null {
  if (fresh?.status === "missing" && listed && listed.status !== "missing") return listed;
  return fresh ?? listed ?? null;
}

export type StayReservationRow = {
  id?: string | null;
  property_id: string;
  checkin_date: string;
  checkout_date: string;
  source?: string | null;
  status: string;
  external_uid?: string | null;
  guest_hint?: string | null;
  guest_contacts?: { names?: string[]; ota_thread_id?: string; code?: string } | null;
  occupancy?: { adults?: number | null; children?: number | null } | null;
};

export function guestsOfReservation(r: Pick<StayReservationRow, "occupancy">): number | null {
  const n = (Number(r.occupancy?.adults) || 0) + (Number(r.occupancy?.children) || 0);
  return n > 0 ? n : null;
}

/** Linha da reserva ⇒ situação do cabeçalho. Cancelada fica cancelada; qualquer outra com datas é a reserva. */
export function stayMatchFromReservation(r: StayReservationRow): HandoffReservationMatch {
  const base = {
    checkin: r.checkin_date,
    checkout: r.checkout_date,
    guests: guestsOfReservation(r),
    code: r.guest_contacts?.code?.trim() || null,
  };
  return r.status === "cancelled" ? { status: "cancelled", ...base } : { status: "confirmed", ...base };
}

const norm = (s: string | null | undefined) =>
  String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/**
 * Reserva da conversa: 1) vínculo direto (`reservation_id`); 2) thread do Airbnb; 3) nome único numa reserva futura
 * confirmada do mesmo imóvel. Sem nada disso ⇒ `null` (Consulta de verdade).
 */
export function pickConversationReservation(
  conv: { reservation_id?: string | null; property_id: string | null; guest_session_id?: string | null; guest_name?: string | null },
  rows: readonly StayReservationRow[],
  today: string,
): StayReservationRow | null {
  const own = rows.filter((r) => r.property_id === conv.property_id);
  if (conv.reservation_id) {
    const direct = own.find((r) => r.id === conv.reservation_id);
    if (direct) return direct;
  }
  const sess = String(conv.guest_session_id ?? "").replace(/^airbnb:/, "");
  if (sess) {
    const byThread = own.find((r) => r.guest_contacts?.ota_thread_id === sess);
    if (byThread) return byThread;
  }
  const gn = norm(conv.guest_name);
  if (gn.length < 3) return null;
  const byName = own.filter(
    (r) =>
      r.status === "confirmed" &&
      r.checkout_date >= today &&
      [r.guest_hint, ...(r.guest_contacts?.names ?? [])].some((n) => {
        const nn = norm(n);
        return nn === gn || nn.startsWith(`${gn} `);
      }),
  );
  return byName.length === 1 ? byName[0]! : null;
}
