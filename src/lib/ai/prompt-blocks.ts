/**
 * O prompt do agente é um texto longo dividido em seções de TÍTULO EM MAIÚSCULAS ("IDENTIDADE",
 * "O QUE VOCÊ PODE INFORMAR, E A QUEM…"). Aqui ele é fatiado nessas seções para poder ser TESTADO por bloco
 * (cada regra crítica existe, ninguém apagou um bloco por engano, títulos não se repetem) sem alterar o texto
 * enviado ao modelo: juntar os blocos devolve exatamente o texto original.
 */
export type PromptBlock = { title: string; text: string };

/** Linha de título: começa com maiúscula, sem minúsculas, ao menos 8 letras, sem pontuação final de frase. */
export function isBlockTitle(line: string): boolean {
  const t = line.trim();
  if (t.length < 8 || t.startsWith("-") || t.startsWith("#")) return false;
  // o título é a parte em maiúsculas antes de " — " (o que vem depois é um complemento em texto livre)
  const head = t.split(" — ")[0]!;
  const letters = head.replace(/[^A-Za-zÀ-ÿ]/g, "");
  if (letters.length < 6) return false;
  if (letters !== letters.toUpperCase()) return false;
  // permite um complemento entre parênteses em minúsculas: "TÍTULO (obrigatório)"
  return !/[.!?]$/.test(t) && head.length >= 8;
}

export function splitPromptBlocks(text: string): PromptBlock[] {
  const lines = text.split("\n");
  const blocks: PromptBlock[] = [];
  let cur: { title: string; lines: string[] } = { title: "ABERTURA", lines: [] };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const prevBlank = i === 0 || lines[i - 1]!.trim() === "";
    const base = line.replace(/\([^)]*\)/g, "").trim();
    if (prevBlank && (isBlockTitle(line) || (base !== line.trim() && isBlockTitle(base)))) {
      blocks.push({ title: cur.title, text: cur.lines.join("\n") });
      cur = { title: (base || line.trim()).split(" — ")[0]!, lines: [line] };
    } else {
      cur.lines.push(line);
    }
  }
  blocks.push({ title: cur.title, text: cur.lines.join("\n") });
  return blocks;
}

export function joinPromptBlocks(blocks: PromptBlock[]): string {
  return blocks.map((b) => b.text).join("\n");
}
