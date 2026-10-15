/** Sugestão de pares imóvel → anúncio por nome parecido (sincronização em massa). */
const normName = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const tokens = (v: string) =>
  new Set(
    normName(v)
      .split(" ")
      .filter((w) => w.length > 2 || /\d/.test(w)),
  );
function similarity(a: string, b: string): number {
  const x = tokens(a);
  const y = tokens(b);
  if (x.size === 0 || y.size === 0) return 0;
  let inter = 0;
  for (const w of x) if (y.has(w)) inter += 1;
  // Números diferentes (Apê 2 x Apê 3, Studio 101 x 102) são imóveis diferentes. O telefone no
  // título do anúncio não atrapalha: basta os números de um lado estarem todos no outro.
  const nx = [...x].filter((w) => /\d/.test(w));
  const ny = [...y].filter((w) => /\d/.test(w));
  if (nx.length > 0 && ny.length > 0) {
    const inY = nx.every((w) => y.has(w));
    const inX = ny.every((w) => x.has(w));
    if (!inY && !inX) return 0;
  }
  const small = Math.min(x.size, y.size);
  const big = Math.max(x.size, y.size);
  // Anúncio com prefixo/sufixo a mais (telefone, nome do dono, "· Foz"): se TODAS as palavras do
  // nome mais curto estão no mais longo, é o mesmo imóvel. Exige 3+ palavras para não casar "Studio 2".
  if (small >= 3 && inter === small) return 0.75 + 0.25 * (inter / big);
  return inter / big;
}
/** Sugere pares por nome parecido (>= 60%); cada anúncio e cada imóvel entram uma vez só. */
export function suggestPairs(
  properties: Array<{ id: string; name: string }>,
  listings: Array<{ listingId: string; title: string }>,
): Record<string, string> {
  const scored: Array<{ p: string; l: string; s: number }> = [];
  for (const p of properties)
    for (const l of listings) {
      const s = normName(p.name) === normName(l.title) ? 1 : similarity(p.name, l.title);
      if (s >= 0.6) scored.push({ p: p.id, l: l.listingId, s });
    }
  scored.sort((a, b) => b.s - a.s);
  const out: Record<string, string> = {};
  const usedL = new Set<string>();
  for (const x of scored) {
    if (out[x.p] || usedL.has(x.l)) continue;
    out[x.p] = x.l;
    usedL.add(x.l);
  }
  return out;
}
