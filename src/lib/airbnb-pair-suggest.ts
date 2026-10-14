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
      .filter((w) => w.length > 2),
  );
function similarity(a: string, b: string): number {
  const x = tokens(a);
  const y = tokens(b);
  if (x.size === 0 || y.size === 0) return 0;
  let inter = 0;
  for (const w of x) if (y.has(w)) inter += 1;
  return inter / Math.max(x.size, y.size);
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
