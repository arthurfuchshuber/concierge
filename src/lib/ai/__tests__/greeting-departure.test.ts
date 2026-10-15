import { describe, expect, it } from "vitest";
import { ensureGreeting } from "../greeting";
import { isDepartureReport } from "../guest-safety.server";

describe("saudação única", () => {
  it("não duplica quando a IA já abre com 'Bem-vindos'", () => {
    expect(ensureGreeting("Bem-vindos, Jessica! Tem Wi-Fi.", [], "Jessica", "pt")).toBe("Bem-vindos, Jessica! Tem Wi-Fi.");
  });
  it("não cumprimenta de novo se a IA já respondeu na conversa", () => {
    expect(ensureGreeting("Tem Wi-Fi sim.", [{ role: "assistant", content: "Claro!" }], "Jessica", "pt")).toBe("Tem Wi-Fi sim.");
  });
});

describe("saída x falta de acesso", () => {
  it("'já saí e a casa está trancada' é saída", () => {
    expect(isDepartureReport("Já saí e a casa está trancada. A chave está no local combinado")).toBe(true);
  });
  it("'cheguei e a porta está trancada' não é saída", () => {
    expect(isDepartureReport("Cheguei e a porta está trancada")).toBe(false);
  });
});
