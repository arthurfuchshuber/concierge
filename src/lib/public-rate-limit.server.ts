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

/* ------------------------------------------------------------------ *
 * Tetos diários de uso pago (custo de IA/serviços externos)
 *
 * Rotas públicas do guia chamam serviços pagos. O limite por minuto contém
 * rajada, mas não contém uso constante e distribuído ao longo do dia. Estes
 * tetos limitam o custo total por chave (sessão, imóvel, IP ou global) num
 * dia — quando estouram, a operação paga simplesmente não acontece.
 * ------------------------------------------------------------------ */

type DailyBucket = { day: string; count: number };
const dailyBuckets = new Map<string, DailyBucket>();

/** true quando ainda há orçamento do dia para essa chave (e consome 1). */
export function allowDailyBudget(key: string, max: number): boolean {
  const day = new Date().toISOString().slice(0, 10);
  const b = dailyBuckets.get(key);
  if (!b || b.day !== day) {
    dailyBuckets.set(key, { day, count: 1 });
    if (dailyBuckets.size > 20_000) {
      for (const [k, v] of dailyBuckets) if (v.day !== day) dailyBuckets.delete(k);
    }
    return true;
  }
  b.count += 1;
  return b.count <= max;
}

/**
 * Freio de custo padrão das rotas públicas pagas: teto por sessão do hóspede,
 * por imóvel e global no dia. Devolve false quando qualquer um estourar.
 */
export function allowPaidGuestUse(params: {
  scope: string;
  propertyId: string;
  sessionId?: string | null;
  perSession?: number;
  perProperty?: number;
  global?: number;
}): boolean {
  const { scope, propertyId } = params;
  const perSession = params.perSession ?? 30;
  const perProperty = params.perProperty ?? 200;
  const global = params.global ?? 3000;
  if (params.sessionId && !allowDailyBudget(`${scope}:s:${params.sessionId}`, perSession)) return false;
  if (!allowDailyBudget(`${scope}:p:${propertyId}`, perProperty)) return false;
  if (!allowDailyBudget(`${scope}:g`, global)) return false;
  return true;
}
