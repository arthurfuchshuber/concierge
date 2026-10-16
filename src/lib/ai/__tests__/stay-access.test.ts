import { describe, expect, it } from "vitest";
import { isWithinStay } from "../stay-access.server";

describe("isWithinStay — dados liberados só durante a estadia", () => {
  it("libera no dia do check-in", () => expect(isWithinStay("2026-10-15", "2026-10-15", "2026-10-18")).toBe(true));
  it("libera no meio da estadia", () => expect(isWithinStay("2026-10-16", "2026-10-15", "2026-10-18")).toBe(true));
  it("libera no dia do check-out", () => expect(isWithinStay("2026-10-18", "2026-10-15", "2026-10-18")).toBe(true));
  it("bloqueia antes do check-in", () => expect(isWithinStay("2026-10-14", "2026-10-15", "2026-10-18")).toBe(false));
  it("bloqueia depois do check-out", () => expect(isWithinStay("2026-10-19", "2026-10-15", "2026-10-18")).toBe(false));
  it("bloqueia sem reserva", () => expect(isWithinStay("2026-10-15", null, null)).toBe(false));
});
