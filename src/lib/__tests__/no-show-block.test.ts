import { describe, it, expect } from "vitest";
import { noShowBlocksCheckin } from "../no-show-block";

const T = "2026-11-09";
const base = { hasReservation: true, reservationStatus: "confirmed" };

describe("no-show x novo check-in", () => {
  it("Studio 104: no-show 07→09 e novo check-in em 09 NÃO trava (troca no mesmo dia)", () => {
    expect(noShowBlocksCheckin({ ...base, checkoutDate: "2026-11-09" }, "2026-11-09", T)).toBe(false);
  });
  it("saída já passou: livre", () => {
    expect(noShowBlocksCheckin({ ...base, checkoutDate: "2026-11-08" }, "2026-11-09", T)).toBe(false);
  });
  it("no-show ainda em curso e reserva ativa: trava", () => {
    expect(noShowBlocksCheckin({ ...base, checkoutDate: "2026-11-12" }, "2026-11-09", T)).toBe(true);
  });
  it("reserva cancelada: livre", () => {
    expect(noShowBlocksCheckin({ ...base, reservationStatus: "cancelled", checkoutDate: "2026-11-12" }, "2026-11-09", T)).toBe(false);
  });
  it("sem reserva vinculada e em curso: trava; sem data: não trava", () => {
    expect(noShowBlocksCheckin({ hasReservation: false, checkoutDate: "2026-11-12" }, "2026-11-09", T)).toBe(true);
    expect(noShowBlocksCheckin({ hasReservation: false, checkoutDate: null }, "2026-11-09", T)).toBe(false);
  });
  it("sem data de entrada do novo: usa hoje", () => {
    expect(noShowBlocksCheckin({ ...base, checkoutDate: "2026-11-09" }, null, T)).toBe(false);
    expect(noShowBlocksCheckin({ ...base, checkoutDate: "2026-11-10" }, null, T)).toBe(true);
  });
});
