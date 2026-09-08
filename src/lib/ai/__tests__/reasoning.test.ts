import { describe, expect, it } from "vitest";
import { maxStepsFor, reasoningFor } from "../reasoning";

describe("política de raciocínio", () => {
  it("não gasta raciocínio em saudação e agradecimento", () => {
    for (const m of ["oi", "Olá", "bom dia", "ok", "obrigado!", "valeu", "tchau"]) {
      expect(reasoningFor(m)).toBe("low");
    }
  });

  it("pensa fundo quando pedem o porquê, comparação ou recomendação", () => {
    for (const m of [
      "por que a pendência de manutenção já aparece na limpeza?",
      "qual a diferença entre limpeza normal e completa?",
      "me recomenda um restaurante bom aqui perto",
      "vale a pena antecipar o check-in?",
      "como funciona o checkout automático?",
      "qual o melhor horário pra limpeza?",
    ]) {
      expect(reasoningFor(m), m).toBe("high");
    }
  });

  it("pensa fundo quando há várias perguntas ou texto longo", () => {
    expect(reasoningFor("que horas é o checkout? e o wifi qual é?")).toBe("high");
    expect(reasoningFor("a".repeat(200))).toBe("high");
  });

  it("usa o padrão médio numa pergunta objetiva comum", () => {
    expect(reasoningFor("quantas limpezas eu tenho amanhã")).toBe("medium");
    expect(reasoningFor("o studio 105 está ocupado hoje")).toBe("medium");
  });

  it("nunca deixa um pedido de ação no mínimo", () => {
    // "ok" sozinho é trivial, mas no painel toda mensagem pode virar gravação.
    expect(reasoningFor("ok", { isAction: true })).toBe("medium");
    expect(reasoningFor("abre uma pendência no 105", { isAction: true })).toBe("medium");
  });

  it("risco alto manda direto para o topo", () => {
    expect(reasoningFor("oi", { highRisk: true })).toBe("high");
  });

  it("não confunde um 'ok' que continua numa pergunta de verdade", () => {
    expect(reasoningFor("ok, mas por que a limpeza mudou de dia?")).toBe("high");
  });

  it("dá mais passos de ferramenta a quem pensa mais", () => {
    expect(maxStepsFor("high")).toBeGreaterThan(maxStepsFor("medium"));
    expect(maxStepsFor("medium")).toBeGreaterThan(maxStepsFor("low"));
  });
});
