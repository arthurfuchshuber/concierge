// Identidade canônica de uma reserva (nome, código, telefone, canal, ocupação).
// Reservas vindas da API (Channex) trazem `guest_contacts` com nome, código
// oficial e telefone; `guest_hint` nelas é o NOME. Reservas do iCal só trazem
// `guest_hint`, que é o CÓDIGO. Nunca use `guest_hint` como código sem olhar a
// origem — foi isso que pôs o nome do hóspede em "Cód. Reserva".

export type ReservationIdentitySource = {
  source?: string | null;
  guest_hint?: string | null;
  guest_contacts?: unknown;
  occupancy?: unknown;
  ota_name?: string | null;
};

export type ReservationIdentity = {
  guestName: string | null;
  reservationCode: string | null;
  guestPhone: string | null;
  channel: string | null;
  adults: number | null;
  children: number | null;
  infants: number | null;
};

const CODE_RE = /^[A-Z0-9]{6,14}$/;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function looksLikeReservationCode(v: string | null | undefined): boolean {
  return !!v && CODE_RE.test(v.trim().toUpperCase()) && /\d/.test(v);
}

function channelLabel(raw: string | null): string | null {
  if (!raw) return null;
  const k = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (k === "airbnb") return "Airbnb";
  if (k.startsWith("booking")) return "Booking.com";
  if (k === "expedia") return "Expedia";
  if (k === "vrbo") return "Vrbo";
  return raw;
}

export function resolveReservationIdentity(r: ReservationIdentitySource): ReservationIdentity {
  const c = (r.guest_contacts && typeof r.guest_contacts === "object" ? r.guest_contacts : {}) as Record<
    string,
    unknown
  >;
  const names = Array.isArray(c["names"]) ? (c["names"] as unknown[]).map(str).filter(Boolean) : [];
  const phones = Array.isArray(c["phones"]) ? (c["phones"] as unknown[]).map(str).filter(Boolean) : [];
  const hint = str(r.guest_hint);
  // Remapeamento SÓ para reservas de anúncios sincronizados (vindas da API).
  // iCal/manual seguem exatamente o comportamento antigo.
  const fromApi = r.source === "channex";
  if (!fromApi) {
    const legacyCode = hint && looksLikeReservationCode(hint) ? hint.toUpperCase() : null;
    return {
      guestName: legacyCode ? null : hint,
      reservationCode: legacyCode,
      guestPhone: null,
      channel: r.source === "airbnb" ? "Airbnb" : null,
      adults: null,
      children: null,
      infants: null,
    };
  }

  let guestName: string | null = (names[0] as string | undefined) ?? null;
  let reservationCode: string | null = str(c["code"]);
  if (fromApi) {
    if (!guestName && hint && !looksLikeReservationCode(hint)) guestName = hint;
    if (!reservationCode && hint && looksLikeReservationCode(hint)) reservationCode = hint.toUpperCase();
  } else if (hint) {
    if (looksLikeReservationCode(hint)) reservationCode = hint.toUpperCase();
    else guestName = hint;
  }

  let phone = (phones[0] as string | undefined) ?? null;
  if (phone) {
    const digits = phone.replace(/\D/g, "");
    phone = digits ? `+${digits}` : null;
  }

  const occ = (r.occupancy && typeof r.occupancy === "object" ? r.occupancy : {}) as Record<string, unknown>;
  return {
    guestName,
    reservationCode,
    guestPhone: phone,
    channel: channelLabel(str(r.ota_name)) ?? (r.source === "airbnb" || r.source === "channex" ? "Airbnb" : null),
    adults: num(occ["adults"]),
    children: num(occ["children"]),
    infants: num(occ["infants"]),
  };
}

/** Colunas extras a selecionar em `property_reservations` para o resolvedor. */
export const RESERVATION_IDENTITY_COLUMNS =
  "source, guest_contacts, occupancy:raw_payload->attributes->occupancy, ota_name:raw_payload->attributes->>ota_name";
