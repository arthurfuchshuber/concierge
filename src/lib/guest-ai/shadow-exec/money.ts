/**
 * F2-B · B3.3 · Entrega 3.1 — ARITMÉTICA MONETÁRIA EXATA do Shadow.
 *
 * Todo valor em dinheiro é um INTEIRO de unidades de 1e-8 US$ (`bigint`): sem ponto flutuante em
 * reserva, liquidação, comparação com teto ou registro. A ponte com o banco é texto decimal com 8 casas
 * (`numeric(14, 8)` na migration), convertido sem perda nos dois sentidos.
 *
 * Preço por token: `pricePerMTok × 1e8 / 1e6` unidades — precisa ser INTEIRO exato (preço com fração
 * que não cabe em 1e-8 por token ⇒ `null` ⇒ o chamador bloqueia; nunca arredonda dinheiro).
 * Arquivo puro: sem banco, rede ou relógio.
 */
export type Usd8 = bigint;

export const USD8_PER_USD = 100_000_000n;
const DECIMAL_RE = /^(\d{1,6})(?:\.(\d{1,8}))?$/;

/** Unidades por token de um preço por milhão (US$). Fração não representável ⇒ `null`. */
export function unitsPerToken(pricePerMTokUsd: number): Usd8 | null {
  if (typeof pricePerMTokUsd !== "number" || !Number.isFinite(pricePerMTokUsd) || pricePerMTokUsd < 0) return null;
  const units = pricePerMTokUsd * 100; // × 1e8 / 1e6
  const rounded = Math.round(units);
  return Math.abs(units - rounded) < 1e-9 && Number.isSafeInteger(rounded) ? BigInt(rounded) : null;
}

/** Custo exato de um uso (tokens inteiros não negativos). Entrada inválida ⇒ `null`. */
export function costUnits(price: { input: number; output: number }, inputTokens: number, outputTokens: number): Usd8 | null {
  const pi = unitsPerToken(price.input);
  const po = unitsPerToken(price.output);
  if (pi === null || po === null) return null;
  if (![inputTokens, outputTokens].every((n) => Number.isSafeInteger(n) && n >= 0)) return null;
  return BigInt(inputTokens) * pi + BigInt(outputTokens) * po;
}

/** Texto decimal (≤ 8 casas, sem sinal) → unidades. Formato inválido ⇒ `null`. Aceita número finito exato. */
export function parseUsd8(v: unknown): Usd8 | null {
  // número: só se o decimal de 8 casas o representa EXATAMENTE (nada de arredondar dinheiro em silêncio)
  const s = typeof v === "number" ? (Number.isFinite(v) && v >= 0 && Number(v.toFixed(8)) === v ? v.toFixed(8) : "") : typeof v === "string" ? v : "";
  const m = DECIMAL_RE.exec(s);
  if (!m) return null;
  return BigInt(m[1]!) * USD8_PER_USD + BigInt((m[2] ?? "").padEnd(8, "0"));
}

/** Unidades → texto decimal com 8 casas (formato do `numeric(14, 8)`). */
export function toDecimal8(u: Usd8): string {
  if (u < 0n) throw new RangeError("negative_usd");
  const whole = u / USD8_PER_USD;
  const frac = (u % USD8_PER_USD).toString().padStart(8, "0");
  return `${whole}.${frac}`;
}

export const ZERO_USD8 = "0.00000000";
export const USD8_DECIMAL_RE = /^\d{1,6}\.\d{8}$/;
