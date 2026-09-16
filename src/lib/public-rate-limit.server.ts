/**
 * Limitador de taxa em memória para rotas/funções públicas (hóspede anônimo).
 * Reinicia a cada deploy — suficiente para conter abuso e custo de API sem
 * pagar ida e volta ao banco a cada requisição.
 */

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function allowPublicRate(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }
    return true;
  }
  b.count += 1;
  return b.count <= max;
}

/** IP do cliente a partir dos cabeçalhos de proxy (Cloudflare / padrão). */
export function clientIpFrom(request: Request): string {
  const h = request.headers;
  return (
    h.get("cf-connecting-ip") ||
    (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "anon"
  );
}

/** Atalho: limita por IP e devolve true quando a requisição deve ser barrada. */
export function tooManyRequests(
  request: Request,
  scope: string,
  max = 30,
  windowMs = 60_000,
): boolean {
  return !allowPublicRate(`${scope}:${clientIpFrom(request)}`, max, windowMs);
}

export function rateLimitedResponse() {
  return new Response(JSON.stringify({ error: "Muitas requisições. Tente novamente em instantes." }), {
    status: 429,
    headers: { "Content-Type": "application/json" },
  });
}
