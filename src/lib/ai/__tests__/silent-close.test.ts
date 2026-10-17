import { describe, expect, it } from "vitest";
import { isCheckoutProgress, isEntryProgress, SILENT_CLOSE_AFTER_MS, silentCloseText } from "../silent-close";

describe("encerramento por silêncio", () => {
  it("prazo é de 10 minutos", () => {
    expect(SILENT_CLOSE_AFTER_MS).toBe(600_000);
  });
  it("passo de entrada que deu certo conta", () => {
    expect(isEntryProgress("Deu certo")).toBe(true);
    expect(isEntryProgress("abriu o cofre")).toBe(true);
  });
  it("negação não conta", () => {
    expect(isEntryProgress("não deu certo")).toBe(false);
  });
  it("saída confirmada conta, plano não", () => {
    expect(isCheckoutProgress("Já saímos, deixei a chave no cofre")).toBe(true);
    expect(isCheckoutProgress("vamos sair amanhã cedo")).toBe(false);
  });
  it("mensagem de check-in termina com a finalização combinada", () => {
    expect(silentCloseText("checkin", "rafael silva")).toMatch(/^Rafael, .*Excelente estadia! 💜$/);
  });
});
