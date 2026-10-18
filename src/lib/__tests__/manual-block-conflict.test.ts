import { describe, expect, it } from "vitest";
import { addDaysISO, blockNights, conflictMessage, conflictNight, firstBlockConflict } from "@/lib/manual-block-conflict";

const stay = (checkin: string, checkout: string, guest: string | null = null) => ({ checkin, checkout, guest });

describe("firstBlockConflict", () => {
  it("bloqueio que atravessa uma reserva conflita", () => {
    expect(firstBlockConflict([stay("2026-10-22", "2026-10-25")], "2026-10-21", "2026-10-24")).not.toBeNull();
  });
  it("checkout no dia inicial NÃO conflita (giro)", () => {
    expect(firstBlockConflict([stay("2026-10-18", "2026-10-21")], "2026-10-21", "2026-10-24")).toBeNull();
  });
  it("check-in no dia de saída do bloqueio NÃO conflita", () => {
    expect(firstBlockConflict([stay("2026-10-24", "2026-10-27")], "2026-10-21", "2026-10-24")).toBeNull();
  });
  it("reserva totalmente dentro do bloqueio conflita", () => {
    expect(firstBlockConflict([stay("2026-10-22", "2026-10-23")], "2026-10-21", "2026-10-24")).not.toBeNull();
  });
  it("devolve a primeira por data de entrada", () => {
    const hit = firstBlockConflict([stay("2026-10-23", "2026-10-25", "B"), stay("2026-10-22", "2026-10-23", "A")], "2026-10-21", "2026-10-26");
    expect(hit?.guest).toBe("A");
  });
});

describe("helpers", () => {
  it("noites e datas", () => {
    expect(blockNights("2026-10-21", "2026-10-24")).toBe(3);
    expect(addDaysISO("2026-10-31", 1)).toBe("2026-11-01");
  });
  it("mensagem mostra a primeira noite em choque", () => {
    const s = stay("2026-10-22", "2026-10-25", "Ana");
    expect(conflictNight(s, "2026-10-21")).toBe("2026-10-22");
    expect(conflictNight(stay("2026-10-19", "2026-10-23"), "2026-10-21")).toBe("2026-10-21");
    expect(conflictMessage(s, "2026-10-21")).toBe("O dia 22/10 já tem reserva ativa (Ana).");
  });
});
