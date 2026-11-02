import { describe, expect, it } from "vitest";
import { NO_AI_HANDOFF_REASON, requestGuestAiReply } from "@/lib/guest-ai/slot.server";

/**
 * Ponto de extensão da IA de atendimento (01/11/2026): enquanto não há
 * implementação instalada, devolve `null` e os canais encaminham ao humano.
 * Este teste trava o contrato para a nova arquitetura ser plugada aqui.
 */
describe("guest-ai slot (sem implementação instalada)", () => {
  it("devolve null para qualquer canal", async () => {
    for (const surface of ["guide_chat", "whatsapp", "airbnb"] as const) {
      const r = await requestGuestAiReply({
        supabase: {} as never,
        surface,
        propertyId: "p1",
        ownerId: "o1",
        conversationId: "c1",
        guestName: "Ana",
        message: "Qual a senha do Wi-Fi?",
      });
      expect(r).toBeNull();
    }
  });

  it("motivo padrão do encaminhamento é legível pela equipe e não cita o provedor", () => {
    expect(NO_AI_HANDOFF_REASON.length).toBeGreaterThan(10);
    expect(NO_AI_HANDOFF_REASON).not.toMatch(/lovable|gateway|openai|gemini/i);
  });
});
