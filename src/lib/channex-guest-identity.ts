/**
 * Conta do hóspede na OTA a partir da reserva da Channex (Porta 1 da memória do hóspede, 06/11/2026).
 *
 * A Channex não traz um id do hóspede em `customer`; o Airbnb traz, no payload bruto da reserva
 * (`attributes.raw_message`, texto JSON), `reservation.guest_id`: o id da CONTA do hóspede no Airbnb,
 * que se repete entre reservas — ao contrário de `booking_id`, `ota_reservation_code`, `thread_id` e do
 * e-mail de repasse, que mudam a cada reserva. Formato devolvido: `airbnb:<id>`.
 *
 * Só o id é extraído: nada mais do payload bruto (valores, código de porta sugerido, documentos) é lido
 * para fora daqui. Qualquer dúvida ⇒ `null` (sem âncora, sem vínculo).
 */
export function otaGuestAccountId(
  attrs: { ota_name?: unknown; raw_message?: unknown } | null | undefined,
): string | null {
  if (!attrs || typeof attrs.ota_name !== "string" || !/airbnb/i.test(attrs.ota_name)) return null;
  const raw = attrs.raw_message;
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    if (!/^\s*\{/.test(raw)) return null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const res =
    parsed && typeof parsed === "object" ? (parsed as { reservation?: unknown }).reservation : null;
  const id = res && typeof res === "object" ? (res as { guest_id?: unknown }).guest_id : null;
  const s =
    typeof id === "number" && Number.isSafeInteger(id)
      ? String(id)
      : typeof id === "string"
        ? id.trim()
        : "";
  return /^[A-Za-z0-9_-]{1,64}$/.test(s) ? `airbnb:${s.toLowerCase()}` : null;
}
