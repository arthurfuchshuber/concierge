import { describe, expect, it } from "vitest";
import { NO_AI_HANDOFF_REASON, requestGuestAiReply, type GuestAiRequest } from "@/lib/guest-ai/slot.server";

/**
 * Ponto de extensão da IA de atendimento (01/11/2026): enquanto não há
 * implementação instalada, devolve `null` e os canais encaminham ao humano.
 * Este teste trava o contrato para a nova arquitetura ser plugada aqui.
 *
 * F0 (02/11/2026): o contrato passou a ser só de IDENTIFICADORES. O slot não
 * recebe mais cliente de banco, imóvel, dono, nome do hóspede nem texto.
 */
describe("guest-ai slot (sem implementação instalada)", () => {
  it("devolve null para qualquer canal", async () => {
    for (const surface of ["guide_chat", "whatsapp", "airbnb"] as const) {
      const r = await requestGuestAiReply({
        surface,
        conversationId: "00000000-0000-4000-8000-000000000001",
        messageId: "00000000-0000-4000-8000-000000000002",
        expectedOwnerId: null,
      });
      expect(r).toBeNull();
    }
  });

  it("o contrato não aceita cliente de banco nem dados do imóvel (só identificadores)", () => {
    const ok: GuestAiRequest = {
      surface: "airbnb",
      conversationId: "c",
      messageId: "m",
    };
    expect(Object.keys(ok).sort()).toEqual(["conversationId", "messageId", "surface"]);
    const bad: GuestAiRequest = {
      surface: "airbnb",
      conversationId: "c",
      messageId: "m",
      // @ts-expect-error o slot não aceita mais o cliente administrativo
      supabase: {},
    };
    expect(bad).toBeDefined();
  });

  it("motivo padrão do encaminhamento é legível pela equipe e não cita o provedor", () => {
    expect(NO_AI_HANDOFF_REASON.length).toBeGreaterThan(10);
    expect(NO_AI_HANDOFF_REASON).not.toMatch(/lovable|gateway|openai|gemini/i);
  });
});
