import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PG_AVAILABLE, startCluster, type PgCluster } from "../../guest-ai/__tests__/pg/pg-cluster";

const ROOT = path.resolve(__dirname, "../../../..");
const MIG = (f: string) => path.join(ROOT, "supabase/migrations", f);
const JANELAS = "20261116230000_fiscal_janelas_dados_servicos.sql";
const M = ["20261114200000_fiscal_core.sql", "20261114210000_fiscal_enablement_webhooks.sql", JANELAS].map(MIG);
const OWNER = "11111111-1111-4111-8111-111111111111";

describe.skipIf(!PG_AVAILABLE)("Fiscal · janelas: dados da empresa e serviços (PostgreSQL real)", () => {
  let pg: PgCluster;
  let company = "";
  const q1 = async (q: string) => (await pg.sql(q)).trim().split("\n").pop()!;
  beforeAll(async () => {
    pg = startCluster(M);
    const conn = await q1(`insert into public.fiscal_provider_connections (owner_id, environment, base_url, status) values ('${OWNER}','production','https://p','active') returning id`);
    company = await q1(`insert into public.fiscal_companies (owner_id, connection_id, tax_id, legal_name) values ('${OWNER}','${conn}','12345678000195','ACME') returning id`);
  }, 120_000);
  afterAll(() => pg?.stop());

  const svc = (over = "", national = "100501") =>
    `insert into public.fiscal_services (owner_id, company_id, national_code, description${over ? ", " + over.split("=")[0] : ""}) values ('${OWNER}','${company}','${national}','Agenciamento'${over ? ", " + over.split("=")[1] : ""}) returning id`;

  it("é idempotente: aplicar de novo não falha nem duplica", async () => {
    expect((await pg.trySql(readFileSync(MIG(JANELAS), "utf8"))).ok).toBe(true);
  });
  it("não tem DROP/DELETE/TRUNCATE e nenhuma coluna de certificado, senha ou token", () => {
    const sql = readFileSync(MIG(JANELAS), "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").toLowerCase();
    expect(sql).not.toMatch(/\bdrop\b|\bdelete\b|\btruncate\b/);
    expect(sql).not.toMatch(/pfx|senha|password|token|certificado/);
  });
  it("empresa nasce com padrões: regime 0, série 1, próximo número 1, tributos aproximados 'none'", async () => {
    expect(await q1(`select special_regime || '|' || dps_series || '|' || dps_next_number || '|' || approximate_taxes from public.fiscal_companies where id='${company}'`)).toBe("0|1|1|none");
  });
  it("valida regime, série, número, Simples e tributos aproximados", async () => {
    for (const set of ["special_regime = 7", "dps_series = 'AB'", "dps_next_number = 0", "simples_option = 'x'", "approximate_taxes = 'y'"]) {
      expect((await pg.trySql(`update public.fiscal_companies set ${set} where id='${company}'`)).ok).toBe(false);
    }
    expect((await pg.trySql(`update public.fiscal_companies set special_regime = 3, dps_series = '2', dps_next_number = 10, simples_option = 'me_epp', approximate_taxes = 'included' where id='${company}'`)).ok).toBe(true);
  });
  it("serviço: código nacional de 6 dígitos, NBS e percentuais válidos, descrição mínima", async () => {
    expect((await pg.trySql(svc("", "10050"))).ok).toBe(false);
    expect((await pg.trySql(svc("nbs_code='abc'"))).ok).toBe(false);
    expect((await pg.trySql(svc("inss_pct=101"))).ok).toBe(false);
    expect((await pg.trySql(`insert into public.fiscal_services (owner_id, company_id, national_code, description) values ('${OWNER}','${company}','100501','ab')`)).ok).toBe(false);
    expect((await pg.trySql(svc("nbs_code='1.1501.30.00'"))).ok).toBe(true);
  });
  it("um único serviço padrão ativo por empresa (o excluído não conta)", async () => {
    const a = await q1(svc("is_default=true"));
    expect((await pg.trySql(svc("is_default=true"))).ok).toBe(false);
    await pg.sql(`update public.fiscal_services set soft_deleted_at = now(), is_default = false where id='${a}'`);
    expect((await pg.trySql(svc("is_default=true"))).ok).toBe(true);
  });
  it("clientes (anon/authenticated) não leem nem escrevem serviços: RLS ligada e sem privilégio", async () => {
    expect(await q1(`select relrowsecurity from pg_class where oid='public.fiscal_services'::regclass`)).toBe("t");
    for (const role of ["anon", "authenticated"]) {
      expect(await q1(`select has_table_privilege('${role}','public.fiscal_services','select') or has_table_privilege('${role}','public.fiscal_services','insert')`)).toBe("f");
    }
  });
});
