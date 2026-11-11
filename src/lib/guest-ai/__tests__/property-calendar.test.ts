/**
 * Carregador do calendário (diretivas de 11/11/2026): janela DINÂMICA (estadia; datas citadas pelo hóspede,
 * mesmo meses à frente; senão 14 dias), projeção fechada sem PII, viradas no mesmo dia e prorrogação, e a unidade
 * física inteira (anúncios gêmeos não têm imóvel próprio: as reservas deles já estão no `property_id` principal).
 */
import { describe, expect, it } from "vitest";
import { addDays, calendarFactValue, calendarWindow, extractMentionedDates } from "@/lib/guest-ai/calendar-occupancy";
import { fetchPropertyOccupancy } from "@/lib/guest-ai/data/property-calendar.server";
import { CALENDAR_GUEST_TEXT_COLUMNS, RESERVATION_COLUMNS } from "@/lib/guest-ai/data/projections";
import { issue } from "@/lib/guest-ai/trust";
import type { ValidatedTurn } from "@/lib/guest-ai/types";

const P = "studio-101";
const TODAY = "2026-11-11";
type Row = Record<string, unknown>;

/** Banco falso com os filtros que o carregador usa (eq, neq, in, gt, lte, order, limit, maybeSingle). */
function fakeDb(tables: Record<string, Row[]>) {
  const calls: Array<{ table: string; select: string; filters: Array<[string, string, unknown]> }> = [];
  return {
    calls,
    db: {
      from(table: string) {
        const call = { table, select: "", filters: [] as Array<[string, string, unknown]> };
        calls.push(call);
        const match = () =>
          (tables[table] ?? []).filter((r) =>
            call.filters.every(([op, k, v]) =>
              op === "eq" ? r[k] === v : op === "in" ? (v as unknown[]).includes(r[k]) : op === "gt" ? String(r[k]) > String(v) : op === "lte" ? String(r[k]) <= String(v) : true,
            ),
          );
        const q: Record<string, unknown> = {
          select: (c: string) => ((call.select = c), q),
          eq: (k: string, v: unknown) => (call.filters.push(["eq", k, v]), q),
          in: (k: string, v: unknown) => (call.filters.push(["in", k, v]), q),
          gt: (k: string, v: unknown) => (call.filters.push(["gt", k, v]), q),
          lte: (k: string, v: unknown) => (call.filters.push(["lte", k, v]), q),
          order: () => q,
          limit: () => Promise.resolve({ data: match(), error: null }),
          maybeSingle: () => Promise.resolve({ data: match()[0] ?? null, error: null }),
        };
        return q;
      },
    } as never,
  };
}
const turn = (reservationId: string | null) =>
  issue("turn", { surface: "airbnb", conversationId: "conv", messageId: "m", propertyId: P, tenantId: "t", guestSessionId: "airbnb:1", conversationStatus: "ai", reservationId, guestName: null, messageCreatedAt: null }) as ValidatedTurn;
const res = (id: string, ci: string, co: string, over: Row = {}): Row => ({ id, property_id: P, status: "confirmed", source: "channex", checkin_date: ci, checkout_date: co, ...over });

describe("janela dinâmica", () => {
  it("estadia: véspera da entrada até 3 dias após a saída; datas citadas somam; sem nada, 14 dias", () => {
    expect(calendarWindow({ today: TODAY, stay: { checkin: "2026-11-20", checkout: "2026-11-23" } })).toEqual({ start: "2026-11-19", end: "2026-11-26" });
    expect(calendarWindow({ today: TODAY, mentionedDates: ["2027-02-13", "2027-02-17"] })).toEqual({ start: "2027-02-12", end: "2027-02-18" });
    expect(calendarWindow({ today: TODAY })).toEqual({ start: TODAY, end: addDays(TODAY, 14) });
  });
  it("datas citadas meses à frente (Réveillon, Carnaval) são lidas com mês explícito", () => {
    expect(extractMentionedDates("Queria do dia 30/12 até 2 de janeiro", TODAY)).toEqual(["2026-12-30", "2027-01-02"]);
    expect(extractMentionedDates("Tem vaga de 13/02 a 17/02?", TODAY)).toEqual(["2027-02-13", "2027-02-17"]);
  });
});

