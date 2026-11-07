/**
 * GATE G2c · escrita real das ações operacionais (banco e avanço do painel FALSOS; nada toca a produção).
 * Cobre: conclusão pelo avanço oficial com `origin: "ai"`; recusa do painel ⇒ `panel_refused` sem forçar;
 * saída antecipada conclui e SÓ DEPOIS puxa o card para hoje (recusa nunca troca a data); previsão gravada
 * com `guest_ai` por UPDATE condicional que nunca sobrescreve `staff` (inclusive em corrida); card inexistente
 * é criado; nunca lança. Auto-checkout ignora previsão `guest_ai`. Histórico da reserva mostra a IA.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { applyOpsAction } from "@/lib/guest-ai-ops-apply.server";

type Row = Record<string, unknown> & { reservation_id: string; kind: string };

/**
 * Banco falso com a semântica usada: `guest_arrival_status` (select/update condicional/insert),
 * `property_chat_messages` (leitura da mensagem da equipe) e `rpc` (caminho interno de late checkout).
 */
function fakeDb(
  rows: Row[] = [],
  opts: {
    failUpdate?: boolean;
    messages?: Array<Record<string, unknown>>;
    rpcError?: string;
  } = {},
) {
  const log: string[] = [];
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const table = (name: string) => {
    const source = (name === "property_chat_messages" ? (opts.messages ?? []) : rows) as Row[];
    const filters: Array<(r: Row) => boolean> = [];
    let op: { kind: "select" | "update"; patch?: Record<string, unknown> } = { kind: "select" };
    const run = () => {
      const match = source.filter((r) => filters.every((f) => f(r)));
      if (op.kind === "update") {
        if (opts.failUpdate) return { data: null, error: { message: "x" } };
        log.push(`update:${JSON.stringify(op.patch)}`);
        for (const r of match) Object.assign(r, op.patch);
        return { data: match.map(() => ({ id: "1" })), error: null };
      }
      return { data: match, error: null };
    };
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      or: (expr: string) => {
        // único uso: "arrival_time_source.is.null,arrival_time_source.neq.staff"
        expect(expr).toBe("arrival_time_source.is.null,arrival_time_source.neq.staff");
        filters.push(
          (r) => r["arrival_time_source"] == null || r["arrival_time_source"] !== "staff",
        );
        return q;
      },
      limit: () => q,
      maybeSingle: async () => ({ data: run().data?.[0] ?? null, error: null }),
      update: (patch: Record<string, unknown>) => ((op = { kind: "update", patch }), q),
      insert: (row: Row) => {
        log.push(`insert:${row.kind}`);
        const id = `new-${rows.length + 1}`;
        rows.push({ id, ...row });
        const done = { data: [{ id }], error: null };
        return {
          select: async () => done,
          then: (resolve: (v: unknown) => void) => resolve(done),
        };
      },
      then: (resolve: (v: unknown) => void) => resolve(run()),
    };
    return q;
  };
  const db = {
    from: (name: string) => table(name),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (opts.rpcError) return { error: { message: opts.rpcError } };
      const card = rows.find((r) => r["id"] === args["_arrival_status_id"]);
      if (card)
        Object.assign(card, {
          late_checkout_time: args["_time"],
          late_checkout_by: args["_actor"],
        });
      return { error: null };
    },
  };
  return { rows, log, rpcCalls, db };
}

const BASE = { propertyId: "p1", reservationId: "r1" };

