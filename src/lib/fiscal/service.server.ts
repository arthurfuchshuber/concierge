/**
 * Serviço fiscal (server-only). Toda escrita passa pelas funções atômicas do banco; o token da Focus fica cifrado;
 * nenhum ato fiscal remoto acontece sem autorização humana de uso único consumida pelo portão `fiscal_attempt_mark_sent`.
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptConnectionKey, encryptConnectionKey } from "@/lib/connection-key-crypto.server";
import { FocusClient, FocusTransportError, type FetchLike, type FocusDocumentPath, type FocusEnvironment } from "./focus/client";
import { buildCompanyBody, CertificateInputError, formatCertificateLabel, parseCertificateExpiry, scrubCertificate, validateCertificateInput } from "./certificate";
import { requireFiscalAccess, type FiscalAction, type FiscalGuardPorts } from "./guard";
import { redactBody, hashBody } from "./redact";
import { reconcileOne, type ReconcileCandidate } from "./reconcile";
import { runSendSequence, type SendOutcome } from "./send-sequence";
import { sha256Hex } from "./webhook";
import type { FocusHttpResult } from "./types";

type Db = SupabaseClient;
export const ADAPTER_VERSION = "focus-adapter-0.1";
const DOC_KINDS = ["nfe", "nfse", "nfsen", "cte"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export async function adminDb(): Promise<Db> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as Db;
}

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): NonNullable<T> {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as NonNullable<T>;
}

/* ------------------------------------------------------------------ guarda */

export function guardPorts(db: Db): FiscalGuardPorts {
  return {
    async moduleEnabled(ownerId) {
      const { data } = await db.from("fiscal_tenant_enablement").select("enabled").eq("owner_id", ownerId).maybeSingle();
      return data?.enabled === true;
    },
  };
}

/** `owner_only`: a conta é SEMPRE a do próprio usuário autenticado. Outra conta pedida ⇒ 403 (sem exceção para admin SaaS). */
export async function authorizeFiscal(userId: string, requestedOwnerId: string | null | undefined, action: FiscalAction): Promise<{ db: Db; ownerId: string }> {
  const db = await adminDb();
  const ownerId = requestedOwnerId || userId;
  await requireFiscalAccess(guardPorts(db), { userId, ownerId, action });
  return { db, ownerId };
}

/* ------------------------------------------------------------- conexão/token */

export function tokenFingerprint(token: string): string {
  return sha256Hex(`fiscal-token:${token}`).slice(0, 12);
}

export async function saveConnection(db: Db, ownerId: string, args: { environment: FocusEnvironment; token: string }): Promise<{ id: string; fingerprint: string; webhookSecret: string }> {
  const token = args.token.trim();
  if (token.length < 8 || token.length > 200) throw new Error("Token inválido.");
  const secret_ref = { v: 1, ct: encryptConnectionKey(token) };
  const webhookSecret = randomBytes(24).toString("base64url");
  const base_url = args.environment === "production" ? "https://api.focusnfe.com.br" : "https://homologacao.focusnfe.com.br";
  const row = {
    owner_id: ownerId, provider: "focus", environment: args.environment, status: "pending", base_url, secret_ref,
    token_fingerprint: tokenFingerprint(token), webhook_secret_hash: sha256Hex(webhookSecret), last_error_code: null, updated_at: new Date().toISOString(),
  };
  const existing = await db.from("fiscal_provider_connections").select("id").eq("owner_id", ownerId).eq("environment", args.environment).maybeSingle();
  if (existing.data?.id) {
    must(await db.from("fiscal_provider_connections").update(row).eq("id", existing.data.id), "salvar conexão");
    await audit(db, ownerId, null, "connection_update", "connection", existing.data.id, { environment: args.environment, fingerprint: row.token_fingerprint });
    return { id: existing.data.id as string, fingerprint: row.token_fingerprint, webhookSecret };
  }
  const ins = must(await db.from("fiscal_provider_connections").insert(row).select("id").single(), "criar conexão") as { id: string };
  await audit(db, ownerId, null, "connection_create", "connection", ins.id, { environment: args.environment, fingerprint: row.token_fingerprint });
  return { id: ins.id as string, fingerprint: row.token_fingerprint, webhookSecret };
}

