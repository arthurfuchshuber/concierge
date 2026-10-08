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
});
