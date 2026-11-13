import { describe, expect, it } from "vitest";
import { advance, pickCleaningDate, describeFrequency } from "./recurrence-dates";

describe("recurrence-dates", () => {
  it("mês curto usa o último dia e volta ao dia de referência", () => {
    expect(advance("2026-01-31", "month", 1, 31)).toBe("2026-02-28");
    expect(advance("2026-02-28", "month", 1, 31)).toBe("2026-03-31");
    expect(advance("2026-11-12", "month", 3, 12)).toBe("2027-02-12");
    expect(advance("2026-12-12", "week", 1, 12)).toBe("2026-12-19");
    expect(advance("2026-12-12", "year", 1, 12)).toBe("2027-12-12");
  });
  it("checkout mais próximo, antes ou depois; no dia vence; empate = o mais cedo", () => {
    expect(pickCleaningDate("2026-12-12", "2026-12-01", ["2026-12-10", "2026-12-15"])).toBe("2026-12-10");
    expect(pickCleaningDate("2026-12-12", "2026-12-01", ["2026-12-11", "2026-12-13"])).toBe("2026-12-11");
    expect(pickCleaningDate("2026-12-12", "2026-12-01", ["2026-12-12", "2026-12-13"])).toBe("2026-12-12");
    expect(pickCleaningDate("2026-12-12", "2026-12-01", ["2026-12-13", "2026-12-30"])).toBe("2026-12-13");
  });
  it("data já passada vai para o próximo checkout; sem checkout futuro = nenhum", () => {
    expect(pickCleaningDate("2026-11-01", "2026-11-13", ["2026-11-05", "2026-11-20", "2026-11-25"])).toBe("2026-11-20");
    expect(pickCleaningDate("2026-11-01", "2026-11-13", ["2026-11-05"])).toBeNull();
  });
  it("descreve a frequência", () => {
    expect(describeFrequency("month", 1, 12)).toBe("Todo mês, dia 12");
    expect(describeFrequency("month", 3, 12)).toBe("A cada 3 meses, dia 12");
  });
});
