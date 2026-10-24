import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
const distill = vi.fn();
vi.mock("../human-loop/learning.server", () => ({ distillHumanDecision: (...a: unknown[]) => distill(...a) }));
import { isLearnableAsk, isRoutineHostScript, offerHostAnswerLearning } from "../human-loop/host-answer-learning.server";

describe("aprendizado da resposta dada direto no Airbnb", () => {
  it("dúvida factual aberta gera cartão de aprendizado", () => {
    expect(isLearnableAsk({ context_snapshot: { decision: { kind: "fact", options: [] } } })).toBe(true);
  });
  it("decisão operacional nunca vira aprendizado", () => {
    expect(isLearnableAsk({ context_snapshot: { decision: { kind: "operational", options: ["Sim, pode", "Não"] } } })).toBe(false);
  });
  it("cartão de aprendizado não gera outro cartão", () => {
    expect(isLearnableAsk({ context_snapshot: { host_learning: true } })).toBe(false);
  });
});

describe("aprendizado estrito (23/10/2026)", () => {
  it("scripts rotineiros são ignorados", () => {
    expect(isRoutineHostScript("Olá! Boa tarde, tudo bem?")).toBe(true);
    expect(isRoutineHostScript("Obrigada pelo aviso, desculpe o transtorno!")).toBe(true);
    expect(isRoutineHostScript("Segue o link do guia digital: https://x.com/guia/abc")).toBe(true);
    expect(isRoutineHostScript("Instruções de check-in: a partir das 15h, pegue a chave na portaria.")).toBe(true);
    expect(isRoutineHostScript("A piscina do prédio funciona das 8h às 22h e é liberada para hóspedes.")).toBe(false);
  });

  const ask = { id: "e1", owner_id: "o1", property_id: null, agent_type: "concierge", guest_name: "Ana", question_to_human: "A piscina é liberada?", context_snapshot: { decision: { kind: "fact", options: [] } } };
  function fakeAdmin() {
    const inserts: unknown[] = [];
    return { inserts, admin: { from: () => ({ insert: (v: unknown) => { inserts.push(v); return { select: () => ({ single: () => Promise.resolve({ data: { id: "n1" }, error: null }) }) }; } }) } };
  }
  it.each([[null], [{ shouldLearn: false, proposedMemory: "x" }], [{ shouldLearn: true, proposedMemory: "" }]])("destilação %j aborta sem card", async (ret) => {
    distill.mockResolvedValueOnce(ret);
    const { admin, inserts } = fakeAdmin();
    const r = await offerHostAnswerLearning(admin as never, { conversationId: "c1", hostText: "Sim, a piscina é liberada até as 22h.", openAsks: [ask] });
    expect(r).toBeNull();
    expect(inserts).toHaveLength(0);
  });
  it("destilação que lança erro também aborta (sem fallback para a fala)", async () => {
    distill.mockRejectedValueOnce(new Error("x"));
    const { admin, inserts } = fakeAdmin();
    expect(await offerHostAnswerLearning(admin as never, { conversationId: "c1", hostText: "Sim, a piscina é liberada até as 22h.", openAsks: [ask] })).toBeNull();
    expect(inserts).toHaveLength(0);
  });
  it("fala rotineira nem chama a destilação", async () => {
    distill.mockClear();
    const { admin } = fakeAdmin();
    expect(await offerHostAnswerLearning(admin as never, { conversationId: "c1", hostText: "Boa noite! Obrigada!", openAsks: [ask] })).toBeNull();
    expect(distill).not.toHaveBeenCalled();
  });
  it("destilação válida cria o card com a memória proposta", async () => {
    distill.mockResolvedValueOnce({ shouldLearn: true, proposedMemory: "Piscina liberada até 22h." });
    const { admin, inserts } = fakeAdmin();
    expect(await offerHostAnswerLearning(admin as never, { conversationId: "c1", hostText: "Sim, a piscina é liberada até as 22h.", openAsks: [ask] })).toBe("n1");
    expect((inserts[0] as { context_snapshot: { draft: string } }).context_snapshot.draft).toBe("Piscina liberada até 22h.");
  });
});
