import { describe, expect, it } from "vitest";
import { finalizeAgentReply } from "../reply-finalize";

describe("finalizeAgentReply", () => {
  it("Airbnb recebe assinatura em texto puro", () => {
    expect(finalizeAgentReply("Olá", "airbnb")).toBe("Olá\n\n[Assistente IA]");
  });
  it("WhatsApp/Guia recebem assinatura em itálico", () => {
    expect(finalizeAgentReply("Olá", "whatsapp")).toBe("Olá\n\n_[Assistente IA]_");
    expect(finalizeAgentReply("Olá", "platform_chat")).toBe("Olá\n\n_[Assistente IA]_");
  });
  it("silêncio não envia nada", () => {
    expect(finalizeAgentReply("[SILENCIO]", "airbnb")).toBe("");
  });
});
