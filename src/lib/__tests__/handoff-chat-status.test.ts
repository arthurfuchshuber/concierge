import { describe, expect, it } from "vitest";
import { buildChatFlows, chatStatusOf, REQUEST_WINDOW_MS, type ChatFlow } from "@/lib/handoff-chat-status";

const today = "2026-11-26";
const now = Date.parse("2026-11-26T15:00:00Z");
const base = { today, nowMs: now, isAirbnb: true };
const conf = (checkin: string, checkout: string) => ({ status: "confirmed" as const, checkin, checkout });

describe("chatStatusOf — etiqueta do card", () => {
  it("reserva confirmada vira Confirmada / Ativa / Encerrada pelas datas", () => {
    expect(chatStatusOf({ ...base, res: conf("2026-11-28", "2026-12-01"), flow: null })).toBe("Confirmada");
    expect(chatStatusOf({ ...base, res: conf("2026-11-24", "2026-11-26"), flow: null })).toBe("Ativa");
    expect(chatStatusOf({ ...base, res: conf("2026-11-26", "2026-11-28"), flow: null })).toBe("Ativa");
    expect(chatStatusOf({ ...base, res: conf("2026-11-20", "2026-11-25"), flow: null })).toBe("Encerrada");
  });

  it("cancelada", () => {
    expect(chatStatusOf({ ...base, res: { status: "cancelled", checkin: "2026-12-01", checkout: "2026-12-03" }, flow: null })).toBe("Cancelada");
  });

  it("conversa do Airbnb sem reserva é Consulta; fora do Airbnb sem dado não tem etiqueta", () => {
    expect(chatStatusOf({ ...base, res: { status: "no_reservations", checkin: null, checkout: null }, flow: null })).toBe("Consulta");
    expect(chatStatusOf({ ...base, isAirbnb: false, res: { status: "missing", checkin: null, checkout: null }, flow: null })).toBeNull();
  });

  it("pedido de reserva: Solicitação só dentro das 24 h; recusado vira Recusada", () => {
    const req = (state: ChatFlow["state"], at: string): ChatFlow => ({ kind: "request", state, checkin: "2026-12-10", checkout: "2026-12-12", at });
    expect(chatStatusOf({ ...base, res: null, flow: req("pending", "2026-11-26T10:00:00Z") })).toBe("Solicitação");
    const old = new Date(now - REQUEST_WINDOW_MS - 1000).toISOString();
    expect(chatStatusOf({ ...base, res: null, flow: req("pending", old) })).toBe("Consulta");
    expect(chatStatusOf({ ...base, res: null, flow: req("declined", "2026-11-26T10:00:00Z") })).toBe("Recusada");
    expect(chatStatusOf({ ...base, res: null, flow: req("accepted", "2026-11-26T10:00:00Z") })).toBe("Confirmada");
  });

  it("consulta recusada vira Recusada", () => {
    const f: ChatFlow = { kind: "inquiry", state: "declined", checkin: "2027-01-02", checkout: "2027-01-08", at: "2026-11-17T00:00:00Z" };
    expect(chatStatusOf({ ...base, res: null, flow: f })).toBe("Recusada");
  });

  it("caso Izabela: nova consulta depois de uma estadia encerrada mostra Consulta, não Encerrada", () => {
    const f: ChatFlow = { kind: "inquiry", state: "active", checkin: "2026-12-20", checkout: "2026-12-23", at: "2026-11-25T00:00:00Z" };
    expect(chatStatusOf({ ...base, res: conf("2026-10-01", "2026-10-04"), flow: f })).toBe("Consulta");
  });

  it("consulta que virou a reserva atual segue a reserva", () => {
    const f: ChatFlow = { kind: "inquiry", state: "active", checkin: "2026-11-28", checkout: "2026-12-01", at: "2026-11-20T00:00:00Z" };
    expect(chatStatusOf({ ...base, res: conf("2026-11-28", "2026-12-01"), flow: f })).toBe("Confirmada");
  });
});

describe("buildChatFlows — registros brutos da Channex", () => {
  it("liga aceite/recusa ao pedido pelo thread do Airbnb e fica com o evento mais recente", () => {
    const rows = [
      {
        entity_type: "webhook:inquiry",
        first_seen_at: "2026-11-20T00:00:00Z",
        payload: { payload: { status: "active", message_thread_id: "T1", booking_details: { checkin_date: "2026-11-27", checkout_date: "2026-11-29" } } },
      },
      {
        entity_type: "webhook:reservation_request",
        first_seen_at: "2026-11-24T04:24:20Z",
        payload: { payload: { message_thread_id: "T1", bms: { meta: { thread_id: "2739701924" } }, rooms: [{ checkin_date: "2026-11-27", checkout_date: "2026-11-29" }] } },
      },
    ];
    const outs = [
      { entity_type: "webhook:accepted_reservation", first_seen_at: "2026-11-24T04:48:21Z", payload: { payload: { bms: { meta: { thread_id: "2739701924" } } } } },
    ];
    const f = buildChatFlows(rows, outs).get("T1");
    expect(f).toMatchObject({ kind: "request", state: "accepted", checkin: "2026-11-27", checkout: "2026-11-29" });
  });
});
