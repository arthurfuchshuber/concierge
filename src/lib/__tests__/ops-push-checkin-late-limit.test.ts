/**
 * "Check-In Atrasado" só depois do HORÁRIO LIMITE de check-in — nunca do horário inicial (08/11/2026: o
 * Studio 3, sem limite cadastrado, recebia o aviso às 15:30). Sem limite, só depois do dia previsto.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const OWNER = "a1000000-0000-4000-8000-000000000001";
const P = "b1000000-0000-4000-8000-000000000001";
const R = "f1000000-0000-4000-8000-000000000001";

const rowsRef: { checkin: Array<Record<string, unknown>> } = { checkin: [] };
vi.mock("@/lib/arrival-board.server", () => ({
  buildArrivalRows: vi.fn(async (_a: unknown, opts: { kind: string; range: string }) => ({
    rows: opts.kind === "checkin" && opts.range === "today" ? rowsRef.checkin : [],
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
            data: [{ id: P, owner_id: OWNER, name: "Casa", city: "Foz do Iguaçu", checkin_time: "15:00", checkin_time_max: null, checkout_time: "11:00" }],
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
  standardTime: "15:00",
  standardTimeMax: null,
  arrivalTimeOverride: null,
  guestArrivalTime: null,
  mutedUntil: null,
  ...over,
});
const at = (hm: string, day = "2026-11-08") => new Date(`${day}T${hm}:05-03:00`);
const lateTitles = () => sent.map((s) => s.title).filter((t) => /Check-Ins? Atrasados?/i.test(t));

beforeEach(() => {
  sent.length = 0;
});

describe("Check-In Atrasado respeita o horário limite", () => {
  it("sem limite cadastrado: nunca a partir do horário inicial (15:30, 20:00, 23:30 sem aviso)", async () => {
    rowsRef.checkin = [row()];
    for (const hm of ["15:30", "20:00", "23:30"]) await runOpsPushScan(fakeAdmin(), at(hm));
    expect(lateTitles()).toEqual([]);
  });

  it("sem limite: card de ontem ainda pendente fica atrasado", async () => {
    rowsRef.checkin = [row({ date: "2026-11-07" })];
    await runOpsPushScan(fakeAdmin(), at("10:00"));
    expect(lateTitles()).toHaveLength(1);
  });

  it("com limite 22:00: nada às 21:30; avisa às 22:30", async () => {
    rowsRef.checkin = [row({ standardTimeMax: "22:00" })];
    await runOpsPushScan(fakeAdmin(), at("21:30"));
    expect(lateTitles()).toEqual([]);
    await runOpsPushScan(fakeAdmin(), at("22:30"));
    expect(lateTitles()).toHaveLength(1);
  });

  it("previsão do hóspede mais tarde que o limite prevalece", async () => {
    rowsRef.checkin = [row({ standardTimeMax: "22:00", arrivalTimeOverride: "23:30" })];
    await runOpsPushScan(fakeAdmin(), at("22:30"));
    expect(lateTitles()).toEqual([]);
  });
});