export async function getConnectionPublic(db: Db, ownerId: string) {
  const { data } = await db.from("fiscal_provider_connections").select("id, environment, status, token_fingerprint, last_ok_at, last_error_code, webhook_secret_hash, updated_at").eq("owner_id", ownerId);
  return (data ?? []).map((c) => ({ id: c.id as string, environment: c.environment as FocusEnvironment, status: c.status as string, tokenFingerprint: c.token_fingerprint as string | null, lastOkAt: c.last_ok_at as string | null, lastErrorCode: c.last_error_code as string | null, hasWebhook: !!c.webhook_secret_hash, updatedAt: c.updated_at as string }));
}

async function focusFor(db: Db, ownerId: string, connectionId: string, fetchImpl?: FetchLike): Promise<FocusClient> {
  const { data } = await db.from("fiscal_provider_connections").select("environment, secret_ref, status, owner_id").eq("id", connectionId).maybeSingle();
  if (!data || data.owner_id !== ownerId) throw new Error("Conexão fiscal não encontrada.");
  if (data.status === "revoked" || data.status === "paused") throw new Error("Conexão fiscal desativada.");
  const ct = (data.secret_ref as { ct?: string } | null)?.ct;
  if (!ct) throw new Error("Token da conexão não configurado.");
  return new FocusClient({ environment: data.environment as FocusEnvironment, token: decryptConnectionKey(ct), fetch: fetchImpl ?? (globalThis.fetch as unknown as FetchLike) });
}

/** Teste de credencial SEM efeito fiscal: consulta uma ref que não existe. 404 ⇒ autenticou; 401/403 ⇒ token recusado. */
export async function testConnection(db: Db, ownerId: string, connectionId: string, fetchImpl?: FetchLike): Promise<{ ok: boolean; code: string }> {
  const client = await focusFor(db, ownerId, connectionId, fetchImpl);
  let res: FocusHttpResult;
  try { res = await client.query("nfe", `cia-teste-${randomBytes(6).toString("hex")}`); }
  catch (e) { const code = e instanceof FocusTransportError ? e.reason : "unreachable"; await setConnState(db, connectionId, "error", code); return { ok: false, code }; }
  if (res.status === 401 || res.status === 403) { await setConnState(db, connectionId, "error", "token_rejected"); return { ok: false, code: "token_rejected" }; }
  if (res.status === 404 || (res.status >= 200 && res.status < 300)) { await setConnState(db, connectionId, "active", null); return { ok: true, code: "ok" }; }
  await setConnState(db, connectionId, "error", `http_${res.status}`);
  return { ok: false, code: `http_${res.status}` };
}
async function setConnState(db: Db, id: string, status: string, code: string | null) {
  await db.from("fiscal_provider_connections").update({ status, last_error_code: code, ...(status === "active" ? { last_ok_at: new Date().toISOString() } : {}), updated_at: new Date().toISOString() }).eq("id", id);
}

/* -------------------------------------------------------------- empresas */

const onlyDigits = (v: string) => v.replace(/\D+/g, "");

export async function createCompany(db: Db, ownerId: string, args: { connectionId: string; taxId: string; legalName: string }) {
  const tax = onlyDigits(args.taxId);
  if (!/^([0-9]{11}|[0-9]{14})$/.test(tax)) throw new Error("CPF/CNPJ inválido.");
  if (!args.legalName.trim()) throw new Error("Informe a razão social.");
  const conn = await db.from("fiscal_provider_connections").select("id").eq("id", args.connectionId).eq("owner_id", ownerId).maybeSingle();
  if (!conn.data) throw new Error("Conexão fiscal não encontrada.");
  const { data, error } = await db.from("fiscal_companies").insert({ owner_id: ownerId, connection_id: args.connectionId, tax_id: tax, legal_name: args.legalName.trim(), status: "draft" }).select("id").single();
  if (error) throw new Error(error.code === "23505" ? "Este CNPJ/CPF já está cadastrado em outra conta." : error.message);
  await audit(db, ownerId, null, "company_create", "company", data.id, {});
  return { id: data.id as string };
}

