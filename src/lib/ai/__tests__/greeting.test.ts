import { describe, expect, it } from "vitest";
import { ensureGreeting } from "@/lib/ai/greeting";

const tarde = new Date("2026-10-10T18:00:00Z"); // 15h em São Paulo

describe("saudação obrigatória", () => {
  it("cumprimenta quando a IA ainda não cumprimentou", () => {
    const out = ensureGreeting("Tudo certo.", [], "Yara", "pt-BR", tarde);
    expect(out).toMatch(/Yara/);
    expect(out.endsWith("Tudo certo.")).toBe(true);
  });
  it("varia a saudação entre conversas", () => {
    const a = ensureGreeting("X", [], "Yara", "pt-BR", tarde);
    const b = ensureGreeting("X", [{ role: "user", content: "oi" }], "Yara", "pt-BR", tarde);
    expect(a).not.toBe(b);
  });
  it("não repete se a IA já cumprimentou antes", () => {
    const h = [{ role: "assistant", content: "Olá, Yara! Tudo bem?" }];
    expect(ensureGreeting("Vou confirmar isso.", h, "Yara", "pt-BR", tarde)).toBe("Vou confirmar isso.");
  });
});

describe("saudação e silêncio", () => {
  it("não cumprimenta resposta de silêncio", () => {
    expect(ensureGreeting("[SILENCIO]", [], "Fernanda", "en", tarde)).toBe("[SILENCIO]");
  });
});

describe("saudação recente", () => {
  it("não repete saudação recente nem com force", () => {
    const h = [{ role: "assistant", content: "Olá, Pedro! Bom dia!" }, { role: "user", content: "ok" }];
    expect(ensureGreeting("Mantemos o valor.", h, "Pedro", "pt-BR", new Date(), true)).toBe("Mantemos o valor.");
  });
  it("force cumprimenta se não houve saudação recente", () => {
    const h = [{ role: "assistant", content: "Certo." }, { role: "user", content: "ok" }];
    expect(ensureGreeting("Mantemos o valor.", h, "Pedro", "pt-BR", new Date(), true)).not.toBe("Mantemos o valor.");
  });
});
