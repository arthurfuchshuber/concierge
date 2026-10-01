import { normText } from "@/lib/ai/fuzzy-match";

/** Busca tolerante (mesma regra da página Guias): ignora acentos/maiúsculas,
 * casa prefixo de palavra e aceita 1 erro de digitação em termos com 5+ letras.
 * Devolve 0 quando algum termo não casa; >0 é a relevância. */
export function searchScore(q: string, fields: [unknown, number][]): number {
  const qs = normText(q).split(" ").filter(Boolean);
  if (!qs.length) return 1;
  let total = 0;
  for (const t of qs) {
    let best = 0;
    for (const [f, w] of fields) {
      if (!f) continue;
      const words = normText(String(f)).split(" ").filter(Boolean);
      const hit = words.some((x) => x.startsWith(t) || (t.length >= 5 && near1(t, x.slice(0, t.length + 1))));
      if (hit && w > best) best = w;
    }
    if (!best) return 0;
    total += best;
  }
  return total;
}

function near1(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return Math.min(...d[m]) <= 1;
}
