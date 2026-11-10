import { describe, it, expect } from "vitest";
import { markAutoRequested } from "../AiSuggestionCard";

describe("disjuntor da tela: geração automática uma vez por mensagem na sessão (10/11/2026)", () => {
  it("a mesma mensagem não pede de novo (remontagem, troca de conversa e volta, erro)", () => {
    expect(markAutoRequested("c1", "m1")).toBe(true);
    expect(markAutoRequested("c1", "m1")).toBe(false);
    expect(markAutoRequested("c1", "m1")).toBe(false);
  });
  it("nova mensagem do hóspede pede normalmente", () => {
    expect(markAutoRequested("c1", "m2")).toBe(true);
    expect(markAutoRequested("c2", "m1")).toBe(true);
  });
});
