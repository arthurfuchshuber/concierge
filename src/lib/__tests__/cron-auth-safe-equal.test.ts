import { describe, expect, it } from "vitest";
import { safeEqual } from "@/lib/cron-auth.server";

describe("safeEqual", () => {
  it("compara por conteúdo e tamanho", () => {
    expect(safeEqual("abc123", "abc123")).toBe(true);
    expect(safeEqual("abc124", "abc123")).toBe(false);
    expect(safeEqual("abc", "abc123")).toBe(false);
    expect(safeEqual("abc123456", "abc123")).toBe(false);
    expect(safeEqual("", "abc123")).toBe(false);
  });
});