describe("carregador", () => {
  it("consulta: lê as datas citadas pelo hóspede e busca exatamente essa janela (sem teto de 60 dias)", async () => {
    const { db, calls } = fakeDb({
      property_chat_messages: [{ id: "g1", conversation_id: "conv", role: "user", sender_type: "guest", is_internal_note: false, content: "Vocês têm o Réveillon livre? Do dia 30/12 até 02/01" }],
      property_reservations: [res("rev", "2026-12-31", "2027-01-03"), res("near", "2026-11-15", "2026-11-17")],
    });
    const occ = await fetchPropertyOccupancy(turn(null), { today: TODAY }, { db });
    expect(occ.windowStart).toBe("2026-12-29");
    expect(occ.windowEnd).toBe("2027-01-03");
    expect(occ.occupiedRanges).toEqual([{ checkin: "2026-12-31", checkout: "2027-01-03", status: "confirmed" }]);
    expect(occ.mentionedDates).toEqual([
      { date: "2026-12-30", nightOccupied: false, otherCheckinOnDay: false },
      { date: "2027-01-02", nightOccupied: true, otherCheckinOnDay: false },
    ]);
    const msgCall = calls.find((c) => c.table === "property_chat_messages")!;
    expect(msgCall.select).toBe(CALENDAR_GUEST_TEXT_COLUMNS.join(", "));
    expect(msgCall.filters).toContainEqual(["eq", "conversation_id", "conv"]);
    const resCall = calls.filter((c) => c.table === "property_reservations").pop()!;
    expect(resCall.select).toBe(RESERVATION_COLUMNS.join(", "));
    expect(resCall.filters).toContainEqual(["eq", "property_id", P]);
    expect(resCall.filters).toContainEqual(["in", "status", ["confirmed", "blocked"]]);
  });

  it("consulta sem datas citadas: próximos 14 dias", async () => {
    const { db } = fakeDb({ property_chat_messages: [], property_reservations: [res("a", "2026-11-15", "2026-11-17"), res("far", "2026-12-20", "2026-12-22")] });
    const occ = await fetchPropertyOccupancy(turn(null), { today: TODAY }, { db });
    expect(occ.windowEnd).toBe(addDays(TODAY, 14));
    expect(occ.occupiedRanges.map((r) => r.checkin)).toEqual(["2026-11-15"]);
  });

  it("estadia: viradas no mesmo dia (entrada e saída) e prorrogação; reservas do anúncio gêmeo já vêm no mesmo imóvel", async () => {
    const { db } = fakeDb({
      property_chat_messages: [],
      property_reservations: [
        res("mine", "2026-11-20", "2026-11-23"),
        res("from-twin-listing", "2026-11-17", "2026-11-20"), // reserva feita pelo anúncio gêmeo
        res("next", "2026-11-23", "2026-11-25"),
      ],
    });
    const occ = await fetchPropertyOccupancy(turn("mine"), { today: TODAY }, { db });
    expect(occ.windowStart).toBe("2026-11-19");
    expect(occ.windowEnd).toBe("2026-11-26");
    expect(occ.stay).toEqual({ checkin: "2026-11-20", checkout: "2026-11-23", sameDayDepartureOnCheckin: true, sameDayArrivalOnCheckout: true, isExtensionAvailable: false });
    expect(occ.occupiedRanges.some((r) => r.checkin === "2026-11-20")).toBe(false); // a própria reserva não conta
    const fact = calendarFactValue(occ) as { estadia: Record<string, unknown> };
    expect(fact.estadia).toEqual({ entrada: "2026-11-20", saida: "2026-11-23", outra_saida_no_dia_da_entrada: true, outra_entrada_no_dia_da_saida: true, prorrogacao_livre: false });
  });

  it("estadia sem viradas e com as noites seguintes livres ⇒ prorrogação livre", async () => {
    const { db } = fakeDb({ property_chat_messages: [], property_reservations: [res("mine", "2026-11-20", "2026-11-23")] });
    const occ = await fetchPropertyOccupancy(turn("mine"), { today: TODAY }, { db });
    expect(occ.stay).toMatchObject({ sameDayDepartureOnCheckin: false, sameDayArrivalOnCheckout: false, isExtensionAvailable: true });
  });

  it("turno não emitido pelo escopo ⇒ recusa", async () => {
    const { db } = fakeDb({});
    await expect(fetchPropertyOccupancy({ ...turn(null) } as never, { today: TODAY }, { db })).rejects.toThrow();
  });
});
