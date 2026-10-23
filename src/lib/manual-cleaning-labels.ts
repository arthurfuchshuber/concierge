// Rótulos puros do cartão de Imóvel / Reserva / Prestador da "Nova limpeza"
// (mockups 1–4 de "Nova limpeza — ajustes v3"). Sem banco: testável isolado.

/** Atividade principal do prestador, com o rótulo do cadastro de Prestadores. */
const PROVIDER_ACTIVITY: Record<string, string> = {
  limpeza: "Limpeza",
  manutencao: "Manutenção",
  portaria: "Portaria",
  lavanderia: "Lavanderia",
  jardinagem: "Jardinagem",
  piscina: "Piscina",
  outros: "Outros",
};
export function providerActivityLabel(
  category: string | null | undefined,
  categories?: string[] | null,
): string | null {
  const key = (category || categories?.[0] || "").trim().toLowerCase();
  if (!key) return null;
  return PROVIDER_ACTIVITY[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * "Hóspede: Fulano" ou "Cód. Reserva: CÓDIGO" — a linha do cartão da Reserva
 * (mockup 2). Código = o próprio identificador da estadia quando não há nome.
 */
export function reservationGuestLine(
  guestName: string | null | undefined,
  hint: string | null | undefined,
  externalUid: string | null | undefined,
  url: string | null | undefined,
): string {
  const name = (guestName ?? "").trim();
  if (name) return `Hóspede: ${name}`;
  const h = (hint ?? "").trim();
  if (h && !/^[A-Z0-9]{8,12}$/.test(h)) return `Hóspede: ${h}`;
  const code =
    (h && /^[A-Z0-9]{8,12}$/.test(h) ? h : null) ??
    /\b(HM[A-Z0-9]{8})\b/.exec(`${externalUid ?? ""} ${url ?? ""}`)?.[1] ??
    null;
  return code ? `Cód. Reserva: ${code}` : "Reserva";
}
