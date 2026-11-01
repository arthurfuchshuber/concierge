import { describe, expect, it } from "vitest";
import { allowedChunkIds, audienceAllowed } from "@/lib/ai/rag.server";

describe("público dos trechos na busca da IA", () => {
  it("Público para todos; Reserva Ativa só com reserva ativa; Interno nunca", () => {
    expect(audienceAllowed("P", false)).toBe(true);
    expect(audienceAllowed(null, false)).toBe(true);
    expect(audienceAllowed("G", false)).toBe(false);
    expect(audienceAllowed("G", true)).toBe(true);
    expect(audienceAllowed("I", true)).toBe(false);
    expect(audienceAllowed("I", false)).toBe(false);
  });

  const fake = (rows: Array<{ id: string; audience: string }>, error: unknown = null) =>
    ({ from: () => ({ select: () => ({ in: async () => ({ data: error ? null : rows, error }) }) }) }) as never;

  it("sem reserva ativa: só Público passa; com reserva ativa: Público e Reserva Ativa", async () => {
    const rows = [{ id: "a", audience: "P" }, { id: "b", audience: "G" }, { id: "c", audience: "I" }];
    expect([...(await allowedChunkIds(fake(rows), ["a", "b", "c"], false))].sort()).toEqual(["a"]);
    expect([...(await allowedChunkIds(fake(rows), ["a", "b", "c"], true))].sort()).toEqual(["a", "b"]);
  });

  it("coluna ainda inexistente no banco: comportamento anterior (nada é filtrado)", async () => {
    const out = await allowedChunkIds(fake([], { message: 'column "audience" does not exist' }), ["a", "b"], false);
    expect([...out].sort()).toEqual(["a", "b"]);
  });
});
