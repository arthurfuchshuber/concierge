import { describe, expect, it } from "vitest";
import { isStaleDateOverride, liveDateOverride } from "@/lib/arrival-date-base";

describe("liveDateOverride", () => {
  it("mantém a previsão enquanto a reserva está na data-base", () => {
    expect(liveDateOverride("2026-10-05", "2026-10-06", "2026-10-06")).toBe("2026-10-05");
  });
  it("descarta a previsão quando a reserva mudou de data (saída adiada)", () => {
    expect(liveDateOverride("2026-10-05", "2026-10-05", "2026-10-06")).toBeNull();
  });
  it("sem base (linha antiga) a previsão continua valendo", () => {
    expect(liveDateOverride("2026-10-05", null, "2026-10-06")).toBe("2026-10-05");
  });
  it("sem previsão devolve null", () => {
    expect(liveDateOverride(null, "2026-10-05", "2026-10-06")).toBeNull();
  });
});

describe("isStaleDateOverride", () => {
  it("só é velha com previsão, base e data atual diferentes", () => {
    expect(isStaleDateOverride("2026-10-05", "2026-10-05", "2026-10-06")).toBe(true);
    expect(isStaleDateOverride("2026-10-05", "2026-10-06", "2026-10-06")).toBe(false);
    expect(isStaleDateOverride("2026-10-05", null, "2026-10-06")).toBe(false);
    expect(isStaleDateOverride(null, "2026-10-05", "2026-10-06")).toBe(false);
  });
});
