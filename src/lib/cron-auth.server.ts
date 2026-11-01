/**
 * Verificação do segredo compartilhado dos crons, em tempo constante (evita canal lateral por tempo).
 *
 * Aceita o segredo em `Authorization: Bearer <CRON_SECRET>` (padrão) ou no cabeçalho histórico
 * `x-cron-secret` (os agendamentos já criados no banco continuam funcionando). Sem `CRON_SECRET`
 * configurado, NADA passa.
 */
function safeEqual(provided: string, expected: string): boolean {
  const enc = new TextEncoder();
  const b = enc.encode(expected);
  const a = enc.encode(provided.padEnd(expected.length, "\0").slice(0, expected.length));
  let diff = provided.length !== expected.length ? 1 : 0;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export function verifyCronSecret(request: Request): boolean {
  const expected = process.env["CRON_SECRET"] ?? "";
  if (!expected) return false;
  const auth = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim() ?? "";
  const legacy = request.headers.get("x-cron-secret") ?? "";
  // Avalia os dois (sem curto-circuito) para não vazar qual cabeçalho acertou.
  const okBearer = bearer ? safeEqual(bearer, expected) : false;
  const okLegacy = legacy ? safeEqual(legacy, expected) : false;
  return okBearer || okLegacy;
}

/** Nome histórico — mantido para as rotas que já o importam. */
export const isValidCronSecret = verifyCronSecret;

/** Resposta padrão para quem chama sem credencial válida. */
export function unauthorizedCronResponse(): Response {
  return Response.json({ error: "Unauthorized cron caller" }, { status: 401 });
}
