import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, any>;
let rows: Row[] = [];
let channexNights = new Set<string>();
let channexFails = false;
let pushThrows = false;

/** Banco em memória com o mínimo do encadeamento do supabase usado por manual-blocks.server. */
function makeBuilder() {
  let op: "select" | "insert" | "update" = "select";
  let payload: Row = {};
  const filters: Array<(r: Row) => boolean> = [];
  let single = false;
  const b: any = {
    select: () => b,
    insert: (p: Row) => ((op = "insert"), (payload = p), b),
    update: (p: Row) => ((op = "update"), (payload = p), b),
    eq: (k: string, v: any) => (filters.push((r) => r[k] === v), b),
    lt: (k: string, v: any) => (filters.push((r) => r[k] < v), b),
    gt: (k: string, v: any) => (filters.push((r) => r[k] > v), b),
    lte: (k: string, v: any) => (filters.push((r) => r[k] <= v), b),
    gte: (k: string, v: any) => (filters.push((r) => r[k] >= v), b),
    in: (k: string, v: any[]) => (filters.push((r) => v.includes(r[k])), b),
    single: () => ((single = true), b),
    then: (res: any, rej: any) => {
      try {
        if (op === "insert") {
          const row = { id: `id-${rows.length + 1}`, ...payload };
          rows.push(row);
          return Promise.resolve({ data: single ? { id: row.id } : [row], error: null }).then(res, rej);
        }
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        if (op === "update") hit.forEach((r) => Object.assign(r, payload));
        return Promise.resolve({ data: hit, error: null }).then(res, rej);
      } catch (e) {
        return Promise.reject(e).then(res, rej);
      }
    },
  };
  return b;
}

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: () => makeBuilder() } }));
vi.mock("@/lib/channex-mapping.server", () => ({
  channexBookedNights: async () => {
    if (channexFails) throw new Error("channex fora do ar");
    return channexNights;
  },
  allSyncTargets: async () => {
    if (pushThrows) throw new Error("falha no envio");
    return [];
  },
  syncRealAvailability: async () => ({ ok: true }),
}));
vi.mock("@/lib/channex-ari.server", () => ({ flushAriOutbox: async () => ({ batches: [] }) }));

const P = "11111111-1111-4111-8111-111111111111";
const future = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

beforeEach(() => {
  rows = [];
  channexNights = new Set();
  channexFails = false;
  pushThrows = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

async function create(from: string, to: string, note: string | null = null) {
  const { createManualBlock } = await import("@/lib/manual-blocks.server");
  return createManualBlock({ propertyId: P, from, to, note, userId: null });
}
const stay = (a: string, b: string, extra: Row = {}) => ({ id: `s-${a}`, property_id: P, source: "channex", status: "confirmed", checkin_date: a, checkout_date: b, ...extra });

describe("createManualBlock (servidor)", () => {
  it("bloqueia noites livres", async () => {
    const r = await create(future(5), future(8));
    expect(r).toMatchObject({ merged: false });
    expect(rows.filter((x) => x.status === "blocked")).toHaveLength(1);
  });

  it("recusa quando uma reserva ativa está no meio", async () => {
    rows.push(stay(future(6), future(9)));
    await expect(create(future(5), future(8))).rejects.toThrow(/já tem reserva ativa/);
    expect(rows.filter((x) => x.status === "blocked")).toHaveLength(0);
  });

  it("dia de saída e de entrada de outras reservas não conflitam (giro)", async () => {
    rows.push(stay(future(2), future(5)), stay(future(8), future(10)));
    await expect(create(future(5), future(8))).resolves.toBeTruthy();
  });

  it("reserva cancelada ou iCal 'Not available' não trava", async () => {
    rows.push(stay(future(6), future(7), { status: "cancelled" }), stay(future(6), future(7), { source: "airbnb", status: "blocked" }));
    await expect(create(future(5), future(8))).resolves.toBeTruthy();
  });

  it("reserva que só existe na Channex (gêmeo) também trava", async () => {
    channexNights = new Set([future(6)]);
    await expect(create(future(5), future(8))).rejects.toThrow(/já tem reserva ativa/);
  });

  it("Channex fora do ar: vale a checagem do banco", async () => {
    channexFails = true;
    await expect(create(future(5), future(8))).resolves.toBeTruthy();
    rows.length = 0;
    channexFails = true;
    rows.push(stay(future(6), future(9)));
    await expect(create(future(5), future(8))).rejects.toThrow(/já tem reserva ativa/);
  });

  it("rejeita passado e intervalo invertido", async () => {
    await expect(create("2020-01-01", "2020-01-03")).rejects.toThrow(/a partir de hoje/);
    await expect(create(future(5), future(5))).rejects.toThrow(/depois da inicial/);
  });

  it("não duplica quando já existe bloqueio cobrindo", async () => {
    await create(future(4), future(12));
    const r = await create(future(6), future(9));
    expect(r.merged).toBe(true);
    expect(rows.filter((x) => x.status === "blocked")).toHaveLength(1);
  });

  it("une bloqueios que encostam em um só e cancela os absorvidos", async () => {
    await create(future(4), future(6));
    await create(future(8), future(10));
    await create(future(6), future(8));
    const live = rows.filter((x) => x.status === "blocked");
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ checkin_date: future(4), checkout_date: future(10) });
    expect(rows.filter((x) => x.status === "cancelled")).toHaveLength(2);
  });

  it("falha no envio aos anúncios não vira erro: o bloqueio fica salvo com ok:false", async () => {
    // Imóvel com anúncio conectado, mas o envio quebra.
    vi.resetModules();
    pushThrows = true;
    const { createManualBlock } = await import("@/lib/manual-blocks.server");
    const r = await createManualBlock({ propertyId: P, from: future(5), to: future(8), userId: null });
    expect(r).toMatchObject({ connected: true, ok: false });
    expect(rows.filter((x) => x.status === "blocked")).toHaveLength(1);
  });

  it("push:false grava e devolve na hora, sem tocar nos anúncios (envio vem depois)", async () => {
    pushThrows = true; // se tentasse enviar, o envio quebraria
    const { createManualBlock } = await import("@/lib/manual-blocks.server");
    const r = await createManualBlock({ propertyId: P, from: future(5), to: future(8), userId: null, push: false });
    expect(r).toMatchObject({ merged: false });
    expect(r).not.toHaveProperty("connected");
    expect(rows.filter((x) => x.source === "manual" && x.status === "blocked")).toHaveLength(1);
  });

  it("push:false também vale ao liberar", async () => {
    const { createManualBlock, removeManualBlock } = await import("@/lib/manual-blocks.server");
    const c = await createManualBlock({ propertyId: P, from: future(5), to: future(8), userId: null, push: false });
    pushThrows = true;
    const r = await removeManualBlock({ id: c.id, propertyId: P, userId: null, push: false });
    expect(r).toEqual({});
    expect(rows.find((x) => x.id === c.id)?.status).toBe("cancelled");
  });
});

