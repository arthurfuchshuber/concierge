import { describe, expect, it } from "vitest";
import { decideHostMilestone, parseHostReading } from "../decide";

const base = {
  today: "2026-11-14",
  nowHm: "11:00",
  reservation: { status: "confirmed", checkinDate: "2026-11-10", checkoutDate: "2026-11-14" },
  cards: { checkinDone: true, checkoutDone: false },
};

describe("marco dito pelo anfitrião", () => {
  it("checkout no dia da saída com leitura confiante ⇒ dá baixa", () => {
    expect(decideHostMilestone({ ...base, reading: { milestone: "checkout_done", confidence: 0.9 } })).toEqual({ act: true, action: "checkout_done", early: false });
  });
  it("checkout antes do dia da saída, com reserva em andamento ⇒ saída antecipada", () => {
    expect(decideHostMilestone({ ...base, today: "2026-11-12", reading: { milestone: "checkout_done", confidence: 0.95 } })).toEqual({ act: true, action: "checkout_done", early: true });
  });
  it("check-in no 3º dia da reserva ⇒ dá baixa", () => {
    const ci = { ...base, today: "2026-11-12", cards: { checkinDone: false, checkoutDone: false } };
    expect(decideHostMilestone({ ...ci, reading: { milestone: "checkin_done", confidence: 0.9 } })).toEqual({ act: true, action: "checkin_done", early: false });
  });
  it("checkout sem check-in carimbado ⇒ dá baixa mesmo assim", () => {
    const x = { ...base, cards: { checkinDone: false, checkoutDone: false } };
    expect(decideHostMilestone({ ...x, reading: { milestone: "checkout_done", confidence: 0.9 } }).act).toBe(true);
  });
  it("antes da entrada ou depois do fim da reserva ⇒ não age", () => {
    expect(decideHostMilestone({ ...base, today: "2026-11-09", reading: { milestone: "checkout_done", confidence: 1 } }).act).toBe(false);
    expect(decideHostMilestone({ ...base, today: "2026-11-15", nowHm: "10:00", reading: { milestone: "checkout_done", confidence: 1 } }).act).toBe(false);
    expect(decideHostMilestone({ ...base, today: "2026-11-15", nowHm: "02:00", reading: { milestone: "checkout_done", confidence: 1 } }).act).toBe(true);
  });
  it("confiança abaixo de 0,8 ⇒ não age", () => {
    expect(decideHostMilestone({ ...base, reading: { milestone: "checkout_done", confidence: 0.7 } })).toEqual({ act: false, code: "low_confidence" });
  });
  it("check-in no dia da entrada ⇒ dá baixa; card já concluído ⇒ não", () => {
    const ci = { ...base, today: "2026-11-10", cards: { checkinDone: false, checkoutDone: false } };
    expect(decideHostMilestone({ ...ci, reading: { milestone: "checkin_done", confidence: 0.9 } })).toEqual({ act: true, action: "checkin_done", early: false });
    expect(decideHostMilestone({ ...ci, cards: { checkinDone: true, checkoutDone: false }, reading: { milestone: "checkin_done", confidence: 0.9 } }).act).toBe(false);
  });
  it("reserva cancelada ⇒ não age", () => {
    expect(decideHostMilestone({ ...base, reservation: { ...base.reservation, status: "cancelled" }, reading: { milestone: "checkout_done", confidence: 1 } }).act).toBe(false);
  });
  it("leitura malformada é descartada", () => {
    expect(parseHostReading({ milestone: "talvez", confidence: 1 })).toBeNull();
  });
});
