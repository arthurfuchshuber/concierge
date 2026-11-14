import { describe, expect, it, vi } from "vitest";
import { barrierGate, evaluateSendBarrier, readSendBarrierState, type BarrierInput } from "@/lib/guest-ai/send-barrier";

const T0 = "2026-11-14T18:09:39.000Z";
const ok: BarrierInput = {
  triggerId: "g1",
  triggerCreatedAt: T0,
  rowsAfter: [],
  conversation: { status: "ai", ai_paused: false, paused_until: null, assigned_to: null },
  pausedNow: false,
};
const row = (id: string, sender_type: string, extra: object = {}) => ({ id, created_at: "2026-11-14T18:10:09.000Z", role: sender_type === "guest" ? "user" : "assistant", sender_type, ...extra });

describe("barreira pré-envio · caso Jayr (IA atropelou o atendente humano)", () => {
  it("nada aconteceu durante a geração ⇒ pode enviar", () => {
    expect(evaluateSendBarrier(ok)).toEqual({ abort: false });
  });
  it("anfitrião humano falou durante a geração (18:10:09) ⇒ aborta, mesmo sem pausa gravada ainda", () => {
    expect(evaluateSendBarrier({ ...ok, rowsAfter: [row("h1", "human")] })).toEqual({ abort: true, reason: "human_message" });
  });
  it("conversa virou 'assigned' ⇒ aborta", () => {
    expect(evaluateSendBarrier({ ...ok, conversation: { ...ok.conversation!, status: "assigned" } })).toEqual({ abort: true, reason: "human_ownership" });
  });
  it("pausa humana vigente ⇒ aborta", () => {
    expect(evaluateSendBarrier({ ...ok, pausedNow: true })).toEqual({ abort: true, reason: "human_ownership" });
  });
  it("hóspede mandou outra mensagem ⇒ aborta (a mais nova responde)", () => {
    expect(evaluateSendBarrier({ ...ok, rowsAfter: [row("g2", "guest")] })).toEqual({ abort: true, reason: "newer_guest_message" });
  });
  it("outro turno da IA já respondeu ⇒ aborta (sem resposta duplicada)", () => {
    expect(evaluateSendBarrier({ ...ok, rowsAfter: [row("a1", "ai")] })).toEqual({ abort: true, reason: "newer_ai_message" });
  });
  it("mensagem programada (sistema) NÃO cala a IA; nota interna nunca conta", () => {
    expect(evaluateSendBarrier({ ...ok, rowsAfter: [row("s1", "system"), row("n1", "human", { is_internal_note: true })] })).toEqual({ abort: false });
  });
  it("humano vence qualquer outro motivo quando há vários", () => {
    expect(evaluateSendBarrier({ ...ok, rowsAfter: [row("g2", "guest"), row("h1", "human")] })).toMatchObject({ reason: "human_message" });
  });
  it("leitura falhou ou pausa incerta ⇒ fail-closed (não fala)", () => {
    expect(evaluateSendBarrier({ ...ok, rowsAfter: null })).toEqual({ abort: true, reason: "unknown_state" });
    expect(evaluateSendBarrier({ ...ok, conversation: null })).toEqual({ abort: true, reason: "unknown_state" });
    expect(evaluateSendBarrier({ ...ok, pausedNow: null })).toEqual({ abort: true, reason: "unknown_state" });
  });
});

describe("readSendBarrierState (leitura do canal)", () => {
  const chain = (data: unknown) => {
    const q: any = { select: () => q, eq: () => q, gte: () => q, neq: () => q, limit: async () => ({ data, error: null }), maybeSingle: async () => ({ data, error: null }) };
    return q;
  };
  it("sem gatilho utilizável ⇒ estado incerto", async () => {
    expect(await readSendBarrierState({}, "c1", null, async () => false)).toEqual({ rowsAfter: null, conversation: null, pausedNow: null });
  });
  it("exceção de banco ⇒ estado incerto, nunca 'livre'", async () => {
    const admin = { from: () => { throw new Error("db"); } };
    expect(await readSendBarrierState(admin, "c1", { id: "g1", created_at: T0 }, async () => false)).toEqual({ rowsAfter: null, conversation: null, pausedNow: null });
  });
  it("leitura completa devolve mensagens, conversa e pausa", async () => {
    const admin = { from: (t: string) => (t === "property_chat_messages" ? chain([{ id: "h1", sender_type: "human" }]) : chain({ id: "c1", status: "assigned" })) };
    const r = await readSendBarrierState(admin, "c1", { id: "g1", created_at: T0 }, async () => true);
    expect(r.rowsAfter).toHaveLength(1);
    expect(r.pausedNow).toBe(true);
    expect(evaluateSendBarrier({ triggerId: "g1", triggerCreatedAt: T0, ...r })).toMatchObject({ abort: true });
  });
  it("falha ao resolver a pausa ⇒ incerto (aborta)", async () => {
    const admin = { from: (t: string) => (t === "property_chat_messages" ? chain([]) : chain({ id: "c1", status: "ai" })) };
    const r = await readSendBarrierState(admin, "c1", { id: "g1", created_at: T0 }, async () => { throw new Error("x"); });
    expect(r.pausedNow).toBeNull();
    expect(evaluateSendBarrier({ triggerId: "g1", triggerCreatedAt: T0, ...r })).toEqual({ abort: true, reason: "unknown_state" });
  });
});

describe("T-BARRIER-01 · mensagem de atendente com timestamp posterior ao gatilho", () => {
  for (const st of ["human", "staff", "host"]) {
    it(`sender_type='${st}' mais novo que o gatilho ⇒ barreira bloqueia o envio e o status da conversa não é alterado`, () => {
      const conv = { status: "needs_human", ai_paused: false, paused_until: null, assigned_to: null };
      const before = JSON.stringify(conv);
      const v = evaluateSendBarrier({ ...ok, conversation: conv, rowsAfter: [row("h1", st)] });
      expect(barrierGate(v)).toEqual({ allowed: false, reason: "human_message" });
      expect(JSON.stringify(conv)).toBe(before); // a barreira só decide; nunca escreve
    });
  }
  it("conversa 'assigned' ⇒ allowed:false human_ownership", () => {
    const v = evaluateSendBarrier({ ...ok, conversation: { ...ok.conversation, status: "assigned" } as never });
    expect(barrierGate(v)).toEqual({ allowed: false, reason: "human_ownership" });
  });
  it("nada novo ⇒ allowed:true", () => {
    expect(barrierGate(evaluateSendBarrier(ok))).toEqual({ allowed: true });
  });
});
