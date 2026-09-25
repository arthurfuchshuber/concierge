/**
 * PASSE DE IDENTIFICAÇÃO (25/09/2026 — pedido do cliente: IA paga só para
 * quem se identificou).
 *
 * Token assinado (HMAC-SHA256) emitido pelo servidor quando:
 *  - "guide:<propertyId>": o hóspede informou nome (e, nos guias com código
 *    de reserva, um código válido);
 *  - "landing": o visitante deixou nome e contato no formulário do site.
 * Nada no navegador consegue fabricar um passe sem o segredo.
 */
import { createHmac, timingSafeEqual } from "crypto";

type PassPayload = { s: string; n: string; e: number; v?: 1 };

function secret(): string {
  const s = process.env["GUEST_PASS_SECRET"];
  if (!s) throw new Error("Serviço temporariamente indisponível. Tente de novo em instantes.");
  return s;
}

function b64(buf: Buffer | string) {
  return Buffer.from(buf).toString("base64url");
}

export function signGuestPass(scope: string, name: string, ttlDays = 30, verified = false): string {
  const payload: PassPayload = { s: scope, n: name.slice(0, 80), e: Date.now() + ttlDays * 86_400_000 };
  if (verified) payload.v = 1;
  const body = b64(JSON.stringify(payload));
  const sig = b64(createHmac("sha256", secret()).update(body).digest());
  return `${body}.${sig}`;
}

/** Devolve o nome do titular se o passe for válido para o escopo; senão null. */
export function verifyGuestPass(token: string | null | undefined, scope: string): string | null {
  return verifyGuestPassInfo(token, scope)?.name ?? null;
}

/** Hash com segredo de um código curto (não dá para descobrir o código offline). */
export function codeDigest(code: string): string {
  return createHmac("sha256", secret()).update(`otp:${code}`).digest("base64url").slice(0, 32);
}

/** Como verifyGuestPass, mas diz também se a reserva foi conferida por código. */
export function verifyGuestPassInfo(
  token: string | null | undefined,
  scope: string,
): { name: string; verified: boolean } | null {
  if (!token || token.length > 1000) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret()).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf-8")) as PassPayload;
    if (p.s !== scope || typeof p.e !== "number" || p.e < Date.now()) return null;
    return p.n ? { name: p.n, verified: p.v === 1 } : null;
  } catch {
    return null;
  }
}

export const GUEST_PASS_MISSING =
  "Para usar a IA, faça primeiro sua identificação no guia (nome e, se pedido, o código da reserva).";
