import { describe, expect, it } from "vitest";
import { groupByShape, rowsFromAvailability, rowsFromRestrictions, rowsFromWebhook } from "@/lib/calendar-import";
import { GUEST_DATA_BOUNDARY } from "@/lib/ai/guest-data-boundary";

describe("importação do calendário", () => {
  it("lê o webhook ari com bloqueio e reserva", () => {
    const rows = rowsFromWebhook({ event: "ari", property_id: "p1", payload: [{ date: "2026-11-14", booked: 1, stop_sell: true, availability: 0, rate_plan_id: "rp", room_type_id: "rt", channel_id: null }] });
    expect(rows).toEqual([{ rate_plan_id: "rp", date: "2026-11-14", room_type_id: "rt", channex_property_id: "p1", availability: 0, booked: 1, stop_sell: true }]);
  });
  it("lê restrições e disponibilidade da API", () => {
    const r = rowsFromRestrictions({ rp: { "2026-12-01": { rate: "350.00", min_stay_arrival: 2, closed_to_arrival: false } } }, "p1");
    expect(r[0]).toMatchObject({ rate_plan_id: "rp", date: "2026-12-01", rate: 350, min_stay: 2, closed_to_arrival: false });
    const a = rowsFromAvailability({ rt: { "2026-12-01": 0 } }, "p1", { rt: ["rp"] });
    expect(a[0]).toMatchObject({ rate_plan_id: "rp", availability: 0 });
  });
  it("agrupa por formato para não zerar colunas ausentes", () => {
    const rows = [
      ...rowsFromRestrictions({ rp: { "2026-12-01": { rate: 1 } } }, "p1"),
      ...rowsFromAvailability({ rt: { "2026-12-01": 1 } }, "p1", { rt: ["rp"] }),
    ];
    expect(groupByShape(rows).length).toBe(2);
  });
  it("a IA só cita dado que o hóspede vê", () => {
    expect(GUEST_DATA_BOUNDARY).toMatch(/BRUTO/);
    expect(GUEST_DATA_BOUNDARY).toMatch(/líquido/);
  });
});
