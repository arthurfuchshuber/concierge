import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "@/lib/guest-ai/system-prompt";

// Caso Carlos (16/11/2026): contestou a avaliação de 4 estrelas e a cobrança de uma taça após a saída.
describe("decisão já tomada (avaliação, cobrança de dano)", () => {
  const post = buildSystemPrompt("airbnb", undefined, { phase: "post_checkout" });
  it("acolhe sem tomar partido e não promete verificar nem encaminha", () => {
    expect(post).toMatch(/Avaliação já publicada, cobrança de dano/);
    expect(post).toMatch(/sem tomar partido/);
    expect(post).toMatch(/Não prometa checar, verificar, rever nem retornar/);
    expect(post).toMatch(/não marque encaminhamento à equipe por causa disso/);
  });
  it("não vale em consulta (sem estadia)", () => {
    expect(buildSystemPrompt("airbnb", undefined, { phase: "inquiry" })).not.toMatch(/Avaliação já publicada/);
  });
});
