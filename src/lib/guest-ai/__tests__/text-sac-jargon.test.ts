import { describe, expect, it } from "vitest";
import { hasSacJargon, TEXT_BLOCKS } from "../validation/commitment-text";

describe("jargão de SAC (rede de segurança do prompt)", () => {
  it("o bloco existe e segue o fluxo de nova tentativa dos blocos de texto", () => {
    expect(TEXT_BLOCKS).toContain("text_sac_jargon");
  });
  it.each([
    "Seu protocolo é 12345, aguarde.",
    "Sua solicitação foi encaminhada ao setor responsável.",
    "Estou transferindo você para o suporte.",
    "O chamado aberto número 88 está em análise.",
    "O sistema registrou o seu pedido.",
    "Agradecemos o seu contato!",
  ])("pega: %s", (t) => expect(hasSacJargon(t)).toBe(true));
  it.each([
    "Vou acionar a manutenção para verificar o aparelho e te aviso por aqui.",
    "Vou verificar internamente com a equipe a possibilidade de receber você nesse horário.",
    "O horário oficial de check-in é a partir das 15h.",
    "Pelas regras da plataforma, não é mais possível cancelar sem custo.",
  ])("não pega: %s", (t) => expect(hasSacJargon(t)).toBe(false));
});
