import { describe, it, expect } from "vitest";
import { ensureGreeting, isCourtesyEcho } from "../greeting";

const now = new Date("2026-10-19T23:24:00Z");
describe("saudação de retomada", () => {
  it("cumprimenta de novo, de forma simples, após 3h+ sem falarmos", () => {
    const h = [{ role: "assistant", content: "Olá, Izabela!", at: "2026-10-19T11:01:00Z" }, { role: "user", content: "tem ferro?" }];
    const out = ensureGreeting("Infelizmente não temos ferro.", h, "Izabela", "pt", now);
    expect(out).toMatch(/^(Olá|Oi), Izabela! Infelizmente/);
  });
  it("não cumprimenta de novo com menos de 3h", () => {
    const h = [{ role: "assistant", content: "Olá, Izabela!", at: "2026-10-19T22:30:00Z" }, { role: "user", content: "tem ferro?" }];
    expect(ensureGreeting("Não temos.", h, "Izabela", "pt", now)).toBe("Não temos.");
  });
});

describe("fim do ping-pong", () => {
  const h = [{ role: "assistant", content: "Obrigada pelo envio do comprovante, Rayany." }];
  it("silencia retribuição após nosso agradecimento", () => {
    expect(isCourtesyEcho("Mto obrigada nós!!", h)).toBe(true);
  });
  it("responde quando o hóspede pergunta algo novo", () => {
    expect(isCourtesyEcho("Obrigada! Que horas é o checkout?", h)).toBe(false);
  });
});