describe("G2c · conclusão pelo avanço oficial do painel", () => {
  it("check-in e check-out: runAdvanceArrival com origin ai; foto do card depois", async () => {
    const f = fakeDb([{ reservation_id: "r1", kind: "checkin", status: "pending" }]);
    const advance = vi.fn(async () => {
      f.rows[0]!.status = "done";
    });
    const r = await applyOpsAction(
      { action: "checkin_done", ...BASE },
      { db: f.db, advance: advance as never },
    );
    expect(advance).toHaveBeenCalledWith(
      f.db,
      { reservationId: "r1", from: "checkin" },
      { origin: "ai" },
    );
    expect(r).toEqual({
      ok: true,
      cardAfter: { exists: true, reservation_id: "r1", kind: "checkin", status: "done" },
    });

    const g = fakeDb();
    const adv2 = vi.fn(async () => undefined);
    expect(
      (
        await applyOpsAction(
          { action: "checkout_done", ...BASE },
          { db: g.db, advance: adv2 as never },
        )
      ).ok,
    ).toBe(true);
    expect(adv2).toHaveBeenCalledWith(
      g.db,
      { reservationId: "r1", from: "checkout" },
      { origin: "ai" },
    );
  });

  it("travas do painel recusam ⇒ panel_refused, nada é forçado", async () => {
    const f = fakeDb();
    const advance = vi.fn(async () => Promise.reject(new Error("estadia anterior ainda aberta")));
    expect(
      await applyOpsAction(
        { action: "checkin_done", ...BASE },
        { db: f.db, advance: advance as never },
      ),
    ).toEqual({
      ok: false,
      code: "panel_refused",
    });
    expect(f.log).toEqual([]);
  });

  it("saída antecipada: conclui e só depois puxa o card de saída para hoje (data original registrada)", async () => {
    const f = fakeDb([{ reservation_id: "r1", kind: "checkout", status: "pending" }]);
    const order: string[] = [];
    const advance = vi.fn(async () => {
      order.push("advance");
      f.rows[0]!.status = "done";
    });
    const r = await applyOpsAction(
      { action: "early_departure", ...BASE, today: "2026-11-11", checkoutDate: "2026-11-13" },
      { db: f.db, advance: advance as never },
    );
    expect(advance).toHaveBeenCalledWith(
      f.db,
      { reservationId: "r1", from: "checkout" },
      { origin: "ai" },
    );
    expect(order).toEqual(["advance"]);
    expect(f.log).toEqual([
      'update:{"arrival_date_override":"2026-11-11","arrival_date_base":"2026-11-13"}',
    ]);
    expect(r).toMatchObject({
      ok: true,
      cardAfter: { status: "done", arrival_date_override: "2026-11-11" },
    });
  });

  it("saída antecipada recusada pelo painel ⇒ a data do card NÃO é trocada", async () => {
    const f = fakeDb([{ reservation_id: "r1", kind: "checkout", status: "pending" }]);
    const advance = vi.fn(async () => Promise.reject(new Error("x")));
    const r = await applyOpsAction(
      { action: "early_departure", ...BASE, today: "2026-11-11", checkoutDate: "2026-11-13" },
      { db: f.db, advance: advance as never },
    );
    expect(r).toEqual({ ok: false, code: "panel_refused" });
    expect(f.rows[0]!.arrival_date_override).toBeUndefined();
  });
});

describe("G2c · previsão com origem guest_ai", () => {
  it("grava sobre previsão do hóspede (guia) ou da própria IA — vale a mais recente", async () => {
    for (const source of [null, "guest", "guest_ai"]) {
      const f = fakeDb([
        {
          reservation_id: "r1",
          kind: "checkin",
          arrival_time_override: "14:00",
          arrival_time_source: source,
        },
      ]);
      const r = await applyOpsAction(
        { action: "eta_checkin", ...BASE, time: "16:30" },
        { db: f.db },
      );
      expect(r, String(source)).toMatchObject({
        ok: true,
        cardAfter: { arrival_time_override: "16:30", arrival_time_source: "guest_ai" },
      });
    }
  });

  it("previsão da equipe (staff) nunca é sobrescrita ⇒ staff_prediction_race", async () => {
    const f = fakeDb([
      {
        reservation_id: "r1",
        kind: "checkout",
        arrival_time_override: "09:00",
        arrival_time_source: "staff",
      },
    ]);
    expect(
      await applyOpsAction({ action: "eta_checkout", ...BASE, time: "08:00" }, { db: f.db }),
    ).toEqual({
      ok: false,
      code: "staff_prediction_race",
    });
    expect(f.rows[0]).toMatchObject({
      arrival_time_override: "09:00",
      arrival_time_source: "staff",
    });
  });

  it("sem card ainda ⇒ cria o card da reserva com a previsão", async () => {
    const f = fakeDb();
    const r = await applyOpsAction(
      { action: "eta_checkout", ...BASE, time: "08:00" },
      { db: f.db },
    );
    expect(f.log).toContain("insert:checkout");
    expect(r).toMatchObject({
      ok: true,
      cardAfter: {
        kind: "checkout",
        arrival_time_override: "08:00",
        arrival_time_source: "guest_ai",
        property_id: "p1",
      },
    });
  });

  it("erro de banco ⇒ apply_failed; nunca lança", async () => {
    const f = fakeDb([], { failUpdate: true });
    expect(
      await applyOpsAction({ action: "eta_checkin", ...BASE, time: "16:30" }, { db: f.db }),
    ).toEqual({ ok: false, code: "apply_failed" });
  });
});

