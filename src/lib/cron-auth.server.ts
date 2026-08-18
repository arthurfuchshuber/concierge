/**
 * Verificação do segredo compartilhado dos crons em tempo constante.
 * Evita canal lateral por tempo na comparação de `x-cron-secret`.
 */
export function isValidCronSecret(request: Request): boolean {
  const expected = process.env["CRON_SECRET"] ?? "";
  if (!expected) return false;
  const provided = request.headers.get("x-cron-secret") ?? "";
  const enc = new TextEncoder();
  const b = enc.encode(expected);
  const a = enc.encode(provided.padEnd(expected.length, "\0").slice(0, expected.length));
  let diff = provided.length !== expected.length ? 1 : 0;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
