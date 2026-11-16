import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../system-prompt";

/**
 * Orçamento de tamanho do prompt (15/11/2026; revisto em 16/11/2026 por decisão do titular).
 * O objetivo é um prompt LIMPO e SEM REDUNDÂNCIA, não caber num número: nunca corte conteúdo útil só para caber.
 * Regra: ao corrigir um incidente, EDITE o parágrafo existente do mesmo assunto; não acrescente outro nem repita
 * o que já está dito em outro lugar. O limite abaixo é só um alarme contra inchaço; se disparar, a saída é fundir
 * texto repetido, e subi-lo exige decisão explícita do dono do produto, registrada no AGENTS.md.
 */
const MAX_TOTAL_CHARS = 85_000;
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
