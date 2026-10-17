/**
 * PORTUGUÊS TRADUZÍVEL (17/10/2026) — canais em que a plataforma traduz a
 * resposta para o hóspede (Airbnb) e onde a IA sempre escreve em português.
 *
 * O que quebra numa tradução automática: gíria e abreviação ("pra", "tá",
 * "vc"), expressão idiomática ("fique à vontade", "qualquer coisa"), sujeito
 * oculto, pronome ambíguo, frase longa com várias ideias e data/hora ambígua.
 * Duas camadas: orientação ao modelo (o que escrever) e um normalizador
 * determinístico (o que sobra de abreviação). Nunca mexe em números, horários,
 * links, códigos ou nomes.
 */

export function translatableGuidance(): string {
  return [
    "\n\nPORTUGUÊS TRADUZÍVEL (obrigatório neste canal — a plataforma traduz automaticamente sua resposta)",
    "- Frases curtas, uma ideia por frase, ordem direta (sujeito, verbo, complemento). Sem sujeito oculto: diga quem faz a ação.",
    "- Sem gíria, sem abreviação (escreva 'para', 'está', 'você', 'também'), sem regionalismo e sem expressão idiomática (evite 'fique à vontade', 'qualquer coisa me chama', 'dar um jeito', 'ficar de olho', 'sem estresse').",
    "- Evite pronomes ambíguos ('ele', 'isso', 'lá') quando houver mais de uma referência possível: repita o substantivo.",
    "- Datas por extenso com o mês ('17 de outubro'), horários no formato '15:00' ou '15h'. Nomes de lugares, ruas e códigos ficam exatamente como estão.",
    "- Um emoji no máximo e nunca com sentido essencial para a frase (a tradução pode perdê-lo).",
    "- Instruções em passos numerados curtos, um verbo de ação por passo.",
  ].join("\n");
}

const WORD = (w: string) => new RegExp(`(?<![\\p{L}\\p{N}])${w}(?![\\p{L}\\p{N}])`, "giu");

const SWAPS: Array<[RegExp, string]> = [
  [WORD("pra"), "para"],
  [WORD("pro"), "para o"],
  [WORD("tá"), "está"],
  [WORD("tô"), "estou"],
  [WORD("vc"), "você"],
  [WORD("vcs"), "vocês"],
  [WORD("tbm"), "também"],
  [WORD("tb"), "também"],
  [WORD("pq"), "porque"],
  [WORD("blz"), "certo"],
  [WORD("né"), "certo"],
  [WORD("hrs"), "horas"],
  [WORD("hs"), "h"],
  [WORD("obg"), "obrigada"],
  [WORD("msg"), "mensagem"],
];

/** Preserva a caixa inicial da palavra trocada ("Pra" → "Para"). */
function keepCase(from: string, to: string): string {
  return from[0] && from[0] === from[0].toUpperCase() && from[0] !== from[0].toLowerCase()
    ? to.charAt(0).toUpperCase() + to.slice(1)
    : to;
}

export function makeTranslatable(text: string): string {
  let out = text;
  for (const [re, to] of SWAPS) out = out.replace(re, (m) => keepCase(m, to));
  return out
    .replace(/\s*\.{3,}\s*/g, ". ")
    .replace(/!{2,}/g, "!")
    .replace(/\?{2,}/g, "?")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
