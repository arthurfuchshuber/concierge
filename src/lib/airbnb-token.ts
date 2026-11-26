/**
 * Token OAuth do Airbnb lido das configurações do canal na Channex (26/11/2026).
 *
 * A Channex passou a devolver `tokens.access_token` MASCARADO ("***") em `GET /channels/:id`. Usar esse valor
 * mandava `Bearer ***` ao Airbnb (HTTP 401) e o envio direto pela conta escolhida falhava sempre. Aqui o token
 * só vale se for um token de verdade: nulo, vazio, curto (< 10) ou mascarado ⇒ indisponível, sem nenhuma
 * chamada ao Airbnb. Pura.
 */
export const MIN_TOKEN_LENGTH = 10;

export function isMaskedOrUnusableToken(t: unknown): boolean {
  if (typeof t !== "string") return true;
  const v = t.trim();
  if (v.length < MIN_TOKEN_LENGTH) return true;
  if (/^\*+$/.test(v) || v.includes("***")) return true;
  return false;
}

/** Token utilizável das configurações do canal, ou null (canal não-Airbnb, token inválido, mascarado ou vencendo). */
export function usableAirbnbToken(
  attributes: { channel?: unknown; settings?: { token_invalid?: unknown; tokens?: { access_token?: unknown; expires_at?: unknown } } } | null | undefined,
  nowMs: number = Date.now(),
): string | null {
  if (!attributes || attributes.channel !== "AirBNB") return null;
  const s = attributes.settings ?? {};
  if (s.token_invalid) return null;
  const t = s.tokens?.access_token;
  if (isMaskedOrUnusableToken(t)) return null;
  const exp = Number(s.tokens?.expires_at ?? 0);
  if (exp && exp * 1000 < nowMs + 60_000) return null;
  return String(t).trim();
}
