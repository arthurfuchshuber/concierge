/**
 * Auto-checkout (diretriz definitiva de 06/11/2026, Gate G2c): a baixa automática do card de SAÍDA acontece só
 * no dia da saída confirmada, ao atingir o horário oficial de checkout do imóvel — ou o late checkout
 * FORMALMENTE autorizado pela equipe (R6: horário + aprovado_em + aprovado_por). Horário previsto (equipe,
 * hóspede no guia ou IA) e data prevista NUNCA dão baixa. Check-in nunca é automático.
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

  it("previsão nunca entra no cálculo (nem campo existe na assinatura)", () => {
    const src = readFileSync(
      path.resolve(__dirname, "..", "auto-checkout.server.ts"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(src).not.toMatch(
      /arrivalTimeOverride|arrivalDateOverride|arrivalTimeSource|guestArrivalTime/,
    );
    expect(src).not.toMatch(/from:\s*"checkin"/);
  });

  it("dia do corte = saída CONFIRMADA da reserva, nunca a data prevista do card", () => {
    expect(autoCheckoutDay({ guestCheckout: "2026-11-10", date: "2026-11-08" })).toBe("2026-11-10");
    expect(autoCheckoutDay({ guestCheckout: null, date: "2026-11-08" })).toBe("2026-11-08");
  });
});

describe("runAutoCheckoutScan", () => {
  it("previsão de qualquer origem antes do oficial NÃO dá baixa; no oficial dá", async () => {
    for (const src of ["staff", "guest", "guest_ai"]) {
      rowsRef.rows = [row({ arrivalTimeOverride: "08:00", arrivalTimeSource: src })];
      expect((await runAutoCheckoutScan(fakeAdmin(), at("09:00"))).confirmed, src).toBe(0);
    }
    expect(advance).not.toHaveBeenCalled();
    rowsRef.rows = [row({ arrivalTimeOverride: "08:00", arrivalTimeSource: "staff" })];
    expect((await runAutoCheckoutScan(fakeAdmin(), at("11:00"))).confirmed).toBe(1);
    expect(advance).toHaveBeenCalledWith(
      expect.anything(),
      { reservationId: R, from: "checkout" },
      { origin: "system" },
    );
  });

  it("previsão DEPOIS do oficial não segura o corte (só late checkout formal estende)", async () => {
    rowsRef.rows = [row({ arrivalTimeOverride: "15:00", arrivalTimeSource: "guest" })];
    expect((await runAutoCheckoutScan(fakeAdmin(), at("11:05"))).confirmed).toBe(1);
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
