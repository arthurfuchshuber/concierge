// Helpers de texto compartilhados entre painel e guia público.

// Palavras que devem ficar em minúsculo no meio do título (pt/en).
const LOWERCASE_WORDS = new Set([
  "a", "à", "ao", "aos", "as", "às", "da", "das", "de", "do", "dos",
  "e", "em", "na", "nas", "no", "nos", "o", "os", "ou", "por", "para",
  "the", "of", "and", "or", "in", "on", "at", "for", "to", "by", "an",
]);

// Tokens que devem permanecer em CAIXA ALTA (acrônimos comuns).
const UPPERCASE_TOKENS = new Set([
  "br", "eua", "usa", "uk", "se", "pr", "sc", "rs", "rj", "sp", "mg",
  "df", "ba", "pe", "ce", "go", "mt", "ms", "pa", "am", "to", "ap",
  "rr", "ro", "ac", "ma", "pi", "rn", "pb", "al", "es",
]);

function capitalize(word: string): string {
  if (!word) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

// Converte qualquer string para Title Case respeitando pt/en e acrônimos.
// Ex.: "IGUAZZU FALLS PARK" -> "Iguazzu Falls Park"
//      "cataratas do iguaçu" -> "Cataratas do Iguaçu"
//      "ITAIPU BINACIONAL - PR" -> "Itaipu Binacional - PR"
export function toTitleCase(input: string | null | undefined): string {
  if (!input) return "";
  const s = String(input).trim();
  if (!s) return "";

  // Mantém separadores (espaço, hífen, barra, ponto). Aplica a cada token alfanumérico.
  return s.split(/(\s+|[-/.·•])/).map((part, idx, arr) => {
    if (!/[A-Za-zÀ-ÿ]/.test(part)) return part; // separador
    const lower = part.toLowerCase();
    if (UPPERCASE_TOKENS.has(lower)) return part.toUpperCase();
    // Primeiro/último token sempre capitalizados, mesmo se "de"/"do".
    const isFirst = idx === 0;
    const isLast = idx === arr.length - 1;
    if (!isFirst && !isLast && LOWERCASE_WORDS.has(lower)) return lower;
    // Trata palavras com apóstrofe ou hífen interno: "D'Or" -> "D'Or"
    return part
      .split(/(['])/)
      .map((sub) => (sub === "'" ? sub : capitalize(sub)))
      .join("");
  }).join("");
}
