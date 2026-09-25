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

type PassPayload = { s: string; n: string; e: number };

function secret(): string {
  const s = process.env["GUEST_PASS_SECRET"];
  if (!s) throw new Error("Serviço temporariamente indisponível. Tente de novo em instantes.");
  return s;
}

function b64(buf: Buffer | string) {
  return Buffer.from(buf).toString("base64url");
}

export function signGuestPass(scope: string, name: string, ttlDays = 30): string {
  const payload: PassPayload = { s: scope, n: name.slice(0, 80), e: Date.now() + ttlDays * 86_400_000 };
  const body = b64(JSON.stringify(payload));
  const sig = b64(createHmac("sha256", secret()).update(body).digest());
  return `${body}.${sig}`;
}

/** Devolve o nome do titular se o passe for válido para o escopo; senão null. */
export function verifyGuestPass(token: string | null | undefined, scope: string): string | null {
  if (!token || token.length > 1000) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret()).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf-8")) as PassPayload;
    if (p.s !== scope || typeof p.e !== "number" || p.e < Date.now()) return null;
    return p.n || null;
  } catch {
    return null;
  }
}

export const GUEST_PASS_MISSING =
  "Para usar a IA, faça primeiro sua identificação no guia (nome e, se pedido, o código da reserva).";
