/**
 * "Proprietário do Imóvel: X" / "Proprietária do Imóvel: X" (pedido de 08/10/2026).
 *
 * O cadastro do proprietário não tem campo de gênero, então ele é inferido pelo
 * PRIMEIRO NOME — só para escolher a palavra do rótulo, nunca para regra de
 * negócio. Critério, nesta ordem:
 *   1. nome na lista de femininos que não terminam em "a" (Beatriz, Raquel…);
 *   2. nome na lista de masculinos que terminam em "a" (Luca, Joshua…);
 *   3. terminou em "a" → feminino;
 *   4. qualquer outro caso (inclusive nome desconhecido) → masculino, que é o
 *      rótulo que o sistema já usava.
 * Se um nome sair errado, basta incluí-lo numa das duas listas.
 */
const FEMININOS_SEM_A = new Set([
  "beatriz", "raquel", "rachel", "ester", "esther", "isabel", "miriam", "ingrid", "lilian", "lillian",
  "carmen", "liz", "elizabeth", "michele", "marlene", "aline", "simone", "suzane", "viviane", "daniele",
  "adriane", "denise", "eliane", "rose", "cristiane", "jaqueline", "joyce", "karine", "maitê", "mayara",
  "nathalie", "priscilla", "tatiane", "valquiria", "vanessa", "yasmin", "noemi", "inês", "ines", "dolores",
  "mercedes", "ruth", "lais", "laís", "thais", "thaís", "luciane", "rosane", "rosângela", "fabiane",
  "alice", "bruna", "tais", "cleide", "eunice", "irene", "lucilene", "marisa", "solange", "sueli", "suely",
  "marines", "gisele", "giselle", "michelle", "danielle", "isabelle", "gabrielle", "stephanie", "stefanie",
]);

const MASCULINOS_COM_A = new Set([
  "luca", "joshua", "elias", "mica", "nikita", "barnabá", "josué", "noa", "jonata", "juca", "zeca",
  "bira", "caíque", "gilmar", "guilherme", "sacha", "misha", "yoshua", "isaias", "isaías", "matias",
  "tobias", "zacarias", "jeremias", "nicolas", "lucas", "andreas", "thomas", "tomás",
]);

function normaliza(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

export function ownerIsFeminine(name: string | null | undefined): boolean {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  if (!first) return false;
  const n = normaliza(first);
  if (FEMININOS_SEM_A.has(n)) return true;
  if (MASCULINOS_COM_A.has(n)) return false;
  return n.endsWith("a");
}

/** "Proprietário do Imóvel: Arthur" · "Proprietária do Imóvel: Patrícia" (null sem nome). */
export function ownerPropertyLabel(name: string | null | undefined): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0];
  if (!first) return null;
  return `${ownerIsFeminine(name) ? "Proprietária" : "Proprietário"} do Imóvel: ${first}`;
}
