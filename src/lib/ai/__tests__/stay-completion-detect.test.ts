import { describe, it, expect } from "vitest";
import { detectStayCompletion } from "../stay-completion-detect";

describe("detectStayCompletion", () => {
  it("check-in quando o hóspede diz que entrou", () => {
    expect(detectStayCompletion("Entramos! Tudo certo", "")).toBe("checkin");
  });
  it("check-in quando a IA deu o encerramento de entrada", () => {
    expect(detectStayCompletion("Deu certo", "Maravilha, Rafael! ... Excelente estadia! 💜")).toBe("checkin");
  });
  it("chegar não é entrar", () => {
    expect(detectStayCompletion("Já chegamos no prédio", "Vocês já conseguiram entrar?")).toBeNull();
  });
  it("etapa intermediária não dá check-in", () => {
    expect(detectStayCompletion("Deu certo", "Perfeito! Agora suba até o Studio 105.")).toBeNull();
  });
  it("check-out quando saiu", () => {
    expect(detectStayCompletion("Já saímos e deixei a chave no cofre", "")).toBe("checkout");
  });
  it("plano de saída não é check-out", () => {
    expect(detectStayCompletion("Vamos sair amanhã cedo", "")).toBeNull();
  });
});

describe("checkout imediato", () => {
  it("'Estamos saindo agora' é checkout concluído", () => {
    expect(detectStayCompletion("Estamos saindo agora", "")).toBe("checkout");
  });
  it("'vamos sair mais tarde' não é", () => {
    expect(detectStayCompletion("Vamos sair mais tarde", "")).toBeNull();
  });
});

describe("checkout por contexto (20/10/2026)", () => {
  it("espaço liberado dá baixa", () => {
    expect(detectStayCompletion("Bom dia! Espaço liberado. Obrigada", "")).toBe("checkout");
  });
  it("despedida da IA (boa viagem) dá baixa", () => {
    expect(detectStayCompletion("Tudo certo por aqui, obrigada", "Agradecemos pela estadia. Boa viagem!")).toBe("checkout");
  });
  it("boa viagem com plano do hóspede não dá baixa", () => {
    expect(detectStayCompletion("Vamos sair amanhã cedo", "Boa viagem amanhã!")).toBeNull();
  });
});
