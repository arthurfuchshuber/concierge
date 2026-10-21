import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
const src = readFileSync("src/lib/ai/orchestrator.server.ts", "utf8");
describe("discernimento do que deu certo na entrada", () => {
  it("última barreira + 'td certo' conclui a entrada e proíbe pedir aviso", () => {
    expect(src).toContain("ENTRADA COMPLETA");
    expect(src).toContain('"td certo"');
    expect(src).toContain("PROIBIDO repetir passos restantes simples, pedir para avisar quando estiver dentro");
  });
  it("etapa intermediária entrega só o próximo passo e pergunta se consegue avançar", () => {
    expect(src).toContain("entregue SÓ o próximo passo");
    expect(src).toContain("consegue avançar até o imóvel a partir dali sem mais auxílio");
  });
});
