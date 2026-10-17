import { describe, it, expect } from "vitest";
import { samePhone, pickReservation, extractReservationCodes, type MatchRow } from "../whatsapp-guest-match";

const row = (id: string, phones: string[], code: string, ci = "2026-10-16", co = "2026-10-18"): MatchRow => ({
  id, property_id: "p", checkin_date: ci, checkout_date: co, status: "confirmed", guest_contacts: { code, phones },
});

describe("telefone do WhatsApp x telefone cadastrado na Channex", () => {
  it("com e sem DDI 55", () => expect(samePhone("5545999119269", "45999119269")).toBe(true));
  it("com e sem nono dígito", () => expect(samePhone("+55 45 99911-9269", "(45) 9911-9269")).toBe(true));
  it("sem DDD", () => expect(samePhone("99911-9269", "5545999119269")).toBe(true));
  it("DDD diferente não casa", () => expect(samePhone("5511999119269", "5545999119269")).toBe(false));
});

describe("escolha da reserva", () => {
  const today = "2026-10-17";
  it("acha pelo telefone cadastrado", () => {
    expect(pickReservation([row("a", ["+55 45 99911-9269"], "HMAAA11111")], { phone: "554599119269", text: "oi", today })?.by).toBe("telefone");
  });
  it("sem telefone, acha pelo código da reserva", () => {
    const r = pickReservation([row("a", [], "HMCS9QXYK5")], { phone: "5511900000000", text: "meu código é hmcs9qxyk5", today });
    expect(r?.row.id).toBe("a");
    expect(r?.by).toBe("codigo");
  });
  it("nunca identifica por nome", () => {
    expect(pickReservation([row("a", [], "HMAAA11111")], { phone: "5511900000000", text: "Sou Rafael Souza", today })).toBeNull();
  });
  it("duas estadias ativas no mesmo telefone = ambíguo", () => {
    expect(pickReservation([row("a", ["45999119269"], "HM1A"), row("b", ["45999119269"], "HM2B")], { phone: "45999119269", text: "", today })).toBeNull();
  });
  it("extrai código", () => expect(extractReservationCodes("código HMCS9QXYK5 ok")).toEqual(["HMCS9QXYK5"]));
});
