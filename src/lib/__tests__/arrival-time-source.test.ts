/**
 * `buildArrivalRows` repassa `arrival_time_source` gravado no banco (antes o laço do `statusMap` o descartava
 * e o `ArrivalRow` saía com `arrivalTimeSource: null`, o que impedia a equipe de estender o corte do auto-checkout).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/property-timezone", async (orig) => ({ ...(await orig<object>()) }));

const { buildArrivalRows } = await import("@/lib/arrival-board.server");

const P = "b1000000-0000-4000-8000-000000000001";
const R = "f1000000-0000-4000-8000-000000000001";

function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function fakeSupabase(source: string | null) {
  const d = today();
  const tables: Record<string, unknown[]> = {
    property_reservations: [
      {
        id: R,
        property_id: P,
        checkin_date: d,
        checkout_date: d,
        raw_summary: "Reserved",
        guest_hint: "Maria",
        status: "confirmed",
        source: "airbnb",
        synced_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      },
    ],
    properties: [{ id: P, name: "Casa", city: "São Paulo", country: "Brasil", checkout_time: "11:00", checkin_time: "15:00" }],
    guest_arrival_status: [
      {
        log_id: null,
        reservation_id: R,
        kind: "checkout",
        status: "pending",
        note: null,
        arrival_time_override: "13:00",
        arrival_date_override: null,
        arrival_date_base: null,
        arrival_time_source: source,
        muted_until: null,
        done_at: null,
        concluded_at: null,
      },
    ],
  };
  const make = (table: string) => {
    const q: Record<string, unknown> = {};
    const chain = () => q;
    for (const m of ["select", "eq", "neq", "in", "is", "not", "gte", "lte", "gt", "lt", "or", "order", "limit", "ilike", "contains"])
      q[m] = chain;
    q.maybeSingle = async () => ({ data: null, error: null });
    q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve({ data: tables[table] ?? [], error: null }).then(ok, ko);
    return q;
  };
  return { from: (t: string) => make(t), rpc: async () => ({ data: null, error: null }) } as never;
}

describe("buildArrivalRows — arrival_time_source", () => {
  it("entrega arrivalTimeSource 'staff' quando o banco tem esse valor", async () => {
    const { rows } = await buildArrivalRows(fakeSupabase("staff"), { kind: "checkout", range: "today", propIds: [P] });
    const row = rows.find((r) => r.reservationId === R);
    expect(row).toBeDefined();
    expect(row!.arrivalTimeOverride).toBe("13:00");
    expect(row!.arrivalTimeSource).toBe("staff");
  });

  it("valor 'guest' também chega intacto; sem valor fica null", async () => {
    const g = await buildArrivalRows(fakeSupabase("guest"), { kind: "checkout", range: "today", propIds: [P] });
    expect(g.rows.find((r) => r.reservationId === R)?.arrivalTimeSource).toBe("guest");
    const n = await buildArrivalRows(fakeSupabase(null), { kind: "checkout", range: "today", propIds: [P] });
    expect(n.rows.find((r) => r.reservationId === R)?.arrivalTimeSource).toBeNull();
  });
});
