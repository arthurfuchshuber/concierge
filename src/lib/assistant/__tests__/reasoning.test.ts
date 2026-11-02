import { describe, expect, it } from "vitest";
import { maxStepsFor, reasoningFor } from "../reasoning";

describe("política de raciocínio", () => {
  it("reduz (sem zerar) em saudação e agradecimento", () => {
    for (const m of ["oi", "Olá", "bom dia", "ok", "obrigado!", "valeu", "tchau"]) {
      expect(reasoningFor(m)).toBe("low");
    }
  });

  it("pensa fundo quando pedem o porquê ou comparação", () => {
    for (const m of [
      "por que a pendência de manutenção já aparece na limpeza?",
      "qual a diferença entre limpeza normal e completa?",
    ]) {
      expect(reasoningFor(m), m).toBe("max");
    }
  });

  /**
   * 22/09/2026 — indicar lugar é buscar e escolher, não deliberar. No topo,
   * "melhor restaurante perto daqui?" levava três minutos e o hóspede ficava
   * sem resposta; em "alto" a resposta é a mesma e chega a tempo.
   */
  it("pedido de indicação responde em alto", () => {
    for (const m of [
      "me recomenda um restaurante bom aqui perto",
      "vale a pena antecipar o check-in?",
      "qual o melhor horário pra limpeza?",
    ]) {
      expect(reasoningFor(m), m).toBe("high");
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
    expect(reasoningFor("marca o checkout do 103 como concluído")).toBe("high");
  });

  it("pensa fundo quando há várias perguntas ou texto longo", () => {
    expect(reasoningFor("que horas é o checkout? e o wifi qual é?")).toBe("max");
    expect(reasoningFor("a".repeat(200))).not.toBe("low");
  });

  it("assunto sensível (hóspede, dinheiro, cancelamento) vai ao topo", () => {
    expect(reasoningFor("o hóspede do 105 chegou?")).toBe("max");
    expect(reasoningFor("teve algum cancelamento essa semana")).toBe("max");
  });

  it("reduz um pouco numa consulta pontual de um dado só", () => {
    expect(reasoningFor("que horas é o checkout?")).toBe("medium");
    expect(reasoningFor("qual é a senha do wifi?")).toBe("medium");
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
