import { describe, expect, it } from "vitest";
import { clampMonthInYear, monthBounds, monthIdx, monthOptions, yearOptions } from "../month-year-options";

const d = (y: number, m: number, day = 1) => new Date(y, m - 1, day);

describe("seletor de mês e ano: só o que existe", () => {
  const today = d(2026, 10, 29);
  // bloqueio: de hoje (out/2026) até ~500 dias (mar/2028)
  const bounds = monthBounds(d(2026, 11), d(2026, 10, 29), d(2028, 3, 12), today);

  it("não oferece anos passados nem além do limite", () => {
    expect(yearOptions(bounds)).toEqual([2026, 2027, 2028]);
  });

  it("no ano de hoje só aparecem os meses de hoje em diante", () => {
    expect(monthOptions(2026, bounds)).toEqual([9, 10, 11]); // out, nov, dez
  });

  it("anos do meio trazem os 12 meses; o último só até o limite", () => {
    expect(monthOptions(2027, bounds)).toHaveLength(12);
    expect(monthOptions(2028, bounds)).toEqual([0, 1, 2]);
  });

  it("trocar de ano mantém o mês quando existe e senão usa o mais próximo", () => {
    expect(clampMonthInYear(2027, 10, bounds)).toBe(10);
    expect(clampMonthInYear(2028, 10, bounds)).toBe(2);
    expect(clampMonthInYear(2026, 0, bounds)).toBe(9);
  });

  it("o mês que está na tela entra sempre, mesmo fora dos limites", () => {
    const b = monthBounds(d(2025, 1), d(2026, 10), d(2027, 1), today);
    expect(b.lo).toBe(monthIdx(d(2025, 1)));
  });

  it("calendário livre usa uma janela em volta de hoje", () => {
    const b = monthBounds(d(2026, 10), null, null, today);
    expect(yearOptions(b)).toEqual([2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028, 2029]);
  });
});