/** Projeção pública: só metadados operacionais. Nunca token da sub-empresa, inscrições, certificado ou senha. */
export type FiscalStatusPublic = {
  companies: Array<{
    companyId: string;
    status: "Ativa" | "Homologação" | "Pendente";
    legalName: string;
    tradeName: string | null;
    taxId: string;
    certificateValidUntil: string | null;
    certificateLabel: string | null;
    canReplaceCertificate: true;
  }>;
};

export async function getFiscalStatusPublic(db: Db, ownerId: string): Promise<FiscalStatusPublic> {
  const { data: comps } = await db.from("fiscal_companies").select("id, tax_id, legal_name, trade_name, status, connection_id, certificate_valid_until").eq("owner_id", ownerId).is("soft_deleted_at", null).order("created_at");
  const { data: conns } = await db.from("fiscal_provider_connections").select("id, environment, status").eq("owner_id", ownerId);
  const byId = new Map((conns ?? []).map((c) => [c.id as string, c]));
  return {
    companies: (comps ?? []).map((c) => {
      const conn = byId.get(c.connection_id as string);
      const live = c.status === "active" && conn?.status === "active";
      const status = !live ? "Pendente" : conn?.environment === "production" ? "Ativa" : "Homologação";
      const until = (c.certificate_valid_until as string | null) ?? null;
      return { companyId: c.id as string, status, legalName: c.legal_name as string, tradeName: (c.trade_name as string | null) ?? null, taxId: c.tax_id as string, certificateValidUntil: until, certificateLabel: formatCertificateLabel(until), canReplaceCertificate: true as const };
    }),
  };
}

/**
 * Envio do certificado A1 (WRITE-ONLY). Retorna só {ok, dryRun, code}. Nada do `.pfx`/senha é gravado, logado ou devolvido;
 * a auditoria guarda apenas o resultado. `dryRun` (padrão) usa `?dry_run=1` da Focus: simula sem criar a empresa.
 * A execução real é ato fiscal real e exige `dryRun:false` explícito do titular.
 */
export async function submitCompanyCertificate(
  db: Db, ownerId: string, userId: string,
  args: { companyId: string; pfxBase64: string; password: string; companyFields: Record<string, unknown>; dryRun: boolean },
  fetchImpl?: FetchLike,
): Promise<{ ok: boolean; dryRun: boolean; code: string }> {
  const { pfxBase64, password } = args;
  try {
    validateCertificateInput(pfxBase64, password);
    const { data: co } = await db.from("fiscal_companies").select("id, owner_id, tax_id, connection_id").eq("id", args.companyId).eq("owner_id", ownerId).is("soft_deleted_at", null).maybeSingle();
    if (!co) throw new Error("Empresa fiscal não encontrada.");
    const body = buildCompanyBody(args.companyFields, pfxBase64, password, co.tax_id as string);
    const { data: conn } = await db.from("fiscal_provider_connections").select("environment").eq("id", co.connection_id).eq("owner_id", ownerId).maybeSingle();
    if (conn?.environment !== "production") throw new Error("A API de Empresas da Focus opera apenas em produção: use uma conexão de produção.");
    const client = await focusFor(db, ownerId, co.connection_id as string, fetchImpl);
    let res: FocusHttpResult;
    try { res = await client.registerCompany(body, { dryRun: args.dryRun }); }
    catch (e) {
      const code = e instanceof FocusTransportError ? e.reason : "unreachable";
      await audit(db, ownerId, userId, "company_certificate_error", "company", args.companyId, { dryRun: args.dryRun, code });
      return { ok: false, dryRun: args.dryRun, code };
    }
    const ok = res.status >= 200 && res.status < 300;
    const code = ok ? "ok" : `http_${res.status}`;
    await audit(db, ownerId, userId, args.dryRun ? "company_certificate_dry_run" : "company_certificate_submit", "company", args.companyId, { dryRun: args.dryRun, httpStatus: res.status });
    if (ok && !args.dryRun) {
      const until = parseCertificateExpiry(res.body);
      const now = new Date().toISOString();
      await db.from("fiscal_companies").update({ certificate_valid_until: until, certificate_updated_at: now, updated_at: now }).eq("id", args.companyId).eq("owner_id", ownerId);
    }
    return { ok, dryRun: args.dryRun, code };
  } catch (e) {
    if (e instanceof CertificateInputError) return { ok: false, dryRun: args.dryRun, code: e.code };
    throw new Error(scrubCertificate(String((e as Error)?.message ?? e), pfxBase64, password));
  }
}

