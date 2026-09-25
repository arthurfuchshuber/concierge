import { describe, expect, it } from "vitest";
import { scorePropertyMatch } from "../fuzzy-match";

const florata = { nome: "Residência Florata", proprietario: "Arthur Mendes", endereco: "Rua X", cidade: "Foz" };
const s104 = { nome: "Studio 104", proprietario: "Cleiton Chagas", endereco: "Av Y", cidade: "Foz" };

describe("scorePropertyMatch", () => {
  it("acha por nome + proprietário soltos", () => {
    expect(scorePropertyMatch("residência Florata/Arthur", florata).score).toBeGreaterThanOrEqual(2);
    expect(scorePropertyMatch("residência Florata/Arthur", s104).score).toBe(0);
  });
  it("acha só pelo proprietário", () => {
    expect(scorePropertyMatch("Casa do proprietário Arthur", florata).score).toBeGreaterThanOrEqual(2);
  });
  it("tolera erro de digitação", () => {
    expect(scorePropertyMatch("Floratta", florata).score).toBeGreaterThanOrEqual(2);
  });
  it("acha número", () => {
    expect(scorePropertyMatch("104", s104).score).toBeGreaterThanOrEqual(2);
    expect(scorePropertyMatch("estudio 104", s104).score).toBeGreaterThanOrEqual(2);
  });
});
