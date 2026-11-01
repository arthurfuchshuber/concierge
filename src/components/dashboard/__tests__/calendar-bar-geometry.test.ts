import { describe, expect, it } from "vitest";
import { barLabelGeometry } from "@/components/dashboard/calendar-bar-geometry";

const W = 64;
describe("etiqueta da barra de reserva", () => {
  it("2 noites: começa meio dia depois do início da célula e cobre 2 dias inteiros", () => {
    // check-in no dia 3, checkout no dia 5 → barra de 2 × 64 = 128px
    expect(barLabelGeometry({ checkinIndex: 3, checkoutIndex: 5, startsBefore: false, endsAfter: false, dayCount: 30, dayW: W })).toEqual({ cell: 3, left: 32, width: 128 });
  });
  it("1 noite: 64px (antes sumia, com 0px)", () => {
    expect(barLabelGeometry({ checkinIndex: 7, checkoutIndex: 8, startsBefore: false, endsAfter: false, dayCount: 30, dayW: W }).width).toBe(64);
  });
  it("começa antes da janela: nasce na 1ª célula, sem deslocamento, até o meio do checkout", () => {
    expect(barLabelGeometry({ checkinIndex: undefined, checkoutIndex: 2, startsBefore: true, endsAfter: false, dayCount: 30, dayW: W })).toEqual({ cell: 0, left: 0, width: 2 * W + 32 });
  });
  it("termina depois da janela: vai até o fim da última célula", () => {
    expect(barLabelGeometry({ checkinIndex: 28, checkoutIndex: undefined, startsBefore: false, endsAfter: true, dayCount: 30, dayW: W })).toEqual({ cell: 28, left: 32, width: 30 * W - (28 * W + 32) });
  });
});
