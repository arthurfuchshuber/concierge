/**
 * Auto-checkout (titular, 08/11/2026 — gatilho da previsão de volta): a baixa automática do card de SAÍDA
 * acontece no dia da saída confirmada, ao atingir o horário PREVISTO no card (equipe antecipa ou estende;
 * hóspede/IA só antecipam, nunca passam do corte) ou, sem previsão, o horário oficial — ou o late checkout
 * FORMALMENTE autorizado (R6), que é teto de qualquer previsão. Data prevista não muda o DIA. Check-in nunca é
 * automático.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rowsRef: { rows: Array<Record<string, unknown>> } = { rows: [] };
const advance = vi.fn(async () => undefined);
vi.mock("@/lib/arrival-board.server", () => ({
  buildArrivalRows: vi.fn(async () => ({ rows: rowsRef.rows })),
}));
vi.mock("@/lib/dashboard.functions", () => ({ runAdvanceArrival: advance }));
const batch = vi.fn(async (..._a: unknown[]) => ({ notifications: 1 }));
vi.mock("@/lib/ops-push.server", () => ({ notifyAutoCheckoutBatch: batch }));

const { autoCheckoutTriggerTime, autoCheckoutDay, runAutoCheckoutScan } =
  await import("@/lib/auto-checkout.server");

const P = "b1000000-0000-4000-8000-000000000001";
const R = "f1000000-0000-4000-8000-000000000001";
const STAFF = "a3000000-0000-4000-8000-000000000003";

function fakeAdmin(late: Array<Record<string, unknown>> = [], failLate = false) {
  return {
    from(table: string) {
      if (table === "properties")
        return {
          select: async () => ({
            data: [{ id: P, city: "São Paulo", country: "Brasil" }],
            error: null,
          }),
        };
      const q = {
        select: () => q,
        eq: () => q,
        not: () => q,
        in: async () =>
          failLate ? { data: null, error: { message: "x" } } : { data: late, error: null },
      };
      return q;
    },
  } as never;
}

const row = (over: Record<string, unknown> = {}) => ({
  logId: `ical:${R}`,
  reservationId: R,
  propertyId: P,
  status: "pending",
  date: "2026-11-10",
  guestCheckout: "2026-11-10",
  standardTime: "11:00",
  arrivalTimeOverride: null,
  arrivalTimeSource: null,
  arrivalDateOverride: null,
  ...over,
});
// 2026-11-10 em São Paulo (UTC-3)
const at = (hm: string, day = "2026-11-10") => new Date(`${day}T${hm}:00-03:00`);

beforeEach(() => {
  advance.mockClear();
  batch.mockReset();
  batch.mockImplementation(async () => ({ notifications: 1 }));
  rowsRef.rows = [];
});

describe("autoCheckoutTriggerTime / autoCheckoutDay (puras)", () => {
  it("corte = horário oficial; late checkout só com os três campos da autorização formal", () => {
    expect(autoCheckoutTriggerTime({ standardTime: "11:00" })).toEqual([11, 0]);
    expect(
      autoCheckoutTriggerTime({
        standardTime: "11:00",
        lateCheckout: { time: "13:00", approvedAt: "2026-11-09T10:00:00Z", by: STAFF },
      }),
    ).toEqual([13, 0]);
    // sem autor ou sem momento de aprovação: não é autorização (vale o oficial)
    expect(
      autoCheckoutTriggerTime({
        standardTime: "11:00",
        lateCheckout: { time: "13:00", approvedAt: null, by: STAFF },
      }),
    ).toEqual([11, 0]);
    expect(
      autoCheckoutTriggerTime({
        standardTime: "11:00",
        lateCheckout: { time: "13:00", approvedAt: "2026-11-09T10:00:00Z", by: null },
      }),
    ).toEqual([11, 0]);
    expect(autoCheckoutTriggerTime({ standardTime: null })).toBeNull();
  });

  it("previsão da EQUIPE vale como está: estende ou antecipa", () => {
    const base = { standardTime: "11:00" };
    expect(autoCheckoutTriggerTime({ ...base, arrivalTimeOverride: "13:00", arrivalTimeSource: "staff" })).toEqual([13, 0]);
    expect(autoCheckoutTriggerTime({ ...base, arrivalTimeOverride: "09:00", arrivalTimeSource: "staff" })).toEqual([9, 0]);
    expect(autoCheckoutTriggerTime({ ...base, arrivalTimeOverride: "11:00", arrivalTimeSource: "staff" })).toEqual([11, 0]);
  });

  it("previsão do hóspede/IA só antecipa (nunca passa do corte); late checkout formal é teto de tudo", () => {
    for (const src of ["guest", "guest_ai", null]) {
      expect(autoCheckoutTriggerTime({ standardTime: "11:00", arrivalTimeOverride: "09:00", arrivalTimeSource: src })).toEqual([9, 0]);
      expect(autoCheckoutTriggerTime({ standardTime: "11:00", arrivalTimeOverride: "14:00", arrivalTimeSource: src })).toEqual([11, 0]);
    }
    const formal = { time: "12:30", approvedAt: "2026-11-09T10:00:00Z", by: STAFF };
    expect(autoCheckoutTriggerTime({ standardTime: "11:00", arrivalTimeOverride: "14:00", arrivalTimeSource: "staff", lateCheckout: formal })).toEqual([12, 30]);
    expect(autoCheckoutTriggerTime({ standardTime: "11:00", arrivalTimeOverride: "10:00", arrivalTimeSource: "guest_ai", lateCheckout: formal })).toEqual([10, 0]);
    expect(autoCheckoutTriggerTime({ standardTime: "11:00", arrivalTimeOverride: "13:00", arrivalTimeSource: "guest", lateCheckout: formal })).toEqual([12, 30]);
    // sem horário oficial nem previsão: confirmação continua manual
    expect(autoCheckoutTriggerTime({ standardTime: null })).toBeNull();
  });

  it("dia do corte = saída CONFIRMADA da reserva, nunca a data prevista do card", () => {
    expect(autoCheckoutDay({ guestCheckout: "2026-11-10", date: "2026-11-08" })).toBe("2026-11-10");
    expect(autoCheckoutDay({ guestCheckout: null, date: "2026-11-08" })).toBe("2026-11-08");
  });
});

describe("runAutoCheckoutScan", () => {
  it("previsão de qualquer origem antes do oficial dá baixa NO HORÁRIO PREVISTO (caso real: 'vamos sair por volta das 9:00')", async () => {
    for (const src of ["staff", "guest", "guest_ai"]) {
      advance.mockClear();
      rowsRef.rows = [row({ arrivalTimeOverride: "09:00", arrivalTimeSource: src })];
      expect((await runAutoCheckoutScan(fakeAdmin(), at("08:55"))).confirmed, src).toBe(0);
      expect((await runAutoCheckoutScan(fakeAdmin(), at("09:00"))).confirmed, src).toBe(1);
      expect(advance).toHaveBeenCalledWith(
        expect.anything(),
        { reservationId: R, from: "checkout" },
        { origin: "system" },
      );
    }
  });

  it("previsão de HÓSPEDE/IA depois do oficial não segura o corte", async () => {
    for (const src of ["guest", "guest_ai"]) {
      advance.mockClear();
      rowsRef.rows = [row({ arrivalTimeOverride: "15:00", arrivalTimeSource: src })];
      expect((await runAutoCheckoutScan(fakeAdmin(), at("11:05"))).confirmed, src).toBe(1);
    }
  });

  it("saída estendida pela EQUIPE para 13:00: sem baixa às 11:00/12:00; baixa às 13:00", async () => {
    rowsRef.rows = [row({ arrivalTimeOverride: "13:00", arrivalTimeSource: "staff" })];
    expect((await runAutoCheckoutScan(fakeAdmin(), at("11:00"))).confirmed).toBe(0);
    expect((await runAutoCheckoutScan(fakeAdmin(), at("12:55"))).confirmed).toBe(0);
    expect(advance).not.toHaveBeenCalled();
    expect((await runAutoCheckoutScan(fakeAdmin(), at("13:00"))).confirmed).toBe(1);
  });

  it("late checkout formal: corte no horário autorizado; incompleto não estende", async () => {
    const formal = [
      {
        reservation_id: R,
        log_id: null,
        late_checkout_time: "13:00",
        late_checkout_approved_at: "2026-11-09T10:00:00Z",
        late_checkout_by: STAFF,
      },
    ];
    rowsRef.rows = [row()];
    expect((await runAutoCheckoutScan(fakeAdmin(formal), at("12:00"))).confirmed).toBe(0);
    expect((await runAutoCheckoutScan(fakeAdmin(formal), at("13:00"))).confirmed).toBe(1);
    const semAutor = [{ ...formal[0], late_checkout_by: null }];
    advance.mockClear();
    expect((await runAutoCheckoutScan(fakeAdmin(semAutor), at("11:30"))).confirmed).toBe(1);
  });

  it("data prevista anterior (saída antecipada só prevista) não antecipa a baixa", async () => {
    rowsRef.rows = [row({ date: "2026-11-08", arrivalDateOverride: "2026-11-08" })];
    expect((await runAutoCheckoutScan(fakeAdmin(), at("12:00", "2026-11-08"))).confirmed).toBe(0);
    expect((await runAutoCheckoutScan(fakeAdmin(), at("11:00", "2026-11-10"))).confirmed).toBe(1);
  });

  it("fora do dia da saída nada acontece; falha ao ler autorizações ⇒ nada nesta rodada", async () => {
    rowsRef.rows = [row()];
    expect((await runAutoCheckoutScan(fakeAdmin(), at("12:00", "2026-11-11"))).confirmed).toBe(0);
    expect((await runAutoCheckoutScan(fakeAdmin([], true), at("12:00"))).confirmed).toBe(0);
    expect(advance).not.toHaveBeenCalled();
  });
});

describe("aviso em massa da baixa automática (08/11/2026)", () => {
  const P2 = "b1000000-0000-4000-8000-000000000002";
  const R2 = "f1000000-0000-4000-8000-000000000002";

  it("um único aviso por rodada com todos os imóveis liberados — nunca um por imóvel", async () => {
    rowsRef.rows = [row(), row({ logId: `ical:${R2}`, reservationId: R2, propertyId: P2 })];
    const r = await runAutoCheckoutScan(fakeAdmin(), at("11:00"));
    expect(r.confirmed).toBe(2);
    expect(batch).toHaveBeenCalledTimes(1);
    const [, opts] = batch.mock.calls[0] as [unknown, { propertyIds: string[]; runKey: string }];
    expect(opts.propertyIds.sort()).toEqual([P, P2].sort());
    expect(opts.runKey).toBe(at("11:00").toISOString().slice(0, 16));
  });

  it("sem baixa na rodada → nenhum aviso", async () => {
    rowsRef.rows = [row()];
    await runAutoCheckoutScan(fakeAdmin(), at("09:00"));
    expect(batch).not.toHaveBeenCalled();
  });

  it("baixa que falhou não entra no aviso", async () => {
    rowsRef.rows = [row(), row({ logId: `ical:${R2}`, reservationId: R2, propertyId: P2 })];
    advance.mockImplementationOnce(async () => {
      throw new Error("boom");
    });
    const r = await runAutoCheckoutScan(fakeAdmin(), at("11:00"));
    expect(r.confirmed).toBe(1);
    const [, opts] = batch.mock.calls[0] as [unknown, { propertyIds: string[] }];
    expect(opts.propertyIds).toEqual([P2]);
  });

  it("falha no aviso nunca desfaz nem quebra as baixas", async () => {
    rowsRef.rows = [row()];
    batch.mockImplementation(async () => {
      throw new Error("push fora");
    });
    const r = await runAutoCheckoutScan(fakeAdmin(), at("11:00"));
    expect(r.confirmed).toBe(1);
  });
});
