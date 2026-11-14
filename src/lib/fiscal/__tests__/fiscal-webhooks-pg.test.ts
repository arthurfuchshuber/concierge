import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PG_AVAILABLE, startCluster, type PgCluster } from "../../guest-ai/__tests__/pg/pg-cluster";

const ROOT = path.resolve(__dirname, "../../../..");
const M1 = path.join(ROOT, "supabase/migrations/20261114200000_fiscal_core.sql");
const M2 = path.join(ROOT, "supabase/migrations/20261114210000_fiscal_enablement_webhooks.sql");
const OWNER = "11111111-1111-4111-8111-111111111111";
const svc = { role: "service_role" } as const;
const H = "h".repeat(64);

describe.skipIf(!PG_AVAILABLE)("Fiscal · habilitação, webhooks e reconciliação (PostgreSQL real)", () => {
  let pg: PgCluster;
  let conn = "";
  const q1 = async (q: string, o?: { role?: string }) => (await pg.sql(q, o)).trim().split("\n").pop()!;
  beforeAll(async () => {
    pg = startCluster([M1, M2]);
    conn = await q1(`insert into public.fiscal_provider_connections (owner_id, environment, base_url, status) values ('${OWNER}','homologation','https://homologacao.focusnfe.com.br','active') returning id`);
  }, 120_000);
  afterAll(() => pg?.stop());

  it("clientes não acessam habilitação, eventos nem funções", async () => {
    for (const role of ["anon", "authenticated"]) {
      expect((await pg.trySql("select * from public.fiscal_tenant_enablement", { role })).ok).toBe(false);
      expect((await pg.trySql("select * from public.fiscal_webhook_events", { role })).ok).toBe(false);
      expect((await pg.trySql(`select public.fiscal_webhook_claim(1)`, { role })).ok).toBe(false);
    }
  });

  it("ingestão idempotente, inclusive com entregas simultâneas do mesmo corpo", async () => {
    const key = "k".repeat(64);
    const res = await Promise.all(Array.from({ length: 6 }, () => q1(`select public.fiscal_webhook_ingest('${conn}','${key}','${H}','{"ref":"x"}'::jsonb,'cia-x')::text`, svc)));
    expect(res.filter((r) => JSON.parse(r).new === true)).toHaveLength(1);
    expect(await q1(`select count(*) from public.fiscal_webhook_events`)).toBe("1");
    expect((await pg.trySql(`select public.fiscal_webhook_ingest(gen_random_uuid(),'${key}','${H}','{}'::jsonb,null)`, svc)).ok).toBe(false);
  });

  it("claim sem disputa: dois workers nunca pegam o mesmo evento; erro reenfileira até 5 tentativas", async () => {
    for (let i = 0; i < 4; i++) await pg.sql(`select public.fiscal_webhook_ingest('${conn}','${String(i).repeat(32)}','${H}','{}'::jsonb,null)`, svc);
    const [a, b] = await Promise.all([q1(`select coalesce(string_agg(id::text, ','),'') from public.fiscal_webhook_claim(2)`, svc), q1(`select coalesce(string_agg(id::text, ','),'') from public.fiscal_webhook_claim(2)`, svc)]);
    const ids = [...a.split(","), ...b.split(",")].filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
    const one = ids[0]!;
    await pg.sql(`select public.fiscal_webhook_finish('${one}','error','boom')`, svc);
    expect(await q1(`select status from public.fiscal_webhook_events where id='${one}'`)).toBe("pending");
    await pg.sql(`select public.fiscal_webhook_finish('${ids[1]}','processed')`, svc);
    expect(await q1(`select status from public.fiscal_webhook_events where id='${ids[1]}'`)).toBe("processed");
    expect((await pg.trySql(`select public.fiscal_webhook_finish('${one}','qualquer')`, svc)).ok).toBe(false);
  });

  it("candidatos à reconciliação: só operações desconhecidas/processando e parados", async () => {
    const company = await q1(`insert into public.fiscal_companies (owner_id, connection_id, tax_id, legal_name, status) values ('${OWNER}','${conn}','98765432000100','Emp','active') returning id`);
    const doc = await q1(`insert into public.fiscal_documents (owner_id, company_id, direction, document_kind, natural_key) values ('${OWNER}','${company}','issued','nfse','n1') returning id`);
    const op = await q1(`select public.fiscal_operation_create('${OWNER}','${company}','${doc}','issue','${H}','${OWNER}')`);
    const auth = await q1(`select public.fiscal_authorization_issue('${op}','${OWNER}','${H}',1,'fp','${"s".repeat(32)}','10 minutes'::interval)`);
    const att = await q1(`select public.fiscal_attempt_plan('${op}','v')`);
    await pg.sql(`select public.fiscal_attempt_record_payload('${att}','${H}','{}'::jsonb)`);
    const su = await q1("select session_user");
    await pg.sql(`select public.fiscal_attempt_mark_sent('${att}','${auth}',array['${su}'],current_user::text,'0 seconds'::interval)`);
    await pg.sql(`select public.fiscal_attempt_mark_unknown('${att}','timeout')`);
    expect(await q1(`select count(*) from public.fiscal_reconcile_candidates('0 seconds'::interval, 10)`, svc)).toBe("1");
    expect(await q1(`select count(*) from public.fiscal_reconcile_candidates('1 hour'::interval, 10)`, svc)).toBe("0");
  });
});