export async function listCompanies(db: Db, ownerId: string) {
  const { data } = await db.from("fiscal_companies").select("id, tax_id, legal_name, status, connection_id, created_at").eq("owner_id", ownerId).is("soft_deleted_at", null).order("created_at");
  return (data ?? []).map((c) => ({ id: c.id as string, taxId: c.tax_id as string, legalName: c.legal_name as string, status: c.status as string, connectionId: c.connection_id as string }));
}

/* ------------------------------------------------- operações e autorizações */

export async function prepareOperation(db: Db, ownerId: string, userId: string, args: { companyId: string; kind: "issue" | "cancel"; documentKind?: DocKind; documentId?: string; payload: Record<string, unknown>; naturalKey?: string }) {
  let documentId = args.documentId ?? null;
  if (args.kind === "issue") {
    if (!args.documentKind || !DOC_KINDS.includes(args.documentKind)) throw new Error("Tipo de documento inválido.");
    const ins = await db.from("fiscal_documents").insert({ owner_id: ownerId, company_id: args.companyId, direction: "issued", document_kind: args.documentKind, natural_key: args.naturalKey ?? `draft-${randomBytes(8).toString("hex")}` }).select("id").single();
    documentId = must(ins, "criar documento").id as string;
  } else {
    if (!documentId) throw new Error("Documento obrigatório para cancelar.");
    const j = args.payload.justificativa;
    if (typeof j !== "string" || j.length < 15 || j.length > 255) throw new Error("A justificativa do cancelamento deve ter de 15 a 255 caracteres.");
  }
  const r = await db.rpc("fiscal_operation_create", { p_owner: ownerId, p_company: args.companyId, p_document: documentId, p_kind: args.kind, p_payload: args.payload, p_created_by: userId });
  return { operationId: must(r, "preparar operação") as string, documentId: documentId as string };
}

function signingKey(): Buffer {
  const raw = process.env["FISCAL_AUTH_SIGNING_KEY"];
  if (!raw || raw.length < 32) throw new Error("Chave de assinatura das autorizações fiscais não configurada.");   // fail-closed
  return Buffer.from(raw);
}

export function signAuthorization(args: { operationId: string; payloadHash: string; authorizedBy: string; configVersion: number }): { signature: string; keyFingerprint: string } {
  const key = signingKey();
  const signature = createHmac("sha256", key).update(`${args.operationId}|${args.payloadHash}|${args.authorizedBy}|${args.configVersion}`).digest("hex");
  return { signature, keyFingerprint: createHash("sha256").update(key).digest("hex").slice(0, 12) };
}

export async function authorizeOperation(db: Db, ownerId: string, userId: string, operationId: string, ttlMinutes = 10) {
  const op = await db.from("fiscal_operations").select("id, owner_id, payload_hash, state").eq("id", operationId).maybeSingle();
  if (!op.data || op.data.owner_id !== ownerId) throw new Error("Operação não encontrada.");
  const { signature, keyFingerprint } = signAuthorization({ operationId, payloadHash: op.data.payload_hash as string, authorizedBy: userId, configVersion: 1 });
  const ttl = Math.min(Math.max(ttlMinutes, 1), 60);
  const r = await db.rpc("fiscal_authorization_issue", { p_operation: operationId, p_authorized_by: userId, p_payload_hash: op.data.payload_hash, p_config_version: 1, p_key_fingerprint: keyFingerprint, p_signature: signature, p_ttl: `${ttl} minutes` });
  return { authorizationId: must(r, "autorizar") as string };
}

export async function rejectOperation(db: Db, ownerId: string, userId: string, operationId: string) {
  const op = await db.from("fiscal_operations").select("id, owner_id, state, document_id, kind").eq("id", operationId).maybeSingle();
  if (!op.data || op.data.owner_id !== ownerId) throw new Error("Operação não encontrada.");
  if (op.data.state !== "awaiting_authorization") throw new Error("Só é possível rejeitar uma operação que aguarda autorização.");
  must(await db.from("fiscal_operations").update({ state: "failed_definitive", state_reason: "rejected_by_human" }).eq("id", operationId), "rejeitar");
  if (op.data.document_id) await db.from("fiscal_documents").update({ status: op.data.kind === "cancel" ? "authorized" : "rejected" }).eq("id", op.data.document_id).in("status", ["pending_issue", "cancel_requested"]);
  await audit(db, ownerId, userId, "operation_reject", "operation", operationId, {});
}

