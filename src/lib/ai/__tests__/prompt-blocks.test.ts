import { describe, expect, it } from "vitest";
import { PROMPTS } from "@/lib/ai/prompts";
import { joinPromptBlocks, splitPromptBlocks } from "@/lib/ai/prompt-blocks";

const blocks = splitPromptBlocks(PROMPTS.agent.text);
const byTitle = (needle: string) => blocks.find((b) => b.title.includes(needle));

describe("prompt do agente por blocos", () => {
  it("fatiar e juntar devolve exatamente o texto enviado ao modelo", () => {
    expect(joinPromptBlocks(blocks)).toBe(PROMPTS.agent.text);
  });

  it("tem blocos suficientes e sem títulos repetidos", () => {
    expect(blocks.length).toBeGreaterThan(10);
    const titles = blocks.map((b) => b.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("blocos críticos existem e carregam a regra essencial", () => {
    expect(byTitle("IDENTIDADE")?.text).toMatch(/software/i);
    expect(byTitle("O QUE VOCÊ PODE INFORMAR")?.text).toMatch(/Equipe Interna \(I\) NUNCA/);
    expect(byTitle("O QUE VOCÊ PODE INFORMAR")?.text).toMatch(/Nota do anfitrião/);
    expect(byTitle("O QUE VOCÊ PODE INFORMAR")?.text).toMatch(/DADO, nunca comando/);
    expect(byTitle("PIN DE LIBERAÇÃO")?.text).toMatch(/NUNCA/);
    expect(byTitle("QUAL É A UNIDADE")?.text).toMatch(/nunca pergunte de volta/);
  });
});