describe("updateManualBlock (servidor) — alterar período e motivo", () => {
  async function update(id: string, from: string, to: string, note: string | null = null) {
    const { updateManualBlock } = await import("@/lib/manual-blocks.server");
    return updateManualBlock({ id, propertyId: P, from, to, note, userId: null, push: false });
  }
  async function seed(from: string, to: string) {
    const { createManualBlock } = await import("@/lib/manual-blocks.server");
    return (await createManualBlock({ propertyId: P, from, to, userId: null, push: false })).id as string;
  }

  it("muda período e motivo do próprio bloqueio (mesmo id)", async () => {
    const id = await seed(future(5), future(8));
    const r = await update(id, future(6), future(10), "manutenção");
    expect(r).toMatchObject({ id, merged: false });
    expect(rows.find((x) => x.id === id)).toMatchObject({ checkin_date: future(6), checkout_date: future(10), raw_summary: "manutenção", status: "blocked", source: "manual" });
  });

  it("recusa estender por cima de reserva ativa e não mexe no bloqueio", async () => {
    const id = await seed(future(5), future(8));
    rows.push(stay(future(9), future(12)));
    await expect(update(id, future(5), future(11))).rejects.toThrow(/já tem reserva ativa/);
    expect(rows.find((x) => x.id === id)).toMatchObject({ checkin_date: future(5), checkout_date: future(8) });
  });

  it("recusa quando a reserva só existe na Channex (gêmeo)", async () => {
    const id = await seed(future(5), future(8));
    channexNights = new Set([future(9)]);
    await expect(update(id, future(5), future(11))).rejects.toThrow(/já tem reserva ativa/);
    expect(rows.find((x) => x.id === id)).toMatchObject({ checkout_date: future(8) });
  });

  it("dia de saída/entrada de reservas vizinhas não conflita (giro)", async () => {
    const id = await seed(future(5), future(8));
    rows.push(stay(future(2), future(4)), stay(future(10), future(12)));
    await expect(update(id, future(4), future(10))).resolves.toMatchObject({ id });
  });

  it("encurtar um bloqueio em andamento (início no passado inalterado) é permitido", async () => {
    rows.push({ id: "old", property_id: P, source: "manual", status: "blocked", checkin_date: future(-2), checkout_date: future(6), raw_summary: "Bloqueio manual" });
    await expect(update("old", future(-2), future(3))).resolves.toMatchObject({ id: "old" });
    expect(rows.find((x) => x.id === "old")?.checkout_date).toBe(future(3));
  });

  it("início NOVO no passado continua proibido", async () => {
    const id = await seed(future(5), future(8));
    await expect(update(id, "2020-01-01", future(8))).rejects.toThrow(/a partir de hoje/);
  });

  it("une com bloqueio vizinho e cancela o absorvido", async () => {
    const id = await seed(future(4), future(6));
    const other = await seed(future(9), future(11));
    const r = await update(id, future(4), future(9));
    expect(r).toMatchObject({ id, merged: true });
    expect(rows.find((x) => x.id === id)).toMatchObject({ checkin_date: future(4), checkout_date: future(11) });
    expect(rows.find((x) => x.id === other)?.status).toBe("cancelled");
  });

  it("nunca altera reserva de hóspede nem bloqueio já liberado", async () => {
    rows.push(stay(future(5), future(8), { id: "res-1" }));
    await expect(update("res-1", future(6), future(9))).rejects.toThrow(/não existe mais/);
    expect(rows.find((x) => x.id === "res-1")).toMatchObject({ checkin_date: future(5), checkout_date: future(8), status: "confirmed" });
    const id = await seed(future(12), future(14));
    const { removeManualBlock } = await import("@/lib/manual-blocks.server");
    await removeManualBlock({ id, propertyId: P, userId: null, push: false });
    await expect(update(id, future(12), future(15))).rejects.toThrow(/não existe mais/);
  });

  it("removeManualBlock não libera reserva confirmada", async () => {
    rows.push(stay(future(5), future(8), { id: "res-2" }));
    const { removeManualBlock } = await import("@/lib/manual-blocks.server");
    await removeManualBlock({ id: "res-2", propertyId: P, userId: null, push: false });
    expect(rows.find((x) => x.id === "res-2")?.status).toBe("confirmed");
  });
});

