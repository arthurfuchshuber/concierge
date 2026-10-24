import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => {
  const make = () => {
    const b: Record<string, unknown> = {};
    b.middleware = () => b;
    b.inputValidator = (v: (i: unknown) => unknown) => ((b.validator = v), b);
    b.handler = (h: (a: unknown) => unknown) => async (input: { data: unknown }) =>
      h({ data: (b.validator as (i: unknown) => unknown)(input.data), context: ctx });
    return b;
  };
  return { createServerFn: () => make() };
});
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
const reindex = vi.fn(async () => ({ indexed: 0 }));
vi.mock("@/lib/ai/indexing.server", () => ({ reindexProperty: reindex }));
const audit = vi.fn(async () => undefined);
vi.mock("@/lib/permissions/permission.repository.server", () => ({ recordAudit: audit }));
vi.mock("@/lib/db-errors.server", () => ({
  safeDbError: (_c: string, e: { message?: string }) => new Error(e?.message ?? "erro"),
  retryDbResult: async (op: () => unknown) => op(),
}));

type Op = { table: string; op: string; args: any[]; filters: Array<[string, unknown]> };
let ops: Op[] = [];
let tables: Record<string, any[]> = {};
let denied = new Set<string>();

function from(table: string) {
  const rec: Op = { table, op: "select", args: [], filters: [] };
  ops.push(rec);
  const b: any = {};
  for (const m of ["select", "update", "delete", "insert", "upsert"]) {
    b[m] = (...a: unknown[]) => {
      if (m === "select" && rec.op !== "select") return b;
      rec.op = m;
      rec.args = a;
      return b;
    };
  }
  for (const m of ["eq", "in", "like"]) b[m] = (k: string, v: unknown) => (rec.filters.push([k, v]), b);
  b.order = () => b;
  const rows = () => {
    if (rec.op !== "select") return [];
    let r = [...(tables[table] ?? [])];
    for (const [k, v] of rec.filters) {
      if (Array.isArray(v)) r = r.filter((x) => v.includes(x[k]));
      else if (typeof v === "string" && v.endsWith("%")) r = r.filter((x) => String(x[k]).startsWith(v.slice(0, -1)));
      else r = r.filter((x) => x[k] === v);
    }
    return r;
  };
  b.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
  b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(res);
  return b;
}
const ctx = {
  userId: "u1",
  supabase: { from, rpc: async (_n: string, a: { _property_id: string }) => ({ data: !denied.has(a._property_id), error: null }) },
};

const SRC = "11111111-1111-4111-8111-111111111111";
const T1 = "22222222-2222-4222-8222-222222222222";
const T2 = "33333333-3333-4333-8333-333333333333";
const FAQ = "44444444-4444-4444-8444-444444444444";
const CUS = "55555555-5555-4555-8555-555555555555";

const writes = () => ops.filter((o) => ["update", "insert", "upsert", "delete"].includes(o.op));

beforeEach(() => {
  ops = [];
  denied = new Set();
  reindex.mockClear();
  audit.mockClear();
  tables = {
    properties: [
      { id: SRC, owner_id: "owner-1", checkin_instructions: "Silêncio após as 22h." },
      { id: T1, owner_id: "owner-1" },
      { id: T2, owner_id: "owner-1" },
    ],
    property_playbook_entries: [
      { property_id: SRC, field_key: `custom:${CUS}`, value: "Lixo no térreo, bloco B.", custom_label: "Coleta seletiva", custom_audience: "G", section_num: 4 },
      { property_id: T1, field_key: "custom:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", value: "antigo", custom_label: "coleta seletiva", custom_audience: "I", section_num: 4 },
    ],
    property_faqs: [{ id: FAQ, property_id: SRC, question: "Aceitam pets?", answer: "Não aceitamos pets." }],
  };
});

const base = { sourcePropertyId: SRC, targetPropertyIds: [T1, T2] };

describe("bulkUpdatePlaybookEntries — campos PROIBIDOS", () => {
  it.each([
    "f:senha_do_wi_fi",
    "f:nome_da_rede_wi_fi",
    "f:codigo_do_portao",
    "f:fechadura_eletronica",
    "f:cep",
    "f:link_do_mapa",
    "f:contatos_de_emergencia",
    "f:capacidade_maxima",
    "f:quantidade_de_quartos",
    "prov:44444444-4444-4444-8444-444444444444",
  ])("%s é recusado pelo backend sem tocar no banco", async (rowId) => {
    const { bulkUpdatePlaybookEntries } = await import("@/lib/playbook.functions");
    await expect(
      bulkUpdatePlaybookEntries({ data: { ...base, action: "content", source: { kind: "row", rowId } } }),
    ).rejects.toThrow(/bloqueado/i);
    expect(ops).toHaveLength(0);
    expect(writes()).toHaveLength(0);
  });

  it("nota digitada com senha, coordenadas ou título sensível é recusada", async () => {
    const { bulkUpdatePlaybookEntries } = await import("@/lib/playbook.functions");
    const mk = (label: string, value: string) =>
      bulkUpdatePlaybookEntries({ data: { ...base, action: "content", source: { kind: "new", label, section: 4, value } } });
    await expect(mk("Aviso", "A senha do wi-fi: casa123")).rejects.toThrow(/senha/i);
    await expect(mk("Aviso", "Fica em -23.550520, -46.633308")).rejects.toThrow(/GPS/i);
    await expect(mk("Código da fechadura", "use o teclado")).rejects.toThrow(/sensível/i);
    expect(writes()).toHaveLength(0);
  });

  it("audiência só em linhas criadas à mão", async () => {
    const { bulkUpdatePlaybookEntries } = await import("@/lib/playbook.functions");
    await expect(
      bulkUpdatePlaybookEntries({ data: { ...base, action: "audience", audience: "P", source: { kind: "row", rowId: "f:instrucoes_de_check_in" } } }),
    ).rejects.toThrow(/audiência/i);
  });
});

