/**
 * "Check-Out Atrasado" usa o MESMO corte da baixa automática (pedido explícito, 08/11/2026): late checkout
 * formal (R6) ou horário definido pela EQUIPE maior que o oficial. Caso real: Av. Turística com 13:00 da
 * equipe recebeu "Check-Out Atrasado" às 13:00, no mesmo segundo em que a baixa automática fechou o card.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const OWNER = "a1000000-0000-4000-8000-000000000001";
const P = "b1000000-0000-4000-8000-000000000001";
const R = "f1000000-0000-4000-8000-000000000001";

const rowsRef: { checkout: Array<Record<string, unknown>> } = { checkout: [] };
vi.mock("@/lib/arrival-board.server", () => ({
  buildArrivalRows: vi.fn(async (_a: unknown, opts: { kind: string; range: string }) => ({
    rows: opts.kind === "checkout" && opts.range === "today" ? rowsRef.checkout : [],
  })),
}));
const sent: Array<{ title: string }> = [];
vi.mock("@/lib/push.server", () => ({
  sendPushToSubscriptions: vi.fn(async (subs: unknown[], payload: { title: string }) => {
    sent.push(payload);
    return { sent: subs.length, stale: [] };
  }),
}));

const { runOpsPushScan } = await import("@/lib/ops-push.server");

const lateRef: { rows: Array<Record<string, unknown>>; fail: boolean } = { rows: [], fail: false };

function fakeAdmin() {
  const log = new Set<string>();
  return {
    from(table: string) {
      const q: Record<string, unknown> = {};
      const result = () => {
        if (table === "properties")
          return {
            data: [{ id: P, owner_id: OWNER, name: "Casa", city: "Foz do Iguaçu", checkin_time: "15:00", checkin_time_max: "22:00", checkout_time: "11:00" }],
            error: null,
          };
        if (table === "guest_arrival_status")
          return lateRef.fail ? { data: null, error: { message: "x" } } : { data: lateRef.rows, error: null };
        if (table === "account_members") return { data: [], error: null };
        if (table === "push_subscriptions")
          return { data: [{ id: "s1", endpoint: "ep", p256dh: "k", auth: "a" }], error: null };
        return { data: [], error: null }; // ops_push_log (respiro / hora anterior)
      };
      for (const m of ["select", "eq", "gt", "gte", "limit", "in", "not"]) q[m] = () => q;
      q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, ko);
      q.insert = async (row: { dedupe_key: string }) => {
        if (log.has(row.dedupe_key)) return { error: { message: "dup" } };
        log.add(row.dedupe_key);
        return { error: null };
      };
      q.update = () => ({ eq: async () => ({ error: null }) });
      q.delete = () => ({ eq: async () => ({ error: null }), in: async () => ({ error: null }) });
      return q;
    },
  } as never;
}

const row = (over: Record<string, unknown> = {}) => ({
  logId: `ical:${R}`,
  reservationId: R,
  propertyId: P,
  propertyName: "Casa",
  status: "pending",
  date: "2026-11-08",
  guestCheckout: "2026-11-08",
  standardTime: "11:00",
  arrivalTimeOverride: null,
  arrivalTimeSource: null,
  mutedUntil: null,
  ...over,
});
// São Paulo = UTC-3
const at = (hm: string) => new Date(`2026-11-08T${hm}:05-03:00`);
const lateTitles = () => sent.map((s) => s.title).filter((t) => t.includes("Check-Out Atrasado"));

beforeEach(() => {
  sent.length = 0;
  lateRef.rows = [];
  lateRef.fail = false;
});

describe("Check-Out Atrasado respeita o corte da baixa automática", () => {
  it("horário da EQUIPE (13:00): nada às 12:00 nem às 13:00; avisa só depois do corte", async () => {
    rowsRef.checkout = [row({ arrivalTimeOverride: "13:00", arrivalTimeSource: "staff" })];
    await runOpsPushScan(fakeAdmin(), at("12:00"));
    await runOpsPushScan(fakeAdmin(), at("13:00"));
    expect(lateTitles()).toEqual([]);
    await runOpsPushScan(fakeAdmin(), at("13:30"));
    expect(lateTitles()).toHaveLength(1);
  });

  it("previsão do hóspede não estende: atrasado depois do oficial", async () => {
    rowsRef.checkout = [row({ arrivalTimeOverride: "13:00", arrivalTimeSource: "guest" })];
    await runOpsPushScan(fakeAdmin(), at("11:30"));
    expect(lateTitles()).toHaveLength(1);
  });

  it("previsão MAIS CEDO que o oficial (hóspede, IA ou equipe) não deixa ninguém 'atrasado' antes do oficial", async () => {
    for (const src of ["guest", "guest_ai", "staff"]) {
      rowsRef.checkout = [row({ arrivalTimeOverride: "09:00", arrivalTimeSource: src })];
      await runOpsPushScan(fakeAdmin(), at("10:30"));
    }
    expect(lateTitles()).toEqual([]);
  });

  it("late checkout formal (R6) manda", async () => {
    rowsRef.checkout = [row()];
    lateRef.rows = [
      { reservation_id: R, log_id: null, late_checkout_time: "14:00", late_checkout_approved_at: "2026-11-07T10:00:00Z", late_checkout_by: OWNER },
    ];
    await runOpsPushScan(fakeAdmin(), at("13:30"));
    expect(lateTitles()).toEqual([]);
    await runOpsPushScan(fakeAdmin(), at("14:30"));
    expect(lateTitles()).toHaveLength(1);
  });

  it("sem a leitura das autorizações não avisa saída atrasada às cegas", async () => {
    rowsRef.checkout = [row()];
    lateRef.fail = true;
    await runOpsPushScan(fakeAdmin(), at("12:30"));
    expect(lateTitles()).toEqual([]);
  });
});
