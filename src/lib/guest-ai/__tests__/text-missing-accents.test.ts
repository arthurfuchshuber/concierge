import { describe, expect, it } from "vitest";
import { TEXT_BLOCKS, missingPortugueseAccents } from "@/lib/guest-ai/validation/commitment-text";

const RICARDO =
  "Boa tarde, Ricardo! Excelente, o studio ja esta pronto esperando por voces. As instrucoes de entrada estao disponiveis no guia que enviamos anteriormente. Quando chegarem, basta seguir o passo a passo pelo cadeado-cofre do portao.";

describe("resposta em português sem acentos (16/11/2026, caso Ricardo)", () => {
  it("é um bloqueio conhecido (gera uma nova tentativa)", () => {
    expect(TEXT_BLOCKS).toContain("text_missing_accents");
  });
  it("texto longo em português sem nenhum acento ⇒ bloqueia", () => {
    expect(missingPortugueseAccents(RICARDO, "pt")).toBe(true);
  });
  it("o mesmo texto acentuado ⇒ ok", () => {
    expect(missingPortugueseAccents(RICARDO.replace("ja esta", "já está").replace("voces", "vocês"), "pt")).toBe(false);
  });
  it("texto curto, outro idioma ou só link ⇒ não bloqueia", () => {
    expect(missingPortugueseAccents("Boa tarde, Ricardo! Combinado.", "pt")).toBe(false);
    expect(missingPortugueseAccents("Good afternoon Ricardo, the studio is ready for you and the check in instructions are in the guide we sent you earlier today, thanks a lot for letting us know your time", "en")).toBe(false);
    expect(missingPortugueseAccents("https://www.airbnb.com.br/rooms/1793590014642613896", "pt")).toBe(false);
  });
});

import { analyzeReplyCommitments } from "@/lib/guest-ai/validation/commitment-text";
describe("detector de idioma com texto sem acentos", () => {
  it("o texto do caso Ricardo é reconhecido como português (a checagem dispara no fluxo real)", () => {
    expect(analyzeReplyCommitments(RICARDO, {} as never).language).toBe("pt");
  });
});
