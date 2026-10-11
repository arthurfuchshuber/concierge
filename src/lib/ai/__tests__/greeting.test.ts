import { describe, expect, it } from "vitest";
import { ensureGreeting } from "@/lib/ai/greeting";

const tarde = new Date("2026-10-10T18:00:00Z"); // 15h em São Paulo

describe("saudação obrigatória", () => {
  it("cumprimenta quando a IA ainda não cumprimentou", () => {
    expect(ensureGreeting("Vou confirmar isso.", [], "Yara", "pt-BR", tarde)).toBe(
      "Olá, Yara! Boa tarde! Vou confirmar isso.",
    );
  });
  it("não repete se a IA já cumprimentou antes", () => {
    const h = [{ role: "assistant", content: "Olá, Yara! Tudo bem?" }];
    expect(ensureGreeting("Vou confirmar isso.", h, "Yara", "pt-BR", tarde)).toBe("Vou confirmar isso.");
  });
});
