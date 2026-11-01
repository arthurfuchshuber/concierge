import { describe, expect, it } from "vitest";
import { fallbackModel, shouldFallback } from "@/lib/ai/models";

describe("modelos reserva", () => {
  it("agente OpenAI cai em outro OpenAI; Gemini no mais leve; embeddings sem reserva", () => {
    expect(fallbackModel("openai/gpt-6-astra")).toBe("openai/gpt-5.6-sol");
    expect(fallbackModel("google/gemini-3.8-flash")).toBe("google/gemini-3.1-flash-lite");
    expect(fallbackModel("google/gemini-embedding-2")).toBeNull();
  });
  it("só falha do provedor aciona o reserva (não 429 nem 402)", () => {
    expect(shouldFallback(503)).toBe(true);
    expect(shouldFallback(undefined)).toBe(true);
    expect(shouldFallback(429)).toBe(false);
    expect(shouldFallback(402)).toBe(false);
  });
});