/** Executa o envio imediato (único modo): P → S1 → S2 → S3 → S4. */
export async function dispatchOperation(db: Db, ownerId: string, operationId: string, authorizationId: string, fetchImpl?: FetchLike): Promise<SendOutcome> {
  const { data: op } = await db.from("fiscal_operations").select("id, owner_id, company_id, kind, ref, payload, payload_hash, document_id").eq("id", operationId).maybeSingle();
  if (!op || op.owner_id !== ownerId) throw new Error("Operação não encontrada.");
  const { data: company } = await db.from("fiscal_companies").select("connection_id").eq("id", op.company_id).maybeSingle();
  const { data: doc } = op.document_id ? await db.from("fiscal_documents").select("document_kind").eq("id", op.document_id).maybeSingle() : { data: null };
  if (!company || !doc) throw new Error("Dados da operação incompletos.");
  const client = await focusFor(db, ownerId, company.connection_id as string, fetchImpl);
  const kind = doc.document_kind as FocusDocumentPath;
  const sessionUsers = (process.env["FISCAL_DISPATCH_SESSION_USERS"] ?? "authenticator").split(",").map((s) => s.trim()).filter(Boolean);
  const dispatchOwner = process.env["FISCAL_DISPATCH_OWNER"] ?? "postgres";
  const rpc = async (fn: string, args: Record<string, unknown>) => must(await db.rpc(fn, args), fn);

  return runSendSequence(
    {
      plan: async (id, v) => (await rpc("fiscal_attempt_plan", { p_operation: id, p_adapter_version: v })) as string,
      recordPayload: async (att, h, red) => void (await rpc("fiscal_attempt_record_payload", { p_attempt: att, p_body_hash: h, p_body_redacted: red })),
      markSent: async (att, auth) => (await rpc("fiscal_attempt_mark_sent", { p_attempt: att, p_authorization: auth, p_permitted_session_users: sessionUsers, p_dispatch_owner: dispatchOwner })) as { ok: boolean; reason?: string },
      markUnknown: async (att, reason) => void (await rpc("fiscal_attempt_mark_unknown", { p_attempt: att, p_reason: reason })),
      recordResponse: async (att, cls, st, h, red) => void (await rpc("fiscal_attempt_record_response", { p_attempt: att, p_response_class: cls, p_http_status: st, p_body_hash: h, p_body_redacted: red })),
      send: () => (op.kind === "cancel" ? client.cancel(kind, op.ref as string, (op.payload as { justificativa: string }).justificativa) : client.issue(kind, op.ref as string, op.payload)),
    },
    { operationId, authorizationId, payloadHash: op.payload_hash as string, redactedPayload: redactBody(op.payload), adapterVersion: ADAPTER_VERSION, hashBody, redactBody },
  );
}

/* ------------------------------------------------------------ reconciliação */

export async function reconcileCandidate(db: Db, ownerId: string, c: ReconcileCandidate, connectionId: string, fetchImpl?: FetchLike) {
  const client = await focusFor(db, ownerId, connectionId, fetchImpl);
  return reconcileOne(
    {
      query: (x) => client.query(x.documentKind, x.ref),
      applyQuery: async (op, result, st, proto, key, h, red) => void must(await db.rpc("fiscal_document_apply_query", { p_operation: op, p_result: result, p_provider_status: st, p_protocol: proto, p_access_key: key, p_body_hash: h, p_body_redacted: red }), "aplicar consulta"),
      hash: hashBody, redact: redactBody,
    },
    c,
  );
}

