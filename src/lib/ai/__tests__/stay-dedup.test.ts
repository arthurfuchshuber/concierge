import { describe, expect, it } from "vitest";
import { pairIcalWithApi, planCards } from "@/lib/stay-dedup";

const row = (id: string, source: string, status = "confirmed", ci = "2026-10-05", co = "2026-10-07", p = "p1") => ({ id, property_id: p, checkin_date: ci, checkout_date: co, status, source });

describe("iCal -> API", () => {
  it("casa por imóvel e datas, inclusive o bloqueio da mesma estadia", () => {
    const pairs = pairIcalWithApi([row("i1", "airbnb"), row("b1", "airbnb", "blocked"), row("a1", "channex"), row("x", "airbnb", "confirmed", "2026-11-01", "2026-11-03")]);
    expect(pairs.map((p) => p.ical.id).sort()).toEqual(["b1", "i1"]);
    expect(pairs.every((p) => p.api.id === "a1")).toBe(true);
  });
  it("ignora iCal já cancelado, API cancelada e outro imóvel", () => {
    expect(pairIcalWithApi([row("i1", "airbnb", "cancelled"), row("a1", "channex")])).toEqual([]);
    expect(pairIcalWithApi([row("i1", "airbnb"), row("a1", "channex", "cancelled")])).toEqual([]);
    expect(pairIcalWithApi([row("i1", "airbnb"), row("a1", "channex", "confirmed", "2026-10-05", "2026-10-07", "p2")])).toEqual([]);
  });
  it("cartões: move quando a API não tem; mantém o mais adiantado quando os dois têm", () => {
    const ic = [{ id: "c1", reservation_id: "i", kind: "checkin", concluded_at: "x" }, { id: "c2", reservation_id: "i", kind: "checkout", cleaning_type: "normal", concluded_at: "x" }];
    expect(planCards(ic, [])).toEqual({ moveIds: ["c1", "c2"], dropIds: [] });
    const ac = [{ id: "a1", reservation_id: "a", kind: "checkin", status: "pending" }, { id: "a2", reservation_id: "a", kind: "checkout", status: "done", concluded_at: "y" }];
    expect(planCards(ic, ac)).toEqual({ moveIds: ["c1"], dropIds: ["a1"] });
  });
});
