import { describe, expect, it } from "vitest";
import { maxStepsFor, reasoningFor } from "../reasoning";

describe("política de raciocínio", () => {
  it("reduz (sem zerar) em saudação e agradecimento", () => {
    for (const m of ["oi", "Olá", "bom dia", "ok", "obrigado!", "valeu", "tchau"]) {
      expect(reasoningFor(m)).toBe("medium");
    }
  });

  it("pensa fundo quando pedem o porquê, comparação ou recomendação", () => {
    for (const m of [
      "por que a pendência de manutenção já aparece na limpeza?",
      "qual a diferença entre limpeza normal e completa?",
      "me recomenda um restaurante bom aqui perto",
      "vale a pena antecipar o check-in?",
      "qual o melhor horário pra limpeza?",
    ]) {
      expect(reasoningFor(m), m).toBe("max");
    }
  });

  /**
   * 20/09/2026 — "não pode demorar tanto para responder". Pergunta de como o
   * sistema funciona não manda fazer nada e não pede julgamento: responde no
   * nível alto, que é o mesmo modelo chegando muito antes.
   */
  it("pergunta informativa responde em alto, não no topo", () => {
    expect(reasoningFor("como funciona o checkout automático?")).toBe("high");
    expect(reasoningFor("como faço para anexar um vídeo em uma limpeza?")).toBe("high");
    expect(reasoningFor("quantas limpezas eu tenho amanhã")).toBe("high");
  });

  it("pedido de gravação vai ao topo mesmo sem ninguém avisar", () => {
    expect(reasoningFor("exclua todas as pendências de limpeza do studio 105")).toBe("max");
    expect(reasoningFor("marca o checkout do 103 como concluído")).toBe("max");
  });

  it("pensa fundo quando há várias perguntas ou texto longo", () => {
    expect(reasoningFor("que horas é o checkout? e o wifi qual é?")).toBe("max");
    expect(reasoningFor("a".repeat(200))).toBe("max");
  });

  it("o padrão é o esforço máximo", () => {
    expect(reasoningFor("quantas limpezas eu tenho amanhã")).toBe("max");
    expect(reasoningFor("o studio 105 está ocupado hoje")).toBe("max");
  });

  it("reduz um pouco numa consulta pontual de um dado só", () => {
    expect(reasoningFor("que horas é o checkout?")).toBe("xhigh");
    expect(reasoningFor("qual é a senha do wifi?")).toBe("xhigh");
  });

  it("nunca deixa um pedido de ação no mínimo", () => {
    // "ok" sozinho é trivial, mas no painel toda mensagem pode virar gravação.
    expect(reasoningFor("ok", { isAction: true })).toBe("max");
    expect(reasoningFor("abre uma pendência no 105", { isAction: true })).toBe("max");
  });

  it("risco alto manda direto para o topo", () => {
    expect(reasoningFor("oi", { highRisk: true })).toBe("max");
  });

  it("não confunde um 'ok' que continua numa pergunta de verdade", () => {
    expect(reasoningFor("ok, mas por que a limpeza mudou de dia?")).toBe("max");
  });

  it("dá mais passos de ferramenta a quem pensa mais", () => {
    expect(maxStepsFor("max")).toBeGreaterThanOrEqual(maxStepsFor("high"));
    expect(maxStepsFor("high")).toBeGreaterThan(maxStepsFor("medium"));
    expect(maxStepsFor("medium")).toBeGreaterThan(maxStepsFor("low"));
  });
});
