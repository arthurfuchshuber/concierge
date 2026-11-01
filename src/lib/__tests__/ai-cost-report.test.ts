import { describe, expect, it } from "vitest";
import { summarizeAiCosts } from "@/lib/ai-cost-report";

const ev = (over: Partial<Parameters<typeof summarizeAiCosts>[0][number]>) => ({
  created_at: "2026-10-30T10:00:00Z", task: "agent", model: "openai/gpt-6-astra", tokens_in: 1000, tokens_out: 200,
  cost_usd: 0.01, owner_id: "o1", property_id: "p1", conversation_id: "c1", surface: "guide_chat", ...over,
});

describe("relatório de custo da IA (livro-caixa)", () => {
  it("soma por dia, imóvel, conversa, tarefa e modelo; média por conversa", () => {
    const r = summarizeAiCosts([
      ev({}),
      ev({ cost_usd: "0.008", tokens_in: 800, tokens_out: 100, task: "intent", model: "google/gemini-3.8-flash" }),
      ev({ created_at: "2026-10-31T09:00:00Z", property_id: "p2", conversation_id: "c2", cost_usd: 0.02 }),
      ev({ created_at: "2026-10-31T09:05:00Z", conversation_id: null, cost_usd: null, tokens_in: null, tokens_out: null, surface: null, property_id: null }),
    ]);
    expect(r.calls).toBe(4);
    expect(r.totalUsd).toBeCloseTo(0.038, 6);
    expect(r.conversations).toBe(2);
    expect(r.avgPerConversationUsd).toBeCloseTo(0.019, 6);
    expect(r.byDay.map((d) => d.key)).toEqual(["2026-10-30", "2026-10-31"]);
    expect(r.byProperty[0]).toMatchObject({ key: "p2" });
    expect(r.byProperty.some((b) => b.key === "sem-imovel")).toBe(true);
    expect(r.byTask.map((b) => b.key).sort()).toEqual(["agent", "intent"]);
    expect(r.bySurface.some((b) => b.key === "sem-origem")).toBe(true);
    expect(r.byModel).toHaveLength(2);
  });
  it("sem dados, tudo zerado", () => {
    expect(summarizeAiCosts([])).toMatchObject({ calls: 0, totalUsd: 0, conversations: 0, avgPerConversationUsd: 0 });
  });
});
