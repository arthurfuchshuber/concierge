import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../system-prompt";

describe("recomendação investigativa (15/11/2026)", () => {
  const s = buildSystemPrompt("airbnb");
  it("pedido aberto: descobrir o gosto antes, uma pergunta por vez", () => {
    expect(s).toContain("Recomendação investigativa");
    expect(s).toContain("UMA pergunta curta e natural por vez");
  });
  it("pedido específico responde direto; consulta de reserva fica fora da regra", () => {
    expect(s).toContain("responda direto, sem interrogar");
    expect(s).toContain("Esta regra vale só para recomendações da cidade");
    expect(s).toContain("em consulta de reserva, seja objetivo nas dúvidas");
  });
  it("sem aspas no texto da regra", () => {
    const i = s.indexOf("Recomendação investigativa");
    expect(s.slice(i, i + 900)).not.toMatch(/["“”]/);
  });
});
