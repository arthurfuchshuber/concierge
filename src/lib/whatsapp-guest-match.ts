/**
 * Identificação do hóspede no WhatsApp — SOMENTE por dados da API Channex
 * (`property_reservations.guest_contacts`): telefone cadastrado ou código da
 * reserva. Nunca por nome e nunca pelo acesso ao guia.
 */

/** Chave canônica do telefone: DDD + 8 últimos dígitos (ignora DDI e o 9º dígito). */
export function phoneKey(raw: unknown): string | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.length < 8) return null;
  // Brasil: remove DDI 55 quando o número completo vier com ele.
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
  // Remove zero de tronco/operadora ("0 11 ...", "0 15 11 ...").
  d = d.replace(/^0+/, "");
  if (d.length === 11 && d[2] === "9") return d.slice(0, 2) + d.slice(3); // DDD + 9 + 8
  if (d.length === 10) return d; // DDD + 8
  // Sem DDD ou estrangeiro: compara pelos 8 finais (estrangeiro mantém tudo).
  if (d.length <= 9) return d.slice(-8);
  return d;
}

export function samePhone(a: unknown, b: unknown): boolean {
  const ka = phoneKey(a);
  const kb = phoneKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  // Um lado sem DDD: compara só os 8 finais.
  if (ka.length === 8 || kb.length === 8) return ka.slice(-8) === kb.slice(-8);
  return false;
}

/** Códigos de reserva citados na mensagem (ex.: HMCS9QXYK5, ou alfanuméricos ≥ 6). */
export function extractReservationCodes(text: unknown): string[] {
  const t = String(text ?? "").toUpperCase();
  const out = new Set<string>();
  for (const m of t.matchAll(/\b([A-Z0-9]{6,14})\b/g)) {
    const c = m[1]!;
    if (/[A-Z]/.test(c) && /\d/.test(c)) out.add(c);
  }
  return [...out];
}

export type MatchRow = {
  id: string;
  property_id: string;
  checkin_date: string;
  checkout_date: string;
  status: string | null;
  guest_contacts: { code?: string | null; phones?: string[] | null } | null;
};

const norm = (s: unknown) => String(s ?? "").toUpperCase().replace(/\s/g, "");

/**
 * Escolhe UMA reserva: por telefone e, se não houver, por código citado.
 * Várias por telefone: fica com a em andamento/mais próxima de hoje; empate real → null.
 */
export function pickReservation(
  rows: MatchRow[],
  p: { phone: string; text: string; today: string },
): { row: MatchRow; by: "telefone" | "codigo" } | null {
  const live = rows.filter((r) => !String(r.status ?? "").toLowerCase().includes("cancel"));
  const codes = extractReservationCodes(p.text);
  if (codes.length) {
    const byCode = live.filter((r) => r.guest_contacts?.code && codes.includes(norm(r.guest_contacts.code)));
    if (byCode.length === 1) return { row: byCode[0]!, by: "codigo" };
  }
  const byPhone = live.filter((r) => (r.guest_contacts?.phones ?? []).some((ph) => samePhone(ph, p.phone)));
  if (!byPhone.length) return null;
  const active = byPhone.filter((r) => r.checkin_date <= p.today && r.checkout_date >= p.today);
  if (active.length === 1) return { row: active[0]!, by: "telefone" };
  if (active.length > 1) return null;
  const upcoming = byPhone.filter((r) => r.checkin_date > p.today).sort((a, b) => a.checkin_date.localeCompare(b.checkin_date));
  if (upcoming.length) {
    if (upcoming[1] && upcoming[1].checkin_date === upcoming[0]!.checkin_date) return null;
    return { row: upcoming[0]!, by: "telefone" };
  }
  const past = byPhone.sort((a, b) => b.checkout_date.localeCompare(a.checkout_date));
  return { row: past[0]!, by: "telefone" };
}

export function askCodeText(): string {
  return "Olá! Não localizei sua reserva por este número de WhatsApp. Pode me enviar o código da sua reserva (ex.: HMXXXXXXXX, do Airbnb)? Assim já sigo com o seu atendimento.";
}
