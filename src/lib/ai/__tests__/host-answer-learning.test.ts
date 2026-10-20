import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
import { isLearnableAsk } from "../human-loop/host-answer-learning.server";

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
