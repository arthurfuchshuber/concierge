/**
 * FLUXO VERTICAL (banco real + adaptador Focus + sequência + reconciliação) com `fetch` simulado.
 * O provedor é simulado: isto NÃO prova a API real da Focus (bloqueio B1), prova a integração entre as nossas camadas.
 */
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PG_AVAILABLE, startCluster, type PgCluster } from "../../guest-ai/__tests__/pg/pg-cluster";
import { FocusClient, type FetchLike } from "../focus/client";
import { redactBody, hashBody } from "../redact";
import { reconcileOne } from "../reconcile";
import { runSendSequence } from "../send-sequence";

const ROOT = path.resolve(__dirname, "../../../..");
const OWNER = "11111111-1111-4111-8111-111111111111";
const lit = (v: unknown) => `'${String(typeof v === "string" ? v : JSON.stringify(v)).replace(/'/g, "''")}'`;

describe.skipIf(!PG_AVAILABLE)("Fluxo vertical fiscal (PostgreSQL real + adaptador + sequência)", () => {
  let pg: PgCluster; let company = ""; let su = "";
  const q1 = async (q: string) => (await pg.sql(q)).trim().split("\n").pop()!;
  const call = (fn: string, ...args: unknown[]) => q1(`select ${fn}(${args.map((a) => (a === null ? "null" : typeof a === "number" ? a : typeof a === "object" ? `${lit(a)}::jsonb` : lit(a))).join(",")})::text`);

  beforeAll(async () => {
    pg = startCluster([path.join(ROOT, "supabase/migrations/20261114200000_fiscal_core.sql"), path.join(ROOT, "supabase/migrations/20261114210000_fiscal_enablement_webhooks.sql")]);
    su = await q1("select session_user");
    const conn = await q1(`insert into public.fiscal_provider_connections (owner_id, environment, base_url, status) values ('${OWNER}','homologation','https://homologacao.focusnfe.com.br','active') returning id`);
    company = await q1(`insert into public.fiscal_companies (owner_id, connection_id, tax_id, legal_name, status) values ('${OWNER}','${conn}','12345678000199','Emp','active') returning id`);
  }, 120_000);
  afterAll(() => pg?.stop());

  async function newOp(payload: Record<string, unknown>) {
    const doc = await q1(`insert into public.fiscal_documents (owner_id, company_id, direction, document_kind, natural_key) values ('${OWNER}','${company}','issued','nfse', gen_random_uuid()::text) returning id`);
    const op = await call("public.fiscal_operation_create", OWNER, company, doc, "issue", payload, OWNER);
    const row = (await q1(`select ref || '|' || payload_hash from public.fiscal_operations where id='${op}'`)).split("|");
    const auth = await call("public.fiscal_authorization_issue", op, OWNER, row[1], 1, "fp", "s".repeat(32), "10 minutes");
    return { doc, op, ref: row[0]!, hash: row[1]!, auth };
  }
  const ports = (send: () => ReturnType<FocusClient["issue"]>) => ({
    plan: async (id: string, v: string) => call("public.fiscal_attempt_plan", id, v),
    recordPayload: async (a: string, h: string, r: unknown) => void (await call("public.fiscal_attempt_record_payload", a, h, r)),
    markSent: async (a: string, au: string) => JSON.parse(await q1(`select public.fiscal_attempt_mark_sent('${a}','${au}',array['${su}'],current_user::text,'0 seconds'::interval)::text`)) as { ok: boolean; reason?: string },
    markUnknown: async (a: string, r: string) => void (await call("public.fiscal_attempt_mark_unknown", a, r)),
    recordResponse: async (a: string, c: string, s: number, h: string, r: unknown) => void (await call("public.fiscal_attempt_record_response", a, c, s, h, r)),
    send,
  });
  const args = (x: { op: string; auth: string; hash: string }) => ({ operationId: x.op, authorizationId: x.auth, payloadHash: x.hash, redactedPayload: { ok: 1 }, adapterVersion: "t", hashBody, redactBody });

  it("emissão: envio aceito → processando → consulta autoriza (com protocolo) → operação concluída", async () => {
    const x = await newOp({ prestador: { cnpj: "12345678000199" }, servico: { valor: 100 } });
    const seen: string[] = [];
    const fetch: FetchLike = async (url, init) => { seen.push(`${init.method} ${url}`); return { status: 201, text: async () => JSON.stringify({ status: "processando_autorizacao" }) }; };
    const client = new FocusClient({ environment: "homologation", token: "TOKEN-DE-TESTE", fetch });
    const out = await runSendSequence(ports(() => client.issue("nfse", x.ref, { a: 1 })) as never, args(x));
    expect(out).toMatchObject({ kind: "responded", responseClass: "accepted" });
    expect(seen).toEqual([`POST https://homologacao.focusnfe.com.br/v2/nfse?ref=${x.ref}`]);
    expect(await q1(`select status from public.fiscal_documents where id='${x.doc}'`)).toBe("processing");

    const qfetch: FetchLike = async () => ({ status: 200, text: async () => JSON.stringify({ status: "autorizado", protocolo: "PROTO-9" }) });
    const qc = new FocusClient({ environment: "homologation", token: "TOKEN-DE-TESTE", fetch: qfetch });
    const r = await reconcileOne({ query: (c) => qc.query(c.documentKind, c.ref), hash: hashBody, redact: redactBody, applyQuery: async (op, res, st, p, k, h, red) => void (await call("public.fiscal_document_apply_query", op, res, st, p, k, h, red)) }, { operationId: x.op, ref: x.ref, documentKind: "nfse", opKind: "issue" });
    expect(r.result).toBe("authorized");
    expect(await q1(`select status || '/' || protocol from public.fiscal_documents where id='${x.doc}'`)).toBe("authorized/PROTO-9");
    expect(await q1(`select state from public.fiscal_operations where id='${x.op}'`)).toBe("completed");
  });

  it("timeout: vira resultado desconhecido, NÃO reenvia, e a consulta que acha o documento resolve", async () => {
    const x = await newOp({ n: 2 });
    let posts = 0;
    const fetch: FetchLike = async () => { posts++; throw Object.assign(new Error("aborted"), { name: "AbortError" }); };
    const client = new FocusClient({ environment: "homologation", token: "TOKEN-DE-TESTE", fetch });
    const out = await runSendSequence(ports(() => client.issue("nfse", x.ref, {})) as never, args(x));
    expect(out).toEqual({ kind: "unknown", reason: "timeout" });
    expect(posts).toBe(1);
    expect(await q1(`select status from public.fiscal_documents where id='${x.doc}'`)).toBe("unknown_result");
    // tentativa de novo envio com a mesma autorização é barrada pelo banco
    const again = await pg.trySql(`select public.fiscal_attempt_plan('${x.op}','t')`);
    expect(again.ok).toBe(false);
    await call("public.fiscal_document_apply_query", x.op, "authorized", "autorizado", "PROTO-10", null, "h".repeat(16), {});
    expect(await q1(`select status from public.fiscal_documents where id='${x.doc}'`)).toBe("authorized");
  });

  it("falha ao gravar a resposta (S4) depois de enviar: vira desconhecido, sem segundo envio", async () => {
    const x = await newOp({ n: 3 });
    let posts = 0;
    const fetch: FetchLike = async () => { posts++; return { status: 201, text: async () => "{}" }; };
    const client = new FocusClient({ environment: "homologation", token: "TOKEN-DE-TESTE", fetch });
    const p = ports(() => client.issue("nfse", x.ref, {}));
    p.recordResponse = async () => { throw new Error("db caiu"); };
    expect(await runSendSequence(p as never, args(x))).toEqual({ kind: "unknown", reason: "response_not_persisted" });
    expect(posts).toBe(1);
    expect(await q1(`select state from public.fiscal_operation_attempts where operation_id='${x.op}'`)).toBe("unknown_result");
  });

  it("autorização já consumida: segundo despacho é negado e a rede nunca é chamada", async () => {
    const x = await newOp({ n: 4 });
    const fetch: FetchLike = async () => ({ status: 201, text: async () => "{}" });
    const client = new FocusClient({ environment: "homologation", token: "TOKEN-DE-TESTE", fetch });
    await runSendSequence(ports(() => client.issue("nfse", x.ref, {})) as never, args(x));
    let called = false;
    const out = await runSendSequence(ports(async () => { called = true; return { status: 201, body: {} }; }) as never, args(x)).catch((e: Error) => e);
    expect(called).toBe(false);
    expect(out instanceof Error || (out as { kind: string }).kind === "denied").toBe(true);
  });
});
