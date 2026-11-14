import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PG_AVAILABLE, startCluster, type PgCluster } from "../../guest-ai/__tests__/pg/pg-cluster";

const ROOT = path.resolve(__dirname, "../../../..");
const M = ["20261114200000_fiscal_core.sql", "20261114210000_fiscal_enablement_webhooks.sql", "20261114220000_fiscal_document_files.sql"].map((f) => path.join(ROOT, "supabase/migrations", f));
const OWNER = "11111111-1111-4111-8111-111111111111";
const SHA = "a".repeat(64);

describe.skipIf(!PG_AVAILABLE)("Fiscal · arquivos com guarda de 5 anos (PostgreSQL real)", () => {
  let pg: PgCluster;
  let company = "", doc = "";
  const q1 = async (q: string) => (await pg.sql(q)).trim().split("\n").pop()!;
  beforeAll(async () => {
    pg = startCluster(M);
    const conn = await q1(`insert into public.fiscal_provider_connections (owner_id, environment, base_url, status) values ('${OWNER}','homologation','https://h','active') returning id`);
    company = await q1(`insert into public.fiscal_companies (owner_id, connection_id, tax_id, legal_name) values ('${OWNER}','${conn}','12345678000195','ACME') returning id`);
    doc = await q1(`insert into public.fiscal_documents (owner_id, company_id, direction, document_kind, natural_key) values ('${OWNER}','${company}','issued','nfe','k1') returning id`);
  }, 120_000);
  afterAll(() => pg?.stop());

  const ins = (extra = "", p = `${OWNER}/x/a.xml`, kind = "xml", sha = SHA) =>
    `insert into public.fiscal_document_files (owner_id, company_id, document_id, kind, storage_path, sha256, size_bytes${extra ? ", retain_until" : ""}) values ('${OWNER}','${company}','${doc}','${kind}','${p}','${sha}',10${extra ? `, ${extra}` : ""}) returning id`;

  it("retenção padrão é de 60 meses e nasce com o prazo mínimo", async () => {
    const id = await q1(ins());
    const months = await q1(`select round(extract(epoch from (retain_until - created_at)) / 86400 / 30.4)::int from public.fiscal_document_files where id='${id}'`);
    expect(Number(months)).toBeGreaterThanOrEqual(59);
  });
  it("não aceita prazo menor que 60 meses, caminho de outro dono, tipo ou tamanho inválidos, nem versão duplicada", async () => {
    expect((await pg.trySql(ins("now() + interval '12 months'", `${OWNER}/y/b.xml`, "xml", "b".repeat(64)))).ok).toBe(false);
    expect((await pg.trySql(ins("", `99999999-9999-4999-8999-999999999999/y/c.xml`, "xml", "c".repeat(64)))).ok).toBe(false);
    expect((await pg.trySql(ins("", `${OWNER}/y/d.zip`, "zip", "d".repeat(64)))).ok).toBe(false);
    expect((await pg.trySql(ins("", `${OWNER}/y/e.xml`, "xml", SHA))).ok).toBe(false); // mesmo (doc, tipo, sha)
  });
  it("não pode ser alterado, apagado dentro do prazo nem truncado", async () => {
    expect((await pg.trySql(`update public.fiscal_document_files set size_bytes = 1`)).ok).toBe(false);
    expect((await pg.trySql(`delete from public.fiscal_document_files`)).ok).toBe(false);
    expect((await pg.trySql(`truncate public.fiscal_document_files`)).ok).toBe(false);
    expect(await q1(`select count(*) from public.fiscal_document_files`)).toBe("1");
  });
  it("clientes (anon/authenticated) não leem nem escrevem; service_role lê e insere mas não altera", async () => {
    for (const role of ["anon", "authenticated"]) {
      expect((await pg.trySql(`select * from public.fiscal_document_files`, { role })).ok).toBe(false);
      expect((await pg.trySql(ins("", `${OWNER}/z/${role}.xml`, "xml", role === "anon" ? "1".repeat(64) : "2".repeat(64)), { role })).ok).toBe(false);
    }
    expect((await pg.trySql(`select count(*) from public.fiscal_document_files`, { role: "service_role" })).ok).toBe(true);
    expect((await pg.trySql(`update public.fiscal_document_files set size_bytes = 2`, { role: "service_role" })).ok).toBe(false);
  });
});
