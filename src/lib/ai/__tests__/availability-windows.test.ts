import { describe, expect, it } from "vitest";
import { nearestShiftedWindow, partialWindows } from "../availability-windows";

describe("contra-proposta de datas", () => {
  it("pedido 11→14 com noite 11 ocupada sugere 12→14", () => {
    const busy = [{ checkin_date: "2026-10-08", checkout_date: "2026-10-12" }];
    expect(partialWindows(busy, "2026-10-11", "2026-10-14", 2)).toEqual([
      { entrada: "2026-10-12", saida: "2026-10-14", noites: 2 },
    ]);
  });

  it("descarta trecho abaixo da estadia mínima", () => {
    const busy = [{ checkin_date: "2026-10-12", checkout_date: "2026-10-20" }];
    expect(partialWindows(busy, "2026-10-11", "2026-10-14", 2)).toEqual([]);
  });

  it("acha período de mesma duração mais próximo, sem passado", () => {
    const busy = [{ checkin_date: "2026-10-05", checkout_date: "2026-10-15" }];
    expect(nearestShiftedWindow(busy, "2026-10-11", "2026-10-14", "2026-10-11")).toEqual({
      entrada: "2026-10-15",
      saida: "2026-10-18",
      noites: 3,
    });
  });
});