/** Varredura: marca `sent` órfão como desconhecido, consome webhooks pendentes e consulta candidatos. Nunca reenvia. */
export async function runReconciliation(db: Db, fetchImpl?: FetchLike, limit = 25) {
  const swept = Number(must(await db.rpc("fiscal_attempt_sweep_unknown", { p_threshold: "15 minutes" }), "varredura") ?? 0);
  const events = (must(await db.rpc("fiscal_webhook_claim", { p_limit: limit }), "claim") ?? []) as Array<{ id: string; ref: string | null; connection_id: string }>;
  let webhookOk = 0;
  for (const ev of events) {
    try {
      if (!ev.ref) { await db.rpc("fiscal_webhook_finish", { p_event: ev.id, p_status: "ignored" }); continue; }
      const op = (await db.from("fiscal_operations").select("id, owner_id, ref, kind, document_id").eq("ref", ev.ref).maybeSingle()).data;
      const doc = op?.document_id ? (await db.from("fiscal_documents").select("document_kind").eq("id", op.document_id).maybeSingle()).data : null;
      if (!op || !doc) { await db.rpc("fiscal_webhook_finish", { p_event: ev.id, p_status: "ignored" }); continue; }
      const r = await reconcileCandidate(db, op.owner_id as string, { operationId: op.id as string, ref: op.ref as string, documentKind: doc.document_kind as FocusDocumentPath, opKind: op.kind as string }, ev.connection_id, fetchImpl);
      await db.rpc("fiscal_webhook_finish", { p_event: ev.id, p_status: r.result === "transport_error" ? "error" : "processed", p_error: r.result === "transport_error" ? "transport_error" : null });
      if (r.result !== "transport_error") webhookOk++;
    } catch (e) {
      await db.rpc("fiscal_webhook_finish", { p_event: ev.id, p_status: "error", p_error: String((e as Error).message).slice(0, 200) });
    }
  }
  const cands = (must(await db.rpc("fiscal_reconcile_candidates", { p_stale: "2 minutes", p_limit: limit }), "candidatos") ?? []) as Array<{ operation_id: string; company_id: string; owner_id: string; document_kind: string; ref: string; op_kind: string }>;
  let queried = 0;
  for (const c of cands) {
    const { data: comp } = await db.from("fiscal_companies").select("connection_id").eq("id", c.company_id).maybeSingle();
    if (!comp) continue;
    await reconcileCandidate(db, c.owner_id, { operationId: c.operation_id, ref: c.ref, documentKind: c.document_kind as FocusDocumentPath, opKind: c.op_kind }, comp.connection_id as string, fetchImpl);
    queried++;
  }
  return { swept, webhookEvents: events.length, webhookOk, queried };
}

/* ------------------------------------------------------------------ leituras */

export async function listDocuments(db: Db, ownerId: string) {
  const { data } = await db.from("fiscal_documents").select("id, company_id, direction, document_kind, status, ref, protocol, authorized_at, created_at").eq("owner_id", ownerId).order("created_at", { ascending: false }).limit(200);
  return (data ?? []).map((d) => ({ id: d.id as string, companyId: d.company_id as string, direction: d.direction as string, kind: d.document_kind as string, status: d.status as string, ref: d.ref as string | null, protocol: d.protocol as string | null, authorizedAt: d.authorized_at as string | null, createdAt: d.created_at as string }));
}

export async function listOperations(db: Db, ownerId: string) {
  const { data } = await db.from("fiscal_operations").select("id, company_id, document_id, kind, state, state_reason, created_at, payload").eq("owner_id", ownerId).order("created_at", { ascending: false }).limit(200);
  return (data ?? []).map((o) => ({ id: o.id as string, companyId: o.company_id as string, documentId: o.document_id as string | null, kind: o.kind as string, state: o.state as string, stateReason: o.state_reason as string | null, createdAt: o.created_at as string, payloadText: JSON.stringify(redactBody(o.payload), null, 2) }));
}

export async function listAudit(db: Db, ownerId: string) {
  const { data } = await db.from("fiscal_audit").select("id, action, entity, entity_id, actor, created_at").eq("owner_id", ownerId).order("id", { ascending: false }).limit(200);
  return (data ?? []).map((a) => ({ id: Number(a.id), action: a.action as string, entity: a.entity as string, entityId: a.entity_id as string | null, actor: a.actor as string | null, at: a.created_at as string }));
}

async function audit(db: Db, ownerId: string, actor: string | null, action: string, entity: string, entityId: string | null, detail: Record<string, unknown>) {
  await db.from("fiscal_audit").insert({ owner_id: ownerId, actor, action, entity, entity_id: entityId, detail });
}