describe("G2c · late checkout concedido pela equipe (em nome do atendente)", () => {
  const STAFF = "a3000000-0000-4000-8000-000000000003";
  const LC = { ...BASE, conversationId: "c1", staffMessageId: "m1", time: "13:00" } as const;
  const msg = (over: Record<string, unknown> = {}) => ({
    id: "m1",
    conversation_id: "c1",
    sender_user_id: STAFF,
    sender_type: "human",
    role: "assistant",
    is_internal_note: false,
    ...over,
  });
  const card = () => ({ id: "g1", reservation_id: "r1", kind: "checkout", status: "pending" });

  it("grava no card de saída com autoria do remetente da mensagem", async () => {
    const f = fakeDb([card()], { messages: [msg()] });
    const r = await applyOpsAction({ action: "late_checkout", ...LC }, { db: f.db });
    expect(f.rpcCalls).toEqual([
      {
        fn: "internal_set_late_checkout",
        args: { _arrival_status_id: "g1", _actor: STAFF, _time: "13:00" },
      },
    ]);
    expect(r).toMatchObject({
      ok: true,
      cardAfter: { exists: true, late_checkout_time: "13:00", late_checkout_by: STAFF },
    });
  });

  it("sem card de saída: cria o card e grava", async () => {
    const f = fakeDb([], { messages: [msg()] });
    const r = await applyOpsAction({ action: "late_checkout", ...LC }, { db: f.db });
    expect(f.log).toEqual(["insert:checkout"]);
    expect(f.rpcCalls).toHaveLength(1);
    expect(r.ok).toBe(true);
  });

  it("mensagem que não é de atendente humano identificado ⇒ staff_author_unknown, nada gravado", async () => {
    for (const over of [
      { sender_user_id: null },
      { sender_type: "ai" },
      { sender_type: "guest", role: "user" },
      { is_internal_note: true },
      { conversation_id: "outra" },
    ]) {
      const f = fakeDb([card()], { messages: [msg(over)] });
      expect(await applyOpsAction({ action: "late_checkout", ...LC }, { db: f.db })).toEqual({
        ok: false,
        code: "staff_author_unknown",
      });
      expect(f.rpcCalls).toEqual([]);
    }
  });

  it("recusas do banco viram códigos fechados", async () => {
    const cases: Array<[string, string]> = [
      ["late_checkout_forbidden", "staff_not_authorized"],
      ["late_checkout_must_be_after_official", "late_checkout_rejected"],
      ["boom", "apply_failed"],
    ];
    for (const [err, code] of cases) {
      const f = fakeDb([card()], { messages: [msg()], rpcError: err });
      expect(await applyOpsAction({ action: "late_checkout", ...LC }, { db: f.db })).toEqual({
        ok: false,
        code,
      });
    }
  });
});

describe("G2c · origem 'ai' no painel e no histórico da reserva", () => {
  const read = (p: string) => readFileSync(path.resolve(__dirname, "..", p), "utf8");
  it("o avanço do painel grava a nota da IA; o histórico a reconhece (conclusão e previsão)", () => {
    const dash = read("dashboard.functions.ts");
    expect(dash).toMatch(/origin\?: "guest" \| "staff" \| "system" \| "ai"/);
    expect(dash).toMatch(/"Confirmado pela IA a partir da mensagem do hóspede"/);
    expect(/pela IA/i.test("Confirmado pela IA a partir da mensagem do hóspede")).toBe(true);
    expect(/pelo h[óo]spede/i.test("Confirmado pela IA a partir da mensagem do hóspede")).toBe(
      false,
    );
    const journey = read("reservation-journey.functions.ts");
    expect(journey).toMatch(/if \(\/pela IA\/i\.test\(note\)\) return AI;/);
    expect(journey).toMatch(/pr\.arrival_time_source === "guest_ai"/);
  });
  it("o painel trata a previsão guest_ai como informada pelo hóspede", () => {
    const ws = readFileSync(
      path.resolve(__dirname, "../../components/dashboard/OperationWorkspace.tsx"),
      "utf8",
    );
    expect(ws).toMatch(
      /own\?\.arrivalTimeSource === "guest" \|\| own\?\.arrivalTimeSource === "guest_ai"/,
    );
  });
});
