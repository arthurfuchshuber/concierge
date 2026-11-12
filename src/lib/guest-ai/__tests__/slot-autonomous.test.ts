/**
 * Condução autônoma (10/11/2026): contrato do `requestGuestAiReply` com a cadeia, sem rede nem banco
 * (validação, posse humana e geração injetadas).
 */
import { describe, expect, it, vi } from "vitest";
import { AUTONOMOUS_HANDOFF_REASON, CONTINGENCY_REASON, CONTINGENCY_REPLY, autonomousPropertyAllowed, requestGuestAiReply } from "@/lib/guest-ai/slot.server";

const ON = { GUEST_AI_AUTONOMOUS: "on" };
const REQ = { surface: "guide_chat" as const, conversationId: "c1", messageId: "m1", expectedOwnerId: "o1" };
const turn = { propertyId: "p1" };
const stored = (state: string, result: Record<string, unknown>) => ({ status: "stored", suggestionId: "s1", state, code: null, result: { text: null, handoffNeeded: false, handoffUrgency: null, internalQuestion: null, outcomeKind: "reply", ...result } });

function deps(over: Record<string, unknown> = {}) {
  return {
    env: ON,
    validate: vi.fn(async () => turn),
    humanActive: vi.fn(async () => false),
    generate: vi.fn(async () => stored("available", { text: "O check-in começa às 15h." })),
    ...over,
  };
}

describe("slot autônomo · fail-closed", () => {
  it("desligado: null, nada é validado nem gerado", async () => {
    const d = deps({ env: {} });
    expect(await requestGuestAiReply(REQ, d)).toBeNull();
    expect(d.validate).not.toHaveBeenCalled();
    expect(d.generate).not.toHaveBeenCalled();
  });
  it("imóvel fora da lista: null (fallback humano de sempre)", async () => {
    const d = deps({ env: { ...ON, GUEST_AI_AUTONOMOUS_PROPERTIES: "p9, p8" } });
    expect(await requestGuestAiReply(REQ, d)).toBeNull();
    expect(d.generate).not.toHaveBeenCalled();
    expect(autonomousPropertyAllowed("p1", { GUEST_AI_AUTONOMOUS_PROPERTIES: "p1,p2" })).toBe(true);
    expect(autonomousPropertyAllowed("p1", {})).toBe(true);
  });
  it("escopo recusado: encaminha à equipe sem gerar", async () => {
    const d = deps({ validate: vi.fn(async () => { throw new Error("scope"); }) });
    const r = await requestGuestAiReply(REQ, d);
    expect(r).toMatchObject({ reply: "", handoff: true });
    expect(d.generate).not.toHaveBeenCalled();
  });
});

describe("slot autônomo · posse humana", () => {
  it("equipe atendendo: silêncio sem encaminhar (não fala por cima do atendente)", async () => {
    const d = deps({ humanActive: vi.fn(async () => true) });
    expect(await requestGuestAiReply(REQ, d)).toEqual({ reply: "", handoff: false });
    expect(d.generate).not.toHaveBeenCalled();
  });
  it("posse incerta: não arrisca, encaminha à equipe", async () => {
    const d = deps({ humanActive: vi.fn(async () => null) });
    expect(await requestGuestAiReply(REQ, d)).toMatchObject({ reply: "", handoff: true });
    expect(d.generate).not.toHaveBeenCalled();
  });
});

describe("slot autônomo · projeção da cadeia para o canal", () => {
  it("resposta aprovada: texto, sem encaminhar", async () => {
    expect(await requestGuestAiReply(REQ, deps())).toEqual({ reply: "O check-in começa às 15h.", handoff: false });
  });
  it("resposta que pede a equipe: texto + encaminhamento com motivo e urgência", async () => {
    const d = deps({ generate: vi.fn(async () => stored("available", { text: "Já chamei a equipe.", handoffNeeded: true, handoffUrgency: "high", internalQuestion: "Vazamento no banheiro" })) });
    expect(await requestGuestAiReply(REQ, d)).toEqual({ reply: "Já chamei a equipe.", handoff: true, handoffReason: "Vazamento no banheiro", handoffUrgency: "high" });
  });
  it("silêncio legítimo: nada a dizer e sem encaminhar", async () => {
    const d = deps({ generate: vi.fn(async () => stored("no_suggestion", {})) });
    expect(await requestGuestAiReply(REQ, d)).toEqual({ reply: "", handoff: false });
  });
  it("sem texto mas pedindo a equipe (alerta urgente): encaminha", async () => {
    const d = deps({ generate: vi.fn(async () => stored("no_suggestion", { handoffNeeded: true, handoffUrgency: "high" })) });
    expect(await requestGuestAiReply(REQ, d)).toMatchObject({ reply: "", handoff: true, handoffUrgency: "high", handoffReason: AUTONOMOUS_HANDOFF_REASON });
  });
  it("falha da geração, teto diário, erro: o hóspede recebe o aviso de contingência e a equipe, urgência alta (caso Gilmar)", async () => {
    for (const r of [stored("generation_failed", {}), { status: "daily_budget_exceeded", suggestionId: "s" }, { status: "skipped", code: "internal_error", detail: null }]) {
      const out = await requestGuestAiReply(REQ, deps({ generate: vi.fn(async () => r), loadBurst: async () => ["Qual a senha do Wi-Fi?"] }));
      expect(out).toEqual({ reply: CONTINGENCY_REPLY, handoff: true, handoffReason: CONTINGENCY_REASON, handoffUrgency: "high" });
    }
  });
  it("falha da geração com mensagem só de cortesia: silêncio e equipe avisada com o motivo padrão", async () => {
    const out = await requestGuestAiReply(REQ, deps({ generate: vi.fn(async () => stored("generation_failed", {})), loadBurst: async () => ["Obrigado!"] }));
    expect(out).toMatchObject({ reply: "", handoff: true, handoffReason: AUTONOMOUS_HANDOFF_REASON, handoffUrgency: "normal" });
  });
  it("rajada: mensagem mais nova chegou ⇒ esta fica em silêncio (a mais nova responde)", async () => {
    const d = deps({ generate: vi.fn(async () => ({ status: "skipped", code: "superseded_by_newer_message", detail: null })) });
    expect(await requestGuestAiReply(REQ, d)).toEqual({ reply: "", handoff: false });
  });
  it("erro inesperado nunca lança: encaminha à equipe", async () => {
    const d = deps({ generate: vi.fn(async () => { throw new Error("x"); }) });
    expect(await requestGuestAiReply(REQ, d)).toMatchObject({ handoff: true });
  });
});
