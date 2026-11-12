/**
 * Viradas no mesmo dia na decisão humana (11/11/2026): saída tardia confere outra ENTRADA no dia da saída;
 * entrada antecipada confere outra SAÍDA no dia da entrada (o cartão avisa que depende da higienização).
 * Anúncios gêmeos não têm imóvel próprio: as reservas deles já estão no `property_id` do imóvel principal.
 */
import { describe, expect, it } from "vitest";
import { loadTurnoverFlags } from "@/lib/guest-ai-decision.server";
import { buildDecisionAckText, buildDecisionQuestion } from "@/lib/guest-ai-decision";

type Row = Record<string, unknown>;
function fakeDb(rows: Row[]) {
  return {
    from() {
      const f: Array<[string, string, unknown]> = [];
      const match = () => rows.filter((r) => f.every(([op, k, v]) => (op === "eq" ? r[k] === v : r[k] !== v)));
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (k: string, v: unknown) => (f.push(["eq", k, v]), q),
        neq: (k: string, v: unknown) => (f.push(["neq", k, v]), q),
        limit: () => Promise.resolve({ data: match(), error: null }),
        maybeSingle: () => Promise.resolve({ data: match()[0] ?? null, error: null }),
      };
      return q;
    },
  } as never;
}

const P = "studio-101"; // imóvel principal; reservas do anúncio gêmeo entram com este mesmo property_id
const MINE = { id: "mine", property_id: P, status: "confirmed", checkin_date: "2026-11-20", checkout_date: "2026-11-23" };

describe("loadTurnoverFlags", () => {
  it("sameDayDeparture: outra reserva confirmada sai no dia da nossa entrada (inclusive vinda do anúncio gêmeo)", async () => {
    const db = fakeDb([MINE, { id: "twin-booking", property_id: P, status: "confirmed", checkin_date: "2026-11-17", checkout_date: "2026-11-20" }]);
    expect(await loadTurnoverFlags(db, P, "mine")).toEqual({ sameDayArrival: false, sameDayDeparture: true });
  });
  it("sameDayArrival: outra reserva confirmada entra no dia da nossa saída; cancelada e de outro imóvel não contam", async () => {
    const db = fakeDb([
      MINE,
      { id: "next", property_id: P, status: "confirmed", checkin_date: "2026-11-23", checkout_date: "2026-11-25" },
      { id: "x", property_id: P, status: "cancelled", checkin_date: "2026-11-17", checkout_date: "2026-11-20" },
      { id: "y", property_id: "outro", status: "confirmed", checkin_date: "2026-11-17", checkout_date: "2026-11-20" },
    ]);
    expect(await loadTurnoverFlags(db, P, "mine")).toEqual({ sameDayArrival: true, sameDayDeparture: false });
  });
  it("sem reserva (consulta) ⇒ desconhecido", async () => {
    expect(await loadTurnoverFlags(fakeDb([]), P, null)).toEqual({ sameDayArrival: null, sameDayDeparture: null });
  });
});

describe("cartão e resposta com as viradas", () => {
  it("entrada antecipada com saída no mesmo dia: o cartão avisa que depende da higienização", () => {
    const q = buildDecisionQuestion({ kind: "early_checkin", guestName: "Ana", time: "11:00", officialCheckout: "11:00", officialCheckin: "15:00", sameDayArrival: null, sameDayDeparture: true, internalQuestion: null, guestMessage: null });
    expect(q).toMatch(/Há saída de outro hóspede no mesmo dia: a entrada depende da higienização/);
  });
  it("resposta ao hóspede: entrada antecipada só se confirma no próprio dia; saída com virada é pontual", () => {
    const early = buildDecisionAckText({ guestName: "Ana", officialCheckin: "15:00", officialCheckout: "11:00", late: null, early: { time: "11:00", day: null }, sameDayDeparture: true });
    expect(early).toMatch(/^Ana, nosso check-in é às 15h\. Faremos o possível para liberar o seu acesso antes/);
    expect(early).toMatch(/no próprio dia/);
    const late = buildDecisionAckText({ guestName: "Ana", officialCheckin: "15:00", officialCheckout: "11:00", late: { time: "14:00", day: null }, early: null, sameDayArrival: true });
    expect(late).toMatch(/já há outro check-in programado na casa; por isso a saída precisa ser pontual/);
  });
});
