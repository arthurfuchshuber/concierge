import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../system-prompt";

describe("recomendação investigativa (15/11/2026)", () => {
  const s = buildSystemPrompt("airbnb");
  it("pedido aberto: no máximo uma pergunta curta, só se mudar a indicação", () => {
    expect(s).toContain("Recomendação investigativa");
    expect(s).toContain("no máximo UMA pergunta curta e natural, de uma linha");
    expect(s).toContain("Nunca faça questionário");
  });
  it("pedido específico responde direto; consulta de reserva fica fora da regra", () => {
    expect(s).toContain("indique direto: duas ou três opções");
    expect(s).toContain("Esta regra vale só para recomendações da cidade");
    expect(s).toContain("em consulta de reserva, seja objetivo nas dúvidas");
  });
  it("sem aspas no texto da regra", () => {
    const i = s.indexOf("Recomendação investigativa");
    expect(s.slice(i, i + 900)).not.toMatch(/["“”]/);
  });
});

describe("não inventar fatos sobre a equipe (auditoria 15/11/2026)", () => {
  it("proíbe expediente, escala e justificativa inventada de demora", () => {
    const s2 = buildSystemPrompt("airbnb");
    expect(s2).toContain("Nunca invente fatos sobre a equipe");
    expect(s2).toContain("horário de expediente");
    expect(s2).toContain("sem desculpa inventada");
    expect(s2).toContain("no que um atendente já disse nesta conversa");
  });
});
