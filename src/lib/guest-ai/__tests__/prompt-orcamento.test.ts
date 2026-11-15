import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../system-prompt";

/**
 * Orçamento de tamanho do prompt (15/11/2026).
 * Regra: ao corrigir um incidente, EDITE o parágrafo existente do mesmo assunto;
 * não acrescente outro. Se este teste quebrar, a saída é fundir/enxugar texto
 * repetido, não subir o limite. Subir o limite exige decisão explícita do dono
 * do produto, registrada no AGENTS.md.
 */
const MAX_TOTAL_CHARS = 75_000;
const MAX_PARAGRAPH_CHARS = 2_800;

describe("orçamento do system prompt", () => {
  for (const surface of ["airbnb", "whatsapp"] as const) {
    it(`${surface}: tamanho total e maior parágrafo dentro do orçamento`, () => {
      const prompt = buildSystemPrompt(surface as never);
      const longest = Math.max(...prompt.split("\n").map((l) => l.length));
      expect(prompt.length, "prompt acima do orçamento: funda parágrafos do mesmo assunto").toBeLessThanOrEqual(MAX_TOTAL_CHARS);
      expect(longest, "parágrafo acima do orçamento: divida só se for outro assunto").toBeLessThanOrEqual(MAX_PARAGRAPH_CHARS);
    });
  }
});
