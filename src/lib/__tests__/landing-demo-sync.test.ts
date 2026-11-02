import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Vitrine da landing (02/11/2026): a cópia só é regravada quando o guia oficial
 * mudou. Antes, cada sincronização apagava e reinseria ~10 tabelas.
 */

vi.mock("@/lib/admin-users.server", () => ({
  findAuthUserByEmail: async () => ({ id: "demo-owner" }),
}));

type Row = Record<string, unknown>;
let db: Record<string, Row[]> = {};
let writes: Array<{ op: string; table: string }> = [];

function builder(table: string) {
  let op: "select" | "update" | "insert" | "delete" = "select";
  let payload: Row | Row[] = {};
  const filters: Array<(r: Row) => boolean> = [];
  let single = false;
  const run = () => {
    const rows = db[table] ?? (db[table] = []);
    if (op === "insert") {
      writes.push({ op, table });
      const list = Array.isArray(payload) ? payload : [payload];
      const added = list.map((p, i) => ({ id: `${table}-${rows.length + i + 1}`, ...p }));
      rows.push(...added);
      return { data: single ? added[0] : added, error: null };
    }
    const hit = rows.filter((r) => filters.every((f) => f(r)));
    if (op === "update") {
      writes.push({ op, table });
      hit.forEach((r) => Object.assign(r, payload));
    }
    if (op === "delete") {
      writes.push({ op, table });
      db[table] = rows.filter((r) => !hit.includes(r));
    }
    return { data: single ? (hit[0] ?? null) : hit, error: null };
  };
  const b: any = {
    select: () => b,
    update: (p: Row) => ((op = "update"), (payload = p), b),
    insert: (p: Row | Row[]) => ((op = "insert"), (payload = p), b),
    delete: () => ((op = "delete"), b),
    eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
    maybeSingle: () => ((single = true), b),
    single: () => ((single = true), b),
    then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
  };
  return b;
}
const admin = { from: (t: string) => builder(t) } as never;

function seed() {
  db = {
    properties: [
      { id: "src", slug: "charmosa", owner_id: "o1", name: "Casa Charmosa", city: "Foz", state: "PR", lat: -25.51234, lng: -54.58765, wifi_password: "segredo1" },
    ],
    property_faqs: [{ id: "f1", property_id: "src", question: "Tem garagem?", answer: "Sim", tags: ["x"] }],
    property_daily_tips: [{ id: "t1", property_id: "src", date: "2026-11-02", tip: "Leve guarda-chuva" }],
  };
  writes = [];
}

describe("sincronização da vitrine da landing", () => {
  beforeEach(() => {
    vi.resetModules();
    seed();
  });

  it("primeira sincronização cria a cópia; a seguinte, sem mudança na origem, não grava nada", async () => {
    const mod = await import("@/lib/landing-demo.server");
    await mod.ensureLandingCopy(admin);
    expect(writes.some((w) => w.op === "insert" && w.table === "properties")).toBe(true);
    expect(db.property_faqs.filter((r) => r.property_id !== "src")).toHaveLength(1);

    // nova instância do módulo = intervalo de 2 min vencido
    vi.resetModules();
    writes = [];
    const again = await import("@/lib/landing-demo.server");
    await again.ensureLandingCopy(admin);
    expect(writes).toEqual([]);
  });

  it("quando uma tabela muda na origem, só ela é regravada", async () => {
    const mod = await import("@/lib/landing-demo.server");
    await mod.ensureLandingCopy(admin);
    db.property_faqs.find((r) => r.id === "f1")!.answer = "Sim, coberta";

    vi.resetModules();
    writes = [];
    const again = await import("@/lib/landing-demo.server");
    await again.ensureLandingCopy(admin);
    expect(writes.map((w) => `${w.op}:${w.table}`).sort()).toEqual(["delete:property_faqs", "insert:property_faqs"]);
    const copy = db.property_faqs.find((r) => r.property_id !== "src")!;
    expect(copy.answer).toBe("Sim, coberta");
  });

  it("segredos continuam trocados por fictícios na cópia", async () => {
    const mod = await import("@/lib/landing-demo.server");
    await mod.ensureLandingCopy(admin);
    const copy = db.properties.find((r) => r.slug === "vitrine-casa-charmosa")!;
    expect(copy.wifi_password).toBe("demo-2026");
    expect(copy.owner_id).toBe("demo-owner");
  });
});
