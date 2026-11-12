/**
 * Mensagem mista (diretiva de 11/11/2026): dúvida + pedido de exceção na mesma mensagem ("Qual a voltagem e posso
 * sair às 14h?"). O texto validado do modelo (que responde a voltagem) é PRESERVADO; a decisão humana abre em
 * paralelo, com push prioritário. Só sem texto do modelo entra o texto determinístico.
 */
import { describe, expect, it, vi } from "vitest";
import { requestGuestAiReply } from "@/lib/guest-ai/slot.server";

const ON = { GUEST_AI_AUTONOMOUS: "on" };
const REQ = { surface: "airbnb" as const, conversationId: "c1", messageId: "m1" };
const MODEL_TEXT =
  "Paulo, a voltagem da casa é 220V em todas as tomadas. Sobre a saída, o check-out é até as 11h; havendo possibilidade de estender um pouco nesse dia, nossa equipe te avisa por aqui.";
const stored = (over: Record<string, unknown> = {}) => ({
  status: "stored",
  state: "available",
  result: { text: MODEL_TEXT, handoffNeeded: false, handoffUrgency: null, internalQuestion: null, formalChangeRequests: ["late_checkout"], ...over },
});
const deps = (over: Record<string, unknown> = {}) => ({
  env: ON,
  validate: async () => ({ propertyId: "p1" }),
  humanActive: async () => false,
  pendingDecision: async () => false,
  ...over,
});

describe("mensagem mista: comodidade + late check-out", () => {
  it("a resposta da comodidade chega INTEIRA ao hóspede e a decisão humana abre com push prioritário", async () => {
    const openDecision = vi.fn(async () => ({ opened: true, reason: "Decisão pendente · late check-out às 14h" }));
    const r = await requestGuestAiReply(REQ, deps({ generate: async () => stored(), openDecision }) as never);
    expect(openDecision).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ reply: MODEL_TEXT, handoff: true, handoffReason: "Decisão pendente · late check-out às 14h", handoffUrgency: "high" });
    expect(r?.reply).toMatch(/220V/);
  });

  it("sem texto do modelo ⇒ encaminhamento silencioso: nenhum texto fixo ao hóspede (diretiva 11/11/2026, caso Ary)", async () => {
    const openDecision = vi.fn(async () => ({ opened: true, reason: "Decisão pendente · late check-out às 14h" }));
    const r = await requestGuestAiReply(REQ, deps({ generate: async () => stored({ text: null }), openDecision }) as never);
    expect(r).toEqual({ reply: "", handoff: true, handoffReason: "Decisão pendente · late check-out às 14h", handoffUrgency: "high" });
  });

  it("virada no mesmo dia: nada a decidir; o texto do modelo segue e a equipe só é avisada (urgência normal)", async () => {
    const openDecision = vi.fn(async () => ({
      opened: false,
      code: "same_day_turnover",
      reason: "Pediu saída tardia, mas há outro check-in no mesmo dia: saída pontual informada ao hóspede.",
    }));
    const r = await requestGuestAiReply(REQ, deps({ generate: async () => stored(), openDecision }) as never);
    expect(r).toMatchObject({ reply: MODEL_TEXT, handoff: true, handoffUrgency: "normal" });
    const r2 = await requestGuestAiReply(REQ, deps({ generate: async () => stored({ text: "" }), openDecision }) as never);
    expect(r2).toMatchObject({ reply: "", handoff: true, handoffUrgency: "normal" });
  });
});
