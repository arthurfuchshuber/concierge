import { describe, expect, it } from "vitest";
import { cancellationWindow, decideReservationRequest, detectReservationRequest } from "../reservation-change";

const tz = "America/Sao_Paulo";
const base = { checkin: "2026-11-10", checkinTime: "15:00", nights: 3, tz };
describe("reservation-change", () => {
  it("detecta pedidos", () => {
    expect(detectReservationRequest("Queria cancelar minha reserva")).toBe("cancel");
    expect(detectReservationRequest("posso reduzir o período?")).toBe("shorten");
    expect(detectReservationRequest("quero ficar mais duas noites")).toBe("extend");
    expect(detectReservationRequest("podemos fechar por fora?")).toBe("outside_booking");
    expect(detectReservationRequest("qual a senha do wifi")).toBeNull();
  });
  it("moderada: 5 dias antes", () => {
    const free = cancellationWindow({ ...base, category: "moderate", nowMs: Date.parse("2026-11-01T12:00:00Z") });
    expect(free.status).toBe("free");
    const late = cancellationWindow({ ...base, category: "moderate", nowMs: Date.parse("2026-11-07T12:00:00Z") });
    expect(late.status).toBe("expired");
  });
  it("sem certeza da modalidade: não decide, orienta o menu da plataforma", () => {
    const w = cancellationWindow({ ...base, category: null, nowMs: Date.now() });
    expect(decideReservationRequest({ kind: "cancel", window: w }).route).toBe("platform_menu");
  });
  it("vencido -> recusa; estender -> plataforma", () => {
    const w = cancellationWindow({ ...base, category: "moderate", nowMs: Date.parse("2026-11-09T12:00:00Z") });
    expect(decideReservationRequest({ kind: "shorten", window: w }).route).toBe("decline");
    expect(decideReservationRequest({ kind: "extend", window: null }).route).toBe("platform");
  });
  it("não reembolsável da própria reserva: sem prazo, recusa gentil", () => {
    const w = cancellationWindow({ ...base, category: "tiered_pricing_non_refundable", nowMs: Date.parse("2026-10-20T12:00:00Z") });
    expect(w.status).toBe("expired");
    expect(w.policy).toBe("Não reembolsável");
    expect(decideReservationRequest({ kind: "cancel", window: w }).route).toBe("decline");
  });
  it("estadia longa amplia prazo", () => {
    const w = cancellationWindow({ ...base, nights: 30, category: "flexible", nowMs: Date.parse("2026-10-05T12:00:00Z") });
    expect(w.status).toBe("free");
  });
});
