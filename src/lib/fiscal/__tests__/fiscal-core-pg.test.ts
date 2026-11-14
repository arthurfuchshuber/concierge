/**
 * MÓDULO FISCAL (v4.4) — migration `20261114200000_fiscal_core.sql` contra PostgreSQL REAL.
 * Prova: isolamento de clientes, trilhas append-only, uso único da autorização sob concorrência, prazo,
 * sequência P→S4 com `sent` comprometido antes do HTTP, unknown_result só por consulta, I-1 (2xx não autoriza).
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PG_AVAILABLE, startCluster, type PgCluster } from "../../guest-ai/__tests__/pg/pg-cluster";

const ROOT = path.resolve(__dirname, "../../../..");
const MIGRATION = path.join(ROOT, "supabase/migrations/20261114200000_fiscal_core.sql");

const OWNER = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const HASH = createHash("sha256").update('{"n": 1}').digest("hex");  // payload::text do jsonb
const SIG = "s".repeat(64);
const svc = { role: "service_role" } as const;

describe.skipIf(!PG_AVAILABLE)("Fiscal core · migration contra PostgreSQL real", () => {
  let pg: PgCluster;
  let sessionUser = "";
  let company = "";
  const q1 = async (query: string) => (await pg.sql(query)).trim().split("\n").pop()!;

  async function newOperation(kind = "issue"): Promise<{ op: string; doc: string }> {
    const doc = await q1(`insert into public.fiscal_documents (owner_id, company_id, direction, document_kind, natural_key) values ('${OWNER}','${company}','issued','nfse', gen_random_uuid()::text) returning id`);
    const op = await q1(`select public.fiscal_operation_create('${OWNER}','${company}','${doc}','${kind}','{"n":1}'::jsonb,'${USER}')`);
    return { op, doc };
  }
  async function authorize(op: string, ttl = "10 minutes"): Promise<string> {
    return q1(`select public.fiscal_authorization_issue('${op}','${USER}','${HASH}',1,'fp','${SIG}','${ttl}'::interval)`);
  }
  const markSent = (att: string, auth: string, eps = "0 seconds") =>
    pg.sql(`select public.fiscal_attempt_mark_sent('${att}','${auth}', array['${sessionUser}'], current_user::text, '${eps}'::interval)::text`).then((o) => JSON.parse(o.trim().split("\n").pop()!) as { ok: boolean; reason?: string });
  async function prepareAttempt(op: string): Promise<string> {
    const att = await q1(`select public.fiscal_attempt_plan('${op}','focus-v0')`);
    await pg.sql(`select public.fiscal_attempt_record_payload('${att}','${HASH}','{"ref":"x"}'::jsonb)`);
    return att;
  }

  beforeAll(async () => {
    pg = startCluster([MIGRATION]);
    sessionUser = await q1("select session_user");
    const conn = await q1(`insert into public.fiscal_provider_connections (owner_id, environment, base_url) values ('${OWNER}','homologation','https://homologacao.focusnfe.com.br') returning id`);
    company = await q1(`insert into public.fiscal_companies (owner_id, connection_id, tax_id, legal_name, status) values ('${OWNER}','${conn}','12345678000199','Empresa Teste','active') returning id`);
  }, 120_000);
  afterAll(() => pg?.stop());

  it("clientes (anon/authenticated) não leem, escrevem nem executam funções", async () => {
    for (const role of ["anon", "authenticated"]) {
      expect((await pg.trySql("select * from public.fiscal_documents", { role })).ok, role).toBe(false);
      expect((await pg.trySql("select * from public.fiscal_audit", { role })).ok, role).toBe(false);
      expect((await pg.trySql(`insert into public.fiscal_audit (action, entity) values ('x','y')`, { role })).ok, role).toBe(false);
      expect((await pg.trySql(`select public.fiscal_attempt_sweep_unknown()`, { role })).ok, role).toBe(false);
    }
    expect((await pg.trySql(`select public.fiscal_attempt_sweep_unknown()`, svc)).ok).toBe(true);
  });

  it("CNPJ ativo é único globalmente; token em claro é recusado no segredo", async () => {
    const dup = await pg.trySql(`insert into public.fiscal_companies (owner_id, connection_id, tax_id, legal_name) select '${USER}', connection_id, tax_id, 'Outra' from public.fiscal_companies limit 1`);
    expect(dup.ok).toBe(false);
    const plain = await pg.trySql(`insert into public.fiscal_provider_connections (owner_id, environment, base_url, secret_ref) values ('${USER}','production','https://api.focusnfe.com.br','{"token":"abc"}')`);
    expect(plain.ok).toBe(false);
  });

  it("caminho feliz: P→S1→S2(sent)→S3→S4; 2xx aceito NÃO autoriza o documento (I-1)", async () => {
    const { op, doc } = await newOperation();
    const auth = await authorize(op);
    const att = await prepareAttempt(op);
    const r = await markSent(att, auth);
    expect(r.ok).toBe(true);
    expect(await q1(`select state from public.fiscal_operations where id='${op}'`)).toBe("in_flight");
    await pg.sql(`select public.fiscal_attempt_record_response('${att}','accepted',200,'${HASH}','{}'::jsonb)`);
    expect(await q1(`select status from public.fiscal_documents where id='${doc}'`)).toBe("processing");
    // só consulta autoriza, e exige protocolo
    const noProto = await pg.trySql(`select public.fiscal_document_apply_query('${op}','authorized','autorizado',null,null,'${HASH}','{}'::jsonb)`);
    expect(noProto.ok).toBe(false);
    await pg.sql(`select public.fiscal_document_apply_query('${op}','authorized','autorizado','PROTO1','KEY1','${HASH}','{}'::jsonb)`);
    expect(await q1(`select status || '/' || protocol from public.fiscal_documents where id='${doc}'`)).toBe("authorized/PROTO1");
    expect(await q1(`select state from public.fiscal_operations where id='${op}'`)).toBe("completed");
  });

  it("documento 'authorized' sem protocolo é impossível por constraint", async () => {
    const d = await q1(`insert into public.fiscal_documents (owner_id, company_id, direction, document_kind, natural_key, status) values ('${OWNER}','${company}','received','nfe', gen_random_uuid()::text, 'discovered') returning id`);
    const r = await pg.trySql(`update public.fiscal_documents set status='authorized' where id='${d}'`);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("fiscal_doc_authorized_has_protocol");
  });

  it("sem autorização válida o envio é negado de forma durável e não consome nada", async () => {
    const { op } = await newOperation();
    const auth = await authorize(op);
    const att = await q1(`select public.fiscal_attempt_plan('${op}','focus-v0')`);   // sem payload persistido
    expect((await markSent(att, auth)).reason).toBe("payload_not_persisted");
    expect(await q1(`select count(*) from public.fiscal_authorization_consumptions where operation_id='${op}'`)).toBe("0");
    const wrongId = await pg.sql(`select public.fiscal_attempt_mark_sent('${att}','${auth}', array['intruso'], current_user::text, '0 seconds'::interval)::text`);
    // payload ausente é checado depois da identidade; a identidade errada vence
    expect(JSON.parse(wrongId.trim().split("\n").pop()!).reason).toBe("trigger_identity_denied");
    expect(Number(await q1(`select count(*) from public.fiscal_attempt_evidence where attempt_id='${att}' and kind='not_dispatched'`))).toBe(2);
  });

  it("autorização expirada: operação vira expired e nada é enviado", async () => {
    const { op } = await newOperation();
    const auth = await authorize(op, "1 second");
    const att = await prepareAttempt(op);
    await new Promise((r) => setTimeout(r, 1300));
    expect((await markSent(att, auth)).reason).toBe("dispatch_deadline_elapsed");
    expect(await q1(`select state from public.fiscal_operations where id='${op}'`)).toBe("expired");
  });

  it("concorrência: duas conexões tentam enviar a mesma tentativa — exatamente uma comita `sent`", async () => {
    const { op } = await newOperation();
    const auth = await authorize(op);
    const att = await prepareAttempt(op);
    const results = await Promise.all([0, 1, 2, 3].map(() => markSent(att, auth).then((r) => r.ok, () => false)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await q1(`select count(*) from public.fiscal_authorization_consumptions where authorization_id='${auth}'`)).toBe("1");
  });

  it("autorização de uso único: segunda tentativa na mesma operação não reaproveita a autorização", async () => {
    const { op } = await newOperation();
    const auth = await authorize(op);
    const att = await prepareAttempt(op);
    expect((await markSent(att, auth)).ok).toBe(true);
    await pg.sql(`select public.fiscal_attempt_record_response('${att}','retryable_before_send',503,'${HASH}','{}'::jsonb)`);
    expect(await q1(`select state from public.fiscal_operations where id='${op}'`)).toBe("awaiting_authorization");
    // volta a exigir NOVA autorização; a antiga não serve
    const replan = await pg.trySql(`select public.fiscal_attempt_plan('${op}','focus-v0')`);
    expect(replan.ok).toBe(false);
    const auth2 = await authorize(op);
    const att2 = await prepareAttempt(op);
    expect((await markSent(att2, auth)).reason).toBe("authorization_consumed");
    expect((await markSent(att2, auth2)).ok).toBe(true);
  });

  it("trilhas append-only: nem service_role altera ou apaga", async () => {
    for (const t of ["fiscal_attempt_evidence", "fiscal_authorization_consumptions", "fiscal_operation_authorizations", "fiscal_audit"]) {
      expect((await pg.trySql(`delete from public.${t}`, svc)).ok, `delete ${t}`).toBe(false);
      expect((await pg.trySql(`truncate public.${t}`, svc)).ok, `truncate ${t}`).toBe(false);
    }
    expect((await pg.trySql(`update public.fiscal_attempt_evidence set http_status=1`)).ok).toBe(false);   // até o dono, por trigger
  });

  it("unknown_result: entra por falha, resolve só por consulta; ausência confirmada exige NOVA autorização", async () => {
    const { op, doc } = await newOperation();
    const auth = await authorize(op);
    const att = await prepareAttempt(op);
    expect((await markSent(att, auth)).ok).toBe(true);
    await pg.sql(`select public.fiscal_attempt_mark_unknown('${att}','timeout')`);
    expect(await q1(`select state from public.fiscal_operations where id='${op}'`)).toBe("unknown_result");
    expect(await q1(`select status from public.fiscal_documents where id='${doc}'`)).toBe("unknown_result");
    // novo plano é bloqueado enquanto o resultado é desconhecido
    expect((await pg.trySql(`select public.fiscal_attempt_plan('${op}','focus-v0')`)).ok).toBe(false);
    // ausência não provada com 2 consultas
    for (let i = 0; i < 2; i++) await pg.sql(`select public.fiscal_document_apply_query('${op}','absent','nao_encontrado',null,null,'${HASH}','{}'::jsonb)`);
    const early = JSON.parse(await q1(`select public.fiscal_operation_confirm_absence('${op}', 3, '0 seconds'::interval)::text`));
    expect(early.ok).toBe(false);
    await pg.sql(`select public.fiscal_document_apply_query('${op}','absent','nao_encontrado',null,null,'${HASH}','{}'::jsonb)`);
    const done = JSON.parse(await q1(`select public.fiscal_operation_confirm_absence('${op}', 3, '0 seconds'::interval)::text`));
    expect(done.ok).toBe(true);
    expect(await q1(`select state from public.fiscal_operations where id='${op}'`)).toBe("awaiting_authorization");
    const auth2 = await authorize(op);
    const att2 = await prepareAttempt(op);
    expect((await markSent(att2, auth2)).ok).toBe(true);
  });

  it("varredura: `sent` sem E3 além do limiar vira unknown_result e nunca reenvia", async () => {
    const { op } = await newOperation();
    const auth = await authorize(op);
    const att = await prepareAttempt(op);
    await markSent(att, auth);
    await new Promise((r) => setTimeout(r, 1100));
    const n = Number(await q1(`select public.fiscal_attempt_sweep_unknown('1 second'::interval)`));
    expect(n).toBeGreaterThanOrEqual(1);
    expect(await q1(`select state from public.fiscal_operation_attempts where id='${att}'`)).toBe("unknown_result");
    expect(await q1(`select state from public.fiscal_operations where id='${op}'`)).toBe("unknown_result");
  });

  it("consulta que encontra o documento resolve o resultado desconhecido (found)", async () => {
    const { op, doc } = await newOperation();
    const auth = await authorize(op);
    const att = await prepareAttempt(op);
    await markSent(att, auth);
    await pg.sql(`select public.fiscal_attempt_mark_unknown('${att}','connection_lost')`);
    await pg.sql(`select public.fiscal_document_apply_query('${op}','authorized','autorizado','P2','K2','${HASH}','{}'::jsonb)`);
    expect(await q1(`select status from public.fiscal_documents where id='${doc}'`)).toBe("authorized");
    expect(await q1(`select resolution from public.fiscal_operation_attempts where id='${att}'`)).toBe("found");
  });
});
