/**
 * Idempotência do avanço da esteira (09/11/2026, bug real no Studio 102): a IA concluiu o check-out às
 * 09:55 e um clique da equipe numa tela desatualizada, 3 min depois, reescreveu horário e nota
 * ("Confirmado pela IA…" → "Confirmado pela equipe") e repetiu o push. Etapa já concluída ⇒ nada é escrito.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ops-push.server", () => ({
  notifyStaffArrivalStep: vi.fn(),
  notifyCleaningReady: vi.fn(),
  notifyCleaningDone: vi.fn(),
  notifyGuestCheckinReleased: vi.fn(),
}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

const { alreadyAdvanced, runAdvanceArrival } = await import("@/lib/dashboard.functions");

const done = (over: Record<string, unknown> = {}) => ({
  status: "done",
  done_at: "2026-11-09T12:55:08Z",
  concluded_at: null,
  note: "Confirmado pela IA a partir da mensagem do hóspede",
  ...over,
});
const pending = { status: "pending", done_at: null, concluded_at: null, note: null };

describe("alreadyAdvanced — etapa já concluída?", () => {
  it("check-out já feito ⇒ confirmar check-out (ou da estadia) não refaz", () => {
    expect(alreadyAdvanced({ from: "checkout" }, { checkout: done() })?.note).toMatch(/IA/);
    expect(alreadyAdvanced({ from: "stay" }, { checkout: done() })).not.toBeNull();
  });
  it("check-out pendente ou sem linha ⇒ segue normal", () => {
    expect(alreadyAdvanced({ from: "checkout" }, { checkout: pending })).toBeNull();
    expect(alreadyAdvanced({ from: "checkout" }, {})).toBeNull();
  });
  it("check-in: só `done` conta; no-show segue o fluxo de sempre", () => {
    expect(alreadyAdvanced({ from: "checkin" }, { checkin: done() })).not.toBeNull();
    expect(alreadyAdvanced({ from: "checkin" }, { checkin: { ...pending, status: "no_show" } })).toBeNull();
  });
  it("limpeza: só recusa quando a estadia já foi concluída (concluded_at)", () => {
    expect(alreadyAdvanced({ from: "cleaning" }, { checkout: done() })).toBeNull();
    expect(
      alreadyAdvanced({ from: "cleaning" }, { checkout: done({ concluded_at: "2026-11-09T13:10:00Z" }) }),
    ).not.toBeNull();
    expect(
      alreadyAdvanced(
        { from: "checkout", skipCleaning: true },
        { checkout: done({ concluded_at: "2026-11-09T13:10:00Z" }) },
      ),
    ).not.toBeNull();
  });
});

function fakeDb(statusRows: Array<Record<string, unknown>>) {
  const writes: string[] = [];
  const db = {
    from(table: string) {
      const q: Record<string, unknown> = {};
      const chain = () => q;
      Object.assign(q, {
        select: chain,
        eq: chain,
        or: chain,
        is: chain,
        in: chain,
        limit: chain,
        maybeSingle: async () => ({
          data: { property_id: "p1", checkin_date: "2026-11-07", checkout_date: "2026-11-09" },
          error: null,
        }),
        update: () => {
          writes.push(`update:${table}`);
          return q;
        },
        insert: () => {
          writes.push(`insert:${table}`);
          return q;
        },
        upsert: () => {
          writes.push(`upsert:${table}`);
          return q;
        },
        then: (res: (v: unknown) => unknown) =>
          res({ data: table === "guest_arrival_status" ? statusRows : [], error: null }),
      });
      return q;
    },
  };
  return { db, writes };
}

describe("runAdvanceArrival — nunca reescreve uma etapa concluída", () => {
  it("clique da equipe depois da IA: devolve alreadyDone com quem/quando e não grava nada", async () => {
    const f = fakeDb([{ kind: "checkout", ...done() }]);
    const r = await runAdvanceArrival(
      f.db as never,
      { reservationId: "00000000-0000-4000-8000-000000000001", from: "checkout" },
      { origin: "staff", byUserId: "u1" },
    );
    expect(r).toEqual({
      ok: true,
      alreadyDone: true,
      doneAt: "2026-11-09T12:55:08Z",
      doneNote: "Confirmado pela IA a partir da mensagem do hóspede",
    });
    expect(f.writes).toEqual([]);
  });

  it("check-out pendente: grava normalmente", async () => {
    const f = fakeDb([{ kind: "checkout", ...pending }]);
    const r = await runAdvanceArrival(
      f.db as never,
      { reservationId: "00000000-0000-4000-8000-000000000001", from: "checkout" },
      { origin: "staff", byUserId: "u1" },
    );
    expect(r).toEqual({ ok: true });
    expect(f.writes.length).toBeGreaterThan(0);
  });
});
