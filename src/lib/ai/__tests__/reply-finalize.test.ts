import { describe, expect, it } from "vitest";
import { finalizeAgentReply } from "../reply-finalize";

describe("finalizeAgentReply", () => {
  it("não adiciona assinatura em nenhum canal", () => {
    expect(finalizeAgentReply("Olá", "airbnb")).toBe("Olá");
    expect(finalizeAgentReply("Olá", "whatsapp")).toBe("Olá");
  });
  it("remove assinatura escrita pelo modelo", () => {
    expect(finalizeAgentReply("Olá\n\n[Assistente IA]", "airbnb")).toBe("Olá");
  });
  it("silêncio não envia nada", () => {
    expect(finalizeAgentReply("[SILENCIO]", "airbnb")).toBe("");
  });
  it("remove menção a comissão e repasse líquido, mantendo o valor bruto", () => {
    const r = finalizeAgentReply("O total da reserva é R$ 900. A comissão da plataforma é de 15%. O repasse líquido ao anfitrião é menor.", "airbnb");
    expect(r).toBe("O total da reserva é R$ 900.");
  });
  it("só conteúdo sensível vira resposta neutra", () => {
    expect(finalizeAgentReply("O valor líquido que recebo é R$ 700.", "airbnb")).toContain("valor total");
  });
});
