/**
 * Check-in antes do horário permitido (08/10/2026): a IA só pode registrar se
 * citar um trecho que EXISTA de verdade numa mensagem da equipe.
 */
import { describe, it, expect } from "vitest";
import { quoteExistsInStaffMessages, type StaffMessage } from "@/lib/ai/stay-events.server";

const msgs: StaffMessage[] = [
  {
    id: "1",
    canal: "airbnb",
    quando: "2026-10-07T12:00:00Z",
    nota_interna: false,
    texto: "Pode entrar às 12h sem problema, o apartamento já está liberado!",
  },
  { id: "2", canal: "guia", quando: "2026-10-07T13:00:00Z", nota_interna: true, texto: "Liberei early check-in às 11h." },
];

describe("autorização de check-in antecipado", () => {
  it("aceita trecho que existe (ignora acento, caixa e espaços)", () => {
    expect(quoteExistsInStaffMessages("pode entrar as 12h  sem problema", msgs)).toBe(true);
    expect(quoteExistsInStaffMessages("Liberei early check-in às 11h", msgs)).toBe(true);
  });
  it("recusa trecho inventado ou curto demais", () => {
    expect(quoteExistsInStaffMessages("pode entrar a qualquer hora", msgs)).toBe(false);
    expect(quoteExistsInStaffMessages("pode", msgs)).toBe(false);
    expect(quoteExistsInStaffMessages("", msgs)).toBe(false);
  });
});