describe("bulkUpdatePlaybookEntries — permissões", () => {
  it("sem acesso a UM destino: nada é gravado", async () => {
    denied.add(T2);
    const { bulkUpdatePlaybookEntries } = await import("@/lib/playbook.functions");
    await expect(
      bulkUpdatePlaybookEntries({ data: { ...base, action: "content", source: { kind: "row", rowId: "f:instrucoes_de_check_in" } } }),
    ).rejects.toThrow(/permissão/i);
    expect(writes()).toHaveLength(0);
  });

  it("imóveis de contas diferentes são recusados", async () => {
    tables["properties"]![2]!.owner_id = "owner-2";
    const { bulkUpdatePlaybookEntries } = await import("@/lib/playbook.functions");
    await expect(
      bulkUpdatePlaybookEntries({ data: { ...base, action: "content", source: { kind: "row", rowId: "f:instrucoes_de_check_in" } } }),
    ).rejects.toThrow(/mesma conta/i);
    expect(writes()).toHaveLength(0);
  });
});

describe("bulkUpdatePlaybookEntries — campos PERMITIDOS", () => {
  it("instruções de check-in vão para a coluna checkin_instructions de todos os destinos", async () => {
    const { bulkUpdatePlaybookEntries } = await import("@/lib/playbook.functions");
    const r = await bulkUpdatePlaybookEntries({ data: { ...base, action: "content", source: { kind: "row", rowId: "f:instrucoes_de_check_in" } } });
    expect(r).toMatchObject({ ok: true, applied: 2, failed: [] });
    const ups = writes().filter((o) => o.table === "properties" && o.op === "update");
    expect(ups.map((o) => o.filters[0])).toEqual([["id", T1], ["id", T2]]);
    expect(ups.every((o) => o.args[0].checkin_instructions === "Silêncio após as 22h.")).toBe(true);
    expect(reindex).toHaveBeenCalledTimes(2);
    expect(audit).toHaveBeenCalledOnce();
    const auditCalls = audit.mock.calls as unknown as Array<[Record<string, unknown>]>;
    expect(auditCalls[0]?.[0]).toMatchObject({ action: "playbook_bulk_update", actorId: "u1", tenantId: "owner-1" });
  });

  it("linha personalizada + audiência: atualiza onde já existe (mesmo título) e cria onde não existe", async () => {
    const { bulkUpdatePlaybookEntries } = await import("@/lib/playbook.functions");
    const r = await bulkUpdatePlaybookEntries({
      data: { ...base, action: "both", audience: "P", source: { kind: "row", rowId: `custom:${CUS}` } },
    });
    expect(r).toMatchObject({ ok: true, applied: 2 });
    const up = writes().filter((o) => o.table === "property_playbook_entries" && o.op === "upsert");
    expect(up).toHaveLength(2);
    const t1 = up.find((o) => o.args[0].property_id === T1)!;
    expect(t1.args[0]).toMatchObject({ field_key: "custom:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", value: "Lixo no térreo, bloco B.", custom_audience: "P" });
    const t2 = up.find((o) => o.args[0].property_id === T2)!;
    expect(t2.args[0]).toMatchObject({ custom_label: "Coleta seletiva", custom_audience: "P", section_num: 4, value: "Lixo no térreo, bloco B." });
    expect(String(t2.args[0].field_key)).toMatch(/^custom:/);
  });

  it("só audiência: não cria linha onde ela não existe", async () => {
    const { bulkUpdatePlaybookEntries } = await import("@/lib/playbook.functions");
    const r = await bulkUpdatePlaybookEntries({ data: { ...base, action: "audience", audience: "I", source: { kind: "row", rowId: `custom:${CUS}` } } });
    expect(r.applied).toBe(1);
    expect(r.skipped).toHaveLength(1);
    const up = writes().filter((o) => o.table === "property_playbook_entries");
    expect(up).toHaveLength(1);
    expect(up[0]!.args[0]).toMatchObject({ property_id: T1, custom_audience: "I" });
    expect("value" in up[0]!.args[0]).toBe(false);
  });

  it("FAQ geral é criada nos destinos que não a têm", async () => {
    const { bulkUpdatePlaybookEntries } = await import("@/lib/playbook.functions");
    const r = await bulkUpdatePlaybookEntries({ data: { ...base, action: "content", source: { kind: "row", rowId: `faq:${FAQ}` } } });
    expect(r.applied).toBe(2);
    const ins = writes().filter((o) => o.table === "property_faqs" && o.op === "insert");
    expect(ins).toHaveLength(2);
    expect(ins[0]!.args[0]).toMatchObject({ question: "Aceitam pets?", answer: "Não aceitamos pets." });
  });

  it("nota digitada em lote é criada em todos os destinos", async () => {
    const { bulkUpdatePlaybookEntries } = await import("@/lib/playbook.functions");
    const r = await bulkUpdatePlaybookEntries({
      data: { ...base, action: "both", audience: "G", source: { kind: "new", label: "Áreas comuns", section: 4, value: "Silêncio nas áreas comuns após as 22h." } },
    });
    expect(r.applied).toBe(2);
    const up = writes().filter((o) => o.op === "upsert");
    expect(up.every((o) => o.args[0].custom_audience === "G" && o.args[0].custom_label === "Áreas comuns")).toBe(true);
  });
});

import { classifyBulkRow as classifyRule } from "@/lib/playbook-bulk";
describe("regras da casa vêm do anúncio", () => {
  it("não podem ser replicadas", () => {
    expect(classifyRule("f:regras_adicionais_da_casa").ok).toBe(false);
  });
});
