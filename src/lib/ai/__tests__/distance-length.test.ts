import { describe, expect, it } from "vitest";
import { distanceInfo } from "@/lib/ai/tools.server";

describe("distância sempre em comprimento", () => {
  it("abaixo de 1 km vem em metros, sem tempo", () => {
    const d = distanceInfo(812) as Record<string, unknown>;
    expect(d.distancia_texto).toBe("810 m");
    expect(d).not.toHaveProperty("minutos_a_pe");
  });
  it("acima de 1 km vem em km com vírgula", () => {
    expect((distanceInfo(1432) as Record<string, unknown>).distancia_texto).toBe("1,4 km");
  });
});
