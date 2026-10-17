import { describe, it, expect } from "vitest";
import { humanSupportReply, isOnlyGreeting, stripPromiseSentences } from "@/lib/ai/human-support";

const manha = new Date("2026-10-17T13:00:00Z");
describe("apoio humano sem promessa", () => {
  it("remove 'vou confirmar isso e já te respondo'", () => {
    expect(stripPromiseSentences("Olá, Fernanda! Bom dia! Vou confirmar isso e já te respondo.")).toBe("Olá, Fernanda! Bom dia!");
  });
  it("primeira fala = só saudação", () => {
    expect(humanSupportReply([], "Fernanda", "pt-BR", manha)).toBe("Olá, Fernanda! Bom dia!");
  });
  it("já falou antes = silêncio", () => {
    expect(humanSupportReply([{ role: "assistant", content: "Oi" }], "Fernanda", "pt-BR", manha)).toBe("[SILENCIO]");
  });
  it("detecta texto só de saudação", () => {
    expect(isOnlyGreeting("Olá, Fernanda! Bom dia!")).toBe(true);
    expect(isOnlyGreeting("Olá! O check-in é às 15h.")).toBe(false);
  });
});
