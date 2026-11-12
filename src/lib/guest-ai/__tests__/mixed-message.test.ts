/**
 * Mensagem mista (diretiva de 11/11/2026): dúvida + pedido de exceção na mesma mensagem ("Qual a voltagem e posso
 * sair às 14h?"). O texto validado do modelo (que responde a voltagem) é PRESERVADO; a decisão humana abre em
 * paralelo, com push prioritário. Só sem texto do modelo entra o texto determinístico.
 */
import { describe, expect, it, vi } from "vitest";
import { requestGuestAiReply } from "@/lib/guest-ai/slot.server";
import { buildDecisionAckText } from "@/lib/guest-ai-decision";

const ON = { GUEST_AI_AUTONOMOUS: "on" };
const REQ = { surface: "airbnb" as const, conversationId: "c1", messageId: "m1" };
const ACK = { guestName: "Paulo Lima", officialCheckin: "15:00", officialCheckout: "11:00", late: { time: "14:00", day: null }, early: null };
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
    const openDecision = vi.fn(async () => ({ opened: true, reason: "Decisão pendente · late check-out às 14h", ack: ACK }));
    const r = await requestGuestAiReply(REQ, deps({ generate: async () => stored(), openDecision }) as never);
    expect(openDecision).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ reply: MODEL_TEXT, handoff: true, handoffReason: "Decisão pendente · late check-out às 14h", handoffUrgency: "high" });
    expect(r?.reply).toMatch(/220V/);
  });

  it("sem texto do modelo ⇒ texto determinístico (horário oficial, sem fórmula de SAC)", async () => {
    const openDecision = vi.fn(async () => ({ opened: true, reason: "Decisão pendente · late check-out às 14h", ack: ACK }));
    const r = await requestGuestAiReply(REQ, deps({ generate: async () => stored({ text: null }), openDecision }) as never);
    expect(r?.reply).toBe(buildDecisionAckText(ACK));
    expect(r?.reply).not.toMatch(/Registrei|levei à equipe|te retorno|vou verificar/i);
    expect(r).toMatchObject({ handoff: true, handoffUrgency: "high" });
  });

  it("virada no mesmo dia: nada a decidir; o texto do modelo segue e a equipe só é avisada (urgência normal)", async () => {
    const openDecision = vi.fn(async () => ({
      opened: false,
      code: "same_day_turnover",
      reason: "Pediu saída tardia, mas há outro check-in no mesmo dia: saída pontual informada ao hóspede.",
      ack: { ...ACK, sameDayArrival: true },
    }));
    const r = await requestGuestAiReply(REQ, deps({ generate: async () => stored(), openDecision }) as never);
    expect(r).toMatchObject({ reply: MODEL_TEXT, handoff: true, handoffUrgency: "normal" });
    const r2 = await requestGuestAiReply(REQ, deps({ generate: async () => stored({ text: "" }), openDecision }) as never);
    expect(r2?.reply).toMatch(/já há outro check-in programado na casa; por isso a saída precisa ser pontual/);
  });
});
