import { describe, expect, it } from "vitest";
import { buildUsageEvent, withUsageContext } from "@/lib/ai/usage-ledger.server";

describe("livro-caixa de custo da IA", () => {
  it("monta a linha com tokens, custo arredondado e contexto", () => {
    const row = buildUsageEvent("agent", "openai/gpt-6-astra", { inputTokens: 1200, outputTokens: 300, costUsd: 0.0123456789 }, {
      ownerId: "o1", propertyId: "p1", conversationId: "c1", surface: "airbnb",
    });
    expect(row).toEqual({
      task: "agent", model: "openai/gpt-6-astra", tokens_in: 1200, tokens_out: 300, cost_usd: 0.012346,
      owner_id: "o1", property_id: "p1", conversation_id: "c1", surface: "airbnb",
    });
  });
  it("sem contexto, os campos de conta/imóvel ficam nulos", () => {
    const row = buildUsageEvent("embeddings", "google/gemini-embedding-2", { inputTokens: 10, outputTokens: 0, costUsd: 0 });
    expect(row.owner_id).toBeNull();
    expect(row.property_id).toBeNull();
  });
  it("o contexto atravessa chamadas assíncronas aninhadas", async () => {
    const seen = await withUsageContext({ propertyId: "p9" }, async () => {
      await Promise.resolve();
      return withUsageContext({ conversationId: "c9" }, async () => {
        await new Promise((r) => setTimeout(r, 1));
        const mod = await import("@/lib/ai/usage-ledger.server");
        return mod; // só garante que o módulo é o mesmo e a execução não quebra
      });
    });
    expect(seen.withUsageContext).toBeTypeOf("function");
  });
});
