/**
 * Busca aproximada de entidades citadas de forma vaga (imóvel, proprietário...).
 * Pura, sem banco — testável.
 */
export function normText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const STOP = new Set([
  "a", "o", "as", "os", "de", "da", "do", "das", "dos", "e", "em", "no", "na",
  "casa", "residencia", "imovel", "apto", "apartamento", "ap", "proprietario",
  "proprietaria", "dono", "dona", "tarefa", "tarefas", "studio", "estudio", "flat",
]);

export function tokens(s: string): string[] {
  return normText(s)
    .split(" ")
    .filter((t) => t && !STOP.has(t));
}

function lev1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let diff = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++diff > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return diff + (a.length - i) + (b.length - j) <= 1;
}

function tokenHit(q: string, words: string[]): boolean {
  return words.some(
    (w) =>
      w === q ||
      (q.length >= 3 && w.startsWith(q)) ||
      (/^\d+$/.test(q) && w.includes(q)) ||
      (q.length >= 5 && w.length >= 4 && lev1(q, w)),
  );
}

const WEIGHT = { nome: 3, proprietario: 2.5, endereco: 1.5, cidade: 1 } as const;
const LABEL = { nome: "nome", proprietario: "proprietário", endereco: "endereço", cidade: "cidade" };

/**
 * Pontua o quanto `query` bate com os campos. Score >= 2 = forte.
 * Todas as palavras batendo em algum campo dá bônus.
 */
export function scorePropertyMatch(
  query: string,
  fields: Record<keyof typeof WEIGHT, string>,
): { score: number; motivo: string } {
  const qs = tokens(query);
  if (!qs.length) return { score: 0, motivo: "" };
  const fieldWords = Object.fromEntries(
    (Object.keys(WEIGHT) as Array<keyof typeof WEIGHT>).map((k) => [k, normText(fields[k] ?? "").split(" ").filter(Boolean)]),
  ) as Record<keyof typeof WEIGHT, string[]>;
  let score = 0;
  let matched = 0;
  const why = new Set<string>();
  for (const q of qs) {
    let best = 0;
    let bestField: keyof typeof WEIGHT | null = null;
    for (const k of Object.keys(WEIGHT) as Array<keyof typeof WEIGHT>) {
      if (WEIGHT[k] > best && tokenHit(q, fieldWords[k])) {
        best = WEIGHT[k];
        bestField = k;
      }
    }
    if (bestField) {
      matched++;
      score += best;
      why.add(`${LABEL[bestField]}: ${fields[bestField]}`);
    }
  }
  if (!matched) return { score: 0, motivo: "" };
  score = score / qs.length + (matched === qs.length ? 1 : 0);
  return { score, motivo: [...why].join("; ") };
}
