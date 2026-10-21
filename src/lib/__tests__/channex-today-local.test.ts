import { describe, it, expect } from "vitest";
import { todayLocalIso } from "@/lib/channex-mapping.server";

describe("todayLocalIso", () => {
  it("21:48 de 20/10 no Brasil (00:48 UTC de 21/10) ainda é 20/10", () => {
    expect(todayLocalIso(new Date("2026-10-21T00:48:00Z"))).toBe("2026-10-20");
  });
});
