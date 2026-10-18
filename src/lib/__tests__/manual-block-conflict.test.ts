import { describe, expect, it } from "vitest";
import { activeStays, addDaysISO, blockNights, conflictMessage, conflictNight, firstBlockConflict, firstNightIn, planBlockMerge, validateBlockDates } from "@/lib/manual-block-conflict";

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

describe("activeStays (mesma regra do envio de disponibilidade)", () => {
  const row = (status: string | null, source: string | null, a = "2026-10-20", b = "2026-10-22") => ({ checkin_date: a, checkout_date: b, status, source });
  it("ignora canceladas (qualquer variação), bloqueios e iCal do Airbnb não confirmado", () => {
    expect(activeStays([row("cancelled", "channex"), row("canceled_by_guest", "channex"), row("blocked", "manual"), row("pending", "airbnb")])).toHaveLength(0);
  });
  it("conta reserva confirmada, inclusive do iCal do Airbnb", () => {
    expect(activeStays([row("confirmed", "airbnb"), row(null, "channex"), row("new", "channex")])).toHaveLength(3);
  });
  it("ignora linha sem datas", () => {
    expect(activeStays([{ checkin_date: null, checkout_date: "2026-10-22", status: "confirmed", source: "channex" }])).toHaveLength(0);
  });
});

describe("planBlockMerge", () => {
  const ex = (id: string, from: string, to: string) => ({ id, from, to });
  it("não duplica quando um bloqueio já cobre tudo", () => {
    expect(planBlockMerge([ex("a", "2026-10-20", "2026-10-30")], "2026-10-22", "2026-10-25").coveringId).toBe("a");
  });
  it("une sobreposto e encostado em um só", () => {
    const p = planBlockMerge([ex("a", "2026-10-18", "2026-10-21"), ex("b", "2026-10-24", "2026-10-27"), ex("c", "2026-11-10", "2026-11-12")], "2026-10-21", "2026-10-24");
    expect(p).toMatchObject({ coveringId: null, from: "2026-10-18", to: "2026-10-27" });
    expect(p.absorbIds.sort()).toEqual(["a", "b"]);
  });
  it("sem vizinhos, mantém o pedido", () => {
    expect(planBlockMerge([], "2026-10-21", "2026-10-24")).toMatchObject({ from: "2026-10-21", to: "2026-10-24", absorbIds: [] });
  });
});

describe("firstNightIn / validateBlockDates", () => {
  it("acha a primeira noite ocupada no intervalo (saída não conta)", () => {
    const n = new Set(["2026-10-23", "2026-10-24"]);
    expect(firstNightIn(n, "2026-10-21", "2026-10-24")).toBe("2026-10-23");
    expect(firstNightIn(n, "2026-10-21", "2026-10-23")).toBeNull();
  });
  it("valida ordem, passado (com 1 dia de folga de fuso) e tamanho", () => {
    const today = "2026-10-17";
    expect(validateBlockDates("2026-10-21", "2026-10-21", today)).toMatch(/depois da inicial/);
    expect(validateBlockDates("2026-10-10", "2026-10-12", today)).toMatch(/a partir de hoje/);
    expect(validateBlockDates("2026-10-16", "2026-10-18", today)).toBeNull();
    expect(validateBlockDates("2026-10-21", "2027-12-01", today)).toMatch(/366/);
    expect(validateBlockDates("2026-10-21", "2026-10-24", today)).toBeNull();
  });
});
