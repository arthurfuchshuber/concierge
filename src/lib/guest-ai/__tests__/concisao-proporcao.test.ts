import { describe, expect, it } from "vitest";
import { personaPrinciples, renderPersona } from "../persona";

describe("persona: concisão, sem repetição, emoção proporcional e sem fecho (20/11/2026)", () => {
  const ids = personaPrinciples().map((p) => p.id);
  it("princípios presentes", () => {
    for (const id of ["short_by_default", "no_restating", "proportional_emotion", "no_wrap_up"]) expect(ids).toContain(id);
  });
  it("são descrições de comportamento, sem frases prontas entre aspas", () => {
    const txt = personaPrinciples()
      .filter((p) => ["short_by_default", "no_restating", "proportional_emotion", "no_wrap_up"].includes(p.id))
      .map((p) => p.guidance)
      .join("\n");
    expect(txt).not.toMatch(/["'“”]/);
    expect(renderPersona()).toContain("Mensagem curta é o padrão");
  });
});

import { buildSystemPrompt } from "../system-prompt";
describe("objeto esquecido após a saída (22/11/2026, caso Alana)", () => {
  const sys = buildSystemPrompt("airbnb");
  it("resposta curta em primeira pessoa, encaminha, sem interrogatório", () => {
    expect(sys).toMatch(/objeto esquecido no imóvel depois da saída/);
    expect(sys).toMatch(/Não interrogue antes \(cor, modelo, detalhes\)/);
  });
  it("persona proíbe abrir devolvendo o relato", () => {
    expect(renderPersona()).toMatch(/não abra devolvendo o relato da pessoa/);
  });
});
