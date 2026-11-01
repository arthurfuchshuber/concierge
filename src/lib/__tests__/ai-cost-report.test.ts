import { describe, expect, it } from "vitest";
import { summarizeAiCosts } from "@/lib/ai-cost-report";

describe("relatório de custo da IA", () => {
  it("soma por dia, imóvel, conversa e modelo; média por resposta", () => {
    const r = summarizeAiCosts([
      { created_at: "2026-10-30T10:00:00Z", property_id: "p1", conversation_id: "c1", surface: "guide_chat", channel_origin: "platform_chat", cost_estimate: 0.012, tokens: { input: 1000, output: 200 }, models: { agent: "openai/gpt-6-astra" } },
      { created_at: "2026-10-30T11:00:00Z", property_id: "p1", conversation_id: "c1", surface: "guide_chat", channel_origin: "whatsapp", cost_estimate: 0.008, tokens: { input: 800, output: 100 }, models: { agent: "openai/gpt-6-astra" } },
      { created_at: "2026-10-31T09:00:00Z", property_id: "p2", conversation_id: null, surface: "guide_chat", channel_origin: null, cost_estimate: null, tokens: null, models: null },
    ]);
    expect(r.responses).toBe(3);
    expect(r.totalUsd).toBeCloseTo(0.02, 6);
    expect(r.avgUsd).toBeCloseTo(0.006667, 5);
    expect(r.byDay.map((d) => d.key)).toEqual(["2026-10-30", "2026-10-31"]);
    expect(r.byProperty[0]).toMatchObject({ key: "p1", responses: 2 });
    expect(r.byConversation).toHaveLength(1);
    expect(r.byAgentModel[0]!.key).toBe("openai/gpt-6-astra");
  });
});
