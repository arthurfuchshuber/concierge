/**
 * Serviço fiscal (server-only). Toda escrita passa pelas funções atômicas do banco; o token da Focus fica cifrado;
 * nenhum ato fiscal remoto acontece sem autorização humana de uso único consumida pelo portão `fiscal_attempt_mark_sent`.
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptConnectionKey, encryptConnectionKey } from "@/lib/connection-key-crypto.server";
import { extractFileLinks, FocusClient, FocusTransportError, type FetchLike, type FocusDocumentPath, type FocusEnvironment } from "./focus/client";
import { buildCompanyBody, CertificateInputError, formatCertificateLabel, parseCertificateExpiry, scrubCertificate, validateCertificateInput } from "./certificate";
import { certificateAlert, contentType, FILE_URL_TTL_SECONDS, FISCAL_BUCKET, FiscalFileError, MAX_FILE_BYTES, filePath, sha256Bytes, validateFiscalFile, type CertificateAlert, type FileKind } from "./files";
import { requireFiscalAccess, type FiscalAction, type FiscalGuardPorts } from "./guard";
import { buildSetupCompanyFields, SetupInputError, type CompanySetupFields } from "./setup";
import { classifyProviderRejection, CompanyEditInput, PreferencesInput, ServiceInput } from "./window-data";
import { suggestServiceForCnae } from "./national-codes";
import { redactBody, hashBody } from "./redact";
import { reconcileOne, type ReconcileCandidate } from "./reconcile";
import { runSendSequence, type SendOutcome } from "./send-sequence";
import { sha256Hex } from "./webhook";
import type { FocusHttpResult } from "./types";

type Db = SupabaseClient;
const onlyDigitsStr = (v: string) => v.replace(/\D+/g, "");
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

/**
 * Resolve o cliente Focus de uma conexão. Conexão da PLATAFORMA (`owner_id` nulo) usa o token mestre de `process.env.FOCUSNFE_API`
 * (nunca gravado no banco). Ela só é aceita quando o chamador já derivou o id da empresa do próprio titular (`viaCompany`);
 * um id de conexão vindo do cliente nunca resolve para a conexão da plataforma.
 */
async function focusFor(db: Db, ownerId: string, connectionId: string, fetchImpl?: FetchLike, opts: { viaCompany?: boolean } = { viaCompany: true }): Promise<FocusClient> {
  const { data } = await db.from("fiscal_provider_connections").select("environment, secret_ref, status, owner_id").eq("id", connectionId).maybeSingle();
  const platform = !!data && data.owner_id === null;
  if (!data || (data.owner_id !== ownerId && !(platform && opts.viaCompany))) throw new Error("Conexão fiscal não encontrada.");
  if (data.status === "revoked" || data.status === "paused") throw new Error("Conexão fiscal desativada.");
  const fetchFn = fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  if (platform) {
    const master = process.env.FOCUSNFE_API?.trim();
    if (!master) throw new Error("Módulo fiscal indisponível no momento.");
    return new FocusClient({ environment: data.environment as FocusEnvironment, token: master, fetch: fetchFn });
  }
  const ct = (data.secret_ref as { ct?: string } | null)?.ct;
  if (!ct) throw new Error("Token da conexão não configurado.");
  return new FocusClient({ environment: data.environment as FocusEnvironment, token: decryptConnectionKey(ct), fetch: fetchFn });
}

/**
 * Conexão Mestre da Plataforma (`owner_id` nulo, produção). Existe só como referência: o token vem de `FOCUSNFE_API` e NÃO é gravado
 * (`secret_ref` nulo; guarda-se apenas a impressão digital). Idempotente.
 */
export async function ensurePlatformConnection(db: Db): Promise<{ id: string }> {
  const master = process.env.FOCUSNFE_API?.trim();
  if (!master) throw new Error("Módulo fiscal indisponível no momento.");
  const now = new Date().toISOString();
  const existing = await db.from("fiscal_provider_connections").select("id, status").is("owner_id", null).eq("environment", "production").maybeSingle();
  if (existing.data?.id) {
    if (existing.data.status !== "active") must(await db.from("fiscal_provider_connections").update({ status: "active", last_error_code: null, updated_at: now }).eq("id", existing.data.id), "reativar conexão da plataforma");
    return { id: existing.data.id as string };
  }
  const ins = must(await db.from("fiscal_provider_connections").insert({ owner_id: null, provider: "focus", environment: "production", status: "active", base_url: "https://api.focusnfe.com.br", secret_ref: null, token_fingerprint: tokenFingerprint(master) }).select("id").single(), "criar conexão da plataforma") as { id: string };
  return { id: ins.id };
}

/** Teste de credencial SEM efeito fiscal: consulta uma ref que não existe. 404 ⇒ autenticou; 401/403 ⇒ token recusado. */
export async function testConnection(db: Db, ownerId: string, connectionId: string, fetchImpl?: FetchLike): Promise<{ ok: boolean; code: string }> {
  const client = await focusFor(db, ownerId, connectionId, fetchImpl, { viaCompany: false });
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

/* ------------------------------------------- arquivos fiscais (guarda de 5 anos) */

/**
 * Grava XML/PDF de um documento no bucket PRIVADO e registra metadados. Idempotente por (documento, tipo, sha256).
 * O objeto sobe primeiro; se o registro falhar, o objeto é removido (nada órfão).
 */
export async function storeDocumentFile(db: Db, ownerId: string, userId: string | null, args: { documentId: string; kind: FileKind; bytes: Uint8Array }): Promise<{ id: string; created: boolean }> {
  validateFiscalFile(args.kind, args.bytes);
  const { data: doc } = await db.from("fiscal_documents").select("id, company_id").eq("id", args.documentId).eq("owner_id", ownerId).maybeSingle();
  if (!doc) throw new Error("Documento fiscal não encontrado.");
  const sha = sha256Bytes(args.bytes);
  const path = filePath({ ownerId, companyId: doc.company_id as string, documentId: args.documentId, kind: args.kind, sha256: sha });
  const dup = await db.from("fiscal_document_files").select("id").eq("document_id", args.documentId).eq("kind", args.kind).eq("sha256", sha).maybeSingle();
  if (dup.data?.id) return { id: dup.data.id as string, created: false };
  const up = await db.storage.from(FISCAL_BUCKET).upload(path, args.bytes, { contentType: contentType(args.kind), upsert: false });
  if (up.error) throw new Error("Falha ao gravar o arquivo fiscal.");
  const ins = await db.from("fiscal_document_files").insert({ owner_id: ownerId, company_id: doc.company_id, document_id: args.documentId, kind: args.kind, storage_path: path, sha256: sha, size_bytes: args.bytes.byteLength }).select("id").single();
  if (ins.error) {
    await db.storage.from(FISCAL_BUCKET).remove([path]);
    throw new Error("Falha ao registrar o arquivo fiscal.");
  }
  await audit(db, ownerId, userId, "document_file_store", "document", args.documentId, { kind: args.kind, sha256: sha, size: args.bytes.byteLength });
  return { id: ins.data.id as string, created: true };
}

/**
 * Captura XML/PDF de um documento AUTORIZADO: consulta o provedor (única fonte), lê `caminho_xml_nota_fiscal` e
 * `caminho_danfe`/`caminho_pdf`, baixa só de hosts da Focus e grava no bucket privado. Idempotente; falha de um arquivo
 * não impede o outro. Nunca altera o estado fiscal do documento.
 */
export async function captureDocumentFiles(db: Db, ownerId: string, documentId: string, fetchImpl?: FetchLike): Promise<{ stored: FileKind[]; skipped: Array<{ kind: FileKind; reason: string }> }> {
  const { data: doc } = await db.from("fiscal_documents").select("id, company_id, document_kind, status, ref").eq("id", documentId).eq("owner_id", ownerId).maybeSingle();
  if (!doc) throw new Error("Documento fiscal não encontrado.");
  if (doc.status !== "authorized" || !doc.ref) throw new Error("Só documentos autorizados têm arquivos.");
  const { data: comp } = await db.from("fiscal_companies").select("connection_id").eq("id", doc.company_id).eq("owner_id", ownerId).maybeSingle();
  if (!comp) throw new Error("Empresa fiscal não encontrada.");
  const client = await focusFor(db, ownerId, comp.connection_id as string, fetchImpl);
  const q = await client.query(doc.document_kind as FocusDocumentPath, doc.ref as string);
  const links = extractFileLinks(q.body);
  const stored: FileKind[] = [];
  const skipped: Array<{ kind: FileKind; reason: string }> = [];
  for (const kind of ["xml", "pdf"] as const) {
    const link = links[kind];
    if (!link) { skipped.push({ kind, reason: "link_ausente" }); continue; }
    try {
      const f = await client.fetchFile(link, MAX_FILE_BYTES);
      if ("rejected" in f) { skipped.push({ kind, reason: f.rejected }); continue; }
      if (f.status < 200 || f.status >= 300) { skipped.push({ kind, reason: `http_${f.status}` }); continue; }
      await storeDocumentFile(db, ownerId, null, { documentId, kind, bytes: f.bytes });
      stored.push(kind);
    } catch (e) {
      skipped.push({ kind, reason: e instanceof FocusTransportError ? e.reason : e instanceof FiscalFileError ? e.code : "erro" });
    }
  }
  await audit(db, ownerId, null, "document_files_capture", "document", documentId, { stored, skipped });
  return { stored, skipped };
}

export async function listDocumentFiles(db: Db, ownerId: string, documentId: string) {
  const { data } = await db.from("fiscal_document_files").select("id, kind, sha256, size_bytes, created_at, retain_until").eq("owner_id", ownerId).eq("document_id", documentId).order("created_at", { ascending: false });
  return (data ?? []).map((f) => ({ id: f.id as string, kind: f.kind as FileKind, sizeBytes: Number(f.size_bytes), createdAt: f.created_at as string, retainUntil: f.retain_until as string }));
}

/** Link assinado de 60 s para o titular baixar o XML/PDF da NOTA (nunca o certificado). Cada emissão de link é auditada. */
export async function documentFileSignedUrl(db: Db, ownerId: string, userId: string, fileId: string): Promise<{ url: string; expiresInSeconds: number }> {
  const { data: f } = await db.from("fiscal_document_files").select("id, storage_path, kind, document_id").eq("id", fileId).eq("owner_id", ownerId).maybeSingle();
  if (!f) throw new Error("Arquivo fiscal não encontrado.");
  const s = await db.storage.from(FISCAL_BUCKET).createSignedUrl(f.storage_path as string, FILE_URL_TTL_SECONDS);
  if (s.error || !s.data?.signedUrl) throw new Error("Não foi possível gerar o link do arquivo.");
  await audit(db, ownerId, userId, "document_file_url", "document", f.document_id as string, { kind: f.kind });
  return { url: s.data.signedUrl, expiresInSeconds: FILE_URL_TTL_SECONDS };
}

/** Projeção pública: só metadados operacionais. Nunca token da sub-empresa, inscrições, certificado ou senha. */
export type FiscalStatusPublic = {
  companies: Array<{
    companyId: string;
    status: "Ativa" | "Homologação" | "Pendente";
    legalName: string;
    tradeName: string | null;
    taxId: string;
    municipalRegistration: string | null;
    email: string | null;
    phone: string | null;
    simples: "nao_optante" | "mei" | "me_epp" | null;
    cnae: { code: string; description: string } | null;
    specialRegime: number;
    dpsSeries: string;
    dpsNextNumber: number;
    preferences: { approximateTaxes: "none" | "included"; invoiceNote: string | null; withholdingTextIr: string | null; withholdingTextCsrf: string | null; withholdingTextInss: string | null };
    certificateValidUntil: string | null;
    certificateLabel: string | null;
    certificateAlert: CertificateAlert;
    canReplaceCertificate: true;
  }>;
};

const COMPANY_PUBLIC_COLS = "id, tax_id, legal_name, trade_name, status, connection_id, certificate_valid_until, municipal_registration, contact_email, contact_phone, simples_option, cnae_code, cnae_description, special_regime, dps_series, dps_next_number, approximate_taxes, invoice_note, withholding_text_ir, withholding_text_csrf, withholding_text_inss";

export async function getFiscalStatusPublic(db: Db, ownerId: string): Promise<FiscalStatusPublic> {
  const { data: comps } = await db.from("fiscal_companies").select(COMPANY_PUBLIC_COLS).eq("owner_id", ownerId).is("soft_deleted_at", null).order("created_at");
  const { data: conns } = await db.from("fiscal_provider_connections").select("id, environment, status, owner_id").or(`owner_id.eq.${ownerId},owner_id.is.null`);
  const byId = new Map((conns ?? []).map((c) => [c.id as string, c]));
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    companies: (comps ?? []).filter((c) => c.status !== "deactivated").map((c) => {
      const conn = byId.get(c.connection_id as string);
      const live = c.status === "active" && conn?.status === "active";
      const status = !live ? "Pendente" : conn?.environment === "production" ? "Ativa" : "Homologação";
      const until = (c.certificate_valid_until as string | null) ?? null;
      return {
        companyId: c.id as string, status, legalName: c.legal_name as string, tradeName: (c.trade_name as string | null) ?? null, taxId: c.tax_id as string,
        municipalRegistration: str(c.municipal_registration), email: str(c.contact_email), phone: str(c.contact_phone),
        simples: (str(c.simples_option) as "nao_optante" | "mei" | "me_epp" | null),
        cnae: str(c.cnae_code) ? { code: c.cnae_code as string, description: str(c.cnae_description) ?? "" } : null,
        specialRegime: Number(c.special_regime ?? 0), dpsSeries: (str(c.dps_series) ?? "1"), dpsNextNumber: Number(c.dps_next_number ?? 1),
        preferences: { approximateTaxes: c.approximate_taxes === "included" ? "included" : "none", invoiceNote: str(c.invoice_note), withholdingTextIr: str(c.withholding_text_ir), withholdingTextCsrf: str(c.withholding_text_csrf), withholdingTextInss: str(c.withholding_text_inss) },
        certificateValidUntil: until, certificateLabel: formatCertificateLabel(until), certificateAlert: certificateAlert(until), canReplaceCertificate: true as const,
      };
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
    const { data: conn } = await db.from("fiscal_provider_connections").select("environment").eq("id", co.connection_id).maybeSingle();
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

/**
 * Ativação de ponta a ponta pelo titular (White-Label): habilita o módulo para a própria conta, valida os dados, envia empresa +
 * certificado A1 à Focus (POST /v2/empresas, conexão mestre da plataforma) e SÓ DEPOIS registra a empresa como ativa.
 * O `.pfx` e a senha vivem apenas nesta requisição: não são gravados, logados nem devolvidos; erros passam por `scrubCertificate`.
 * Retorna somente metadados públicos. `dryRun` (opcional) simula na Focus sem criar a empresa e não grava nada local.
 */
export async function setupCompanyWithCertificate(
  db: Db, userId: string,
  args: CompanySetupFields & { pfxBase64: string; password: string; dryRun?: boolean },
  fetchImpl?: FetchLike,
): Promise<{ ok: true; certificateValidUntil: string | null; legalName: string; dryRun: boolean; webhook?: TenantWebhookState } | { ok: false; code: string }> {
  const ownerId = userId; // owner_only: a conta é sempre a do próprio usuário autenticado
  const { pfxBase64, password } = args;
  const dryRun = args.dryRun === true;
  try {
    await requireFiscalAccess({ moduleEnabled: async () => true }, { userId, ownerId, action: "empresas.ativar" });
    const f = buildSetupCompanyFields(args);
    validateCertificateInput(pfxBase64, password);
    const body = buildCompanyBody(f.providerFields, pfxBase64, password, f.taxId);

    // CNPJ já cadastrado em OUTRA conta: recusa antes de qualquer chamada externa.
    const dup = await db.from("fiscal_companies").select("id, owner_id").eq("tax_id", f.taxId).is("soft_deleted_at", null).maybeSingle();
    if (dup.data && dup.data.owner_id !== ownerId) return { ok: false, code: "cnpj_in_use" };

    const conn = await ensurePlatformConnection(db);
    const client = await focusFor(db, ownerId, conn.id, fetchImpl);
    let res: FocusHttpResult;
    try { res = await client.registerCompany(body, { dryRun }); }
    catch (e) {
      const code = e instanceof FocusTransportError ? e.reason : "unreachable";
      await audit(db, ownerId, userId, "company_setup_error", "company", null, { dryRun, code });
      return { ok: false, code };
    }
    const ok = res.status >= 200 && res.status < 300;
    await audit(db, ownerId, userId, dryRun ? "company_setup_dry_run" : "company_setup", "company", dup.data?.id ?? null, { dryRun, httpStatus: res.status });
    // Focus recusou ⇒ nada é registrado (o código estável alimenta a faixa de erro da janela).
    if (!ok) return { ok: false, code: classifyProviderRejection(res.status, res.body) };
    const until = parseCertificateExpiry(res.body);
    if (dryRun) return { ok: true, certificateValidUntil: until, legalName: f.legalName, dryRun: true };

    // Aprovada pela Focus: habilita o módulo para esta conta (incluído no plano) e registra a empresa.
    const now = new Date().toISOString();
    must(await db.from("fiscal_tenant_enablement").upsert({ owner_id: ownerId, enabled: true, enabled_by: userId, enabled_at: now, note: "ativado pelo titular (incluído no plano)", updated_at: now }, { onConflict: "owner_id" }), "habilitar módulo");
    const meta = {
      municipal_registration: args.municipalRegistration.trim(), contact_email: f.contact.email, contact_phone: f.contact.phone,
      simples_option: args.simples ?? null, cnae_code: args.cnaeCode ? onlyDigitsStr(args.cnaeCode) : null, cnae_description: args.cnaeDescription?.trim() || null,
      ibge_city_code: args.ibgeCityCode ? onlyDigitsStr(args.ibgeCityCode) : null,
    };
    const row = { connection_id: conn.id, legal_name: f.legalName, trade_name: f.tradeName, status: "active", certificate_valid_until: until, certificate_updated_at: now, updated_at: now, ...meta };
    let companyId: string;
    if (dup.data?.id) { companyId = dup.data.id as string; must(await db.from("fiscal_companies").update(row).eq("id", companyId).eq("owner_id", ownerId), "atualizar empresa"); }
    else {
      const ins = await db.from("fiscal_companies").insert({ owner_id: ownerId, tax_id: f.taxId, ...row }).select("id").single();
      if (ins.error) throw new Error(ins.error.code === "23505" ? "cnpj_in_use" : `registrar empresa: ${ins.error.message}`);
      companyId = ins.data.id as string;
      await audit(db, ownerId, userId, "company_create", "company", companyId, {});
    }
    // Empresa já ativa na Focus: webhook automático e carga única. Falha aqui não desfaz a ativação (fica registrada e reexecutável).
    let webhook: TenantWebhookState = "failed";
    try {
      const wh = await ensureTenantWebhook(db, ownerId, userId, f.taxId, client);
      webhook = wh.state;
      // Blindagem da janela: a carga SÓ roda com o webhook já ativo (webhook primeiro, carga depois). Se o cadastro do webhook falhou,
      // a carga não é consumida e continua devida na próxima ativação/renovação: nunca há período sem cobertura declarada como completo.
      if (wh.connectionId && wh.state !== "failed") await runInitialSync(db, ownerId, userId, companyId, wh.connectionId, fetchImpl);
    } catch (e) {
      await audit(db, ownerId, userId, "company_post_setup_error", "company", companyId, { code: scrubCertificate(String((e as Error)?.message ?? e), pfxBase64, password).slice(0, 80) });
    }
    return { ok: true, certificateValidUntil: until, legalName: f.legalName, dryRun: false, webhook };
  } catch (e) {
    if (e instanceof CertificateInputError || e instanceof SetupInputError) return { ok: false, code: e.code };
    if ((e as { code?: string }).code === "not_owner") return { ok: false, code: "not_owner" };
    const msg = scrubCertificate(String((e as Error)?.message ?? e), pfxBase64, password);
    if (msg === "cnpj_in_use") return { ok: false, code: "cnpj_in_use" };
    throw new Error(msg);
  }
}

/* ------------------------------------------- webhook por tenant e carga inicial */

/** Eventos da Focus assinados no cadastro automático (autorização e cancelamento chegam pelo mesmo gatilho do tipo de documento). */
export const HOOK_EVENTS = ["nfse", "nfsen", "nfe"] as const;
export function webhookBaseUrl(): string { return (process.env.FISCAL_WEBHOOK_BASE_URL?.trim() || "https://conciergeia.app").replace(/\/+$/, ""); }

export type TenantWebhookState = "registered" | "already" | "failed";

/**
 * Cadastra o webhook do tenant na Focus (`POST /v2/hooks`) SEM nenhum passo manual. Cada tenant tem a sua linha de conexão
 * (`owner_id` = titular, produção, sem token) que guarda só o HASH do segredo; a URL com o segredo existe apenas nesta chamada
 * e nunca é gravada, logada ou devolvida. Se já houver webhook ativo, não faz nada (o segredo não é recuperável por desenho).
 * Falha no cadastro NÃO desfaz a ativação: a conexão fica `pending` e a próxima ativação/renovação tenta de novo com segredo novo.
 */
export async function ensureTenantWebhook(db: Db, ownerId: string, userId: string, cnpj: string, client: FocusClient): Promise<{ state: TenantWebhookState; connectionId: string | null; code?: string }> {
  const ex = await db.from("fiscal_provider_connections").select("id, status, webhook_secret_hash").eq("owner_id", ownerId).eq("environment", "production").maybeSingle();
  if (ex.data?.id && ex.data.status === "active" && ex.data.webhook_secret_hash) return { state: "already", connectionId: ex.data.id as string };
  const secret = randomBytes(24).toString("base64url");
  const now = new Date().toISOString();
  const state = { status: "pending", webhook_secret_hash: sha256Hex(secret), last_error_code: null as string | null, updated_at: now };
  let id = (ex.data?.id as string | undefined) ?? null;
  if (id) must(await db.from("fiscal_provider_connections").update(state).eq("id", id).eq("owner_id", ownerId), "preparar webhook");
  else {
    const ins = must(await db.from("fiscal_provider_connections").insert({ owner_id: ownerId, provider: "focus", environment: "production", base_url: "https://api.focusnfe.com.br", secret_ref: null, token_fingerprint: null, ...state }).select("id").single(), "criar conexão do tenant") as { id: string };
    id = ins.id;
  }
  const url = `${webhookBaseUrl()}/api/public/webhooks/fiscal/${id}/${secret}`;
  const failures: string[] = [];
  for (const event of HOOK_EVENTS) {
    try {
      const r = await client.registerHook({ cnpj, event, url });
      if (r.status < 200 || r.status >= 300) failures.push(`${event}:http_${r.status}`);
    } catch (e) {
      failures.push(`${event}:${e instanceof FocusTransportError ? e.reason : "unreachable"}`);
    }
  }
  const ok = failures.length === 0;
  await db.from("fiscal_provider_connections").update(ok ? { status: "active", last_ok_at: now, last_error_code: null, updated_at: now } : { last_error_code: `hook_${failures[0]}`.slice(0, 60), updated_at: now }).eq("id", id).eq("owner_id", ownerId);
  await audit(db, ownerId, userId, ok ? "webhook_register" : "webhook_register_error", "connection", id, { events: [...HOOK_EVENTS], failures });
  return ok ? { state: "registered", connectionId: id } : { state: "failed", connectionId: id, code: `hook_${failures[0]}` };
}

/**
 * Carga retroativa ÚNICA do onboarding. O direito de rodar é tomado de forma atômica (`initial_sync_at` nulo ⇒ agora): corre no
 * máximo uma vez por tenant, nunca periodicamente, e renovar o certificado não a repete. Guarda XML/PDF dos documentos autorizados
 * deste tenant que ainda não os têm. Importar notas emitidas FORA do ConciergeIA depende de endpoint de listagem da Focus ainda
 * não confirmado (a API de backups entrega .zip mensal): fica registrado no relatório, sem inventar.
 */
export async function runInitialSync(db: Db, ownerId: string, userId: string, companyId: string, connectionId: string, fetchImpl?: FetchLike): Promise<{ ran: boolean; documents: number; stored: number }> {
  const now = new Date().toISOString();
  const claim = await db.from("fiscal_provider_connections").update({ initial_sync_at: now }).eq("id", connectionId).eq("owner_id", ownerId).is("initial_sync_at", null).select("id");
  if (!claim.data || claim.data.length === 0) return { ran: false, documents: 0, stored: 0 };
  let documents = 0, stored = 0;
  try {
    const { data: docs } = await db.from("fiscal_documents").select("id").eq("owner_id", ownerId).eq("company_id", companyId).eq("status", "authorized").eq("direction", "issued").limit(500);
    for (const d of docs ?? []) {
      documents++;
      try { const r = await captureDocumentFiles(db, ownerId, d.id as string, fetchImpl); stored += r.stored.length; } catch { /* um documento não impede os demais */ }
    }
    // Eventos que chegaram entre o cadastro do webhook e esta carga (ou falharam) são consumidos agora: nenhuma janela fica descoberta.
    const drained = await drainPendingEvents(db, connectionId, 100, fetchImpl);
    await audit(db, ownerId, userId, "initial_sync", "company", companyId, { documents, stored, drained });
  } catch (e) {
    await audit(db, ownerId, userId, "initial_sync_error", "company", companyId, { code: String((e as Error)?.message ?? e).slice(0, 80) });
  }
  return { ran: true, documents, stored };
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
  const out = await reconcileOne(
    {
      query: (x) => client.query(x.documentKind, x.ref),
      applyQuery: async (op, result, st, proto, key, h, red) => void must(await db.rpc("fiscal_document_apply_query", { p_operation: op, p_result: result, p_provider_status: st, p_protocol: proto, p_access_key: key, p_body_hash: h, p_body_redacted: red }), "aplicar consulta"),
      hash: hashBody, redact: redactBody,
    },
    c,
  );
  // Melhor esforço: nota recém-autorizada ⇒ guardar XML/PDF. Falha aqui nunca afeta o estado fiscal (há varredura de reparo).
  if (out.result === "authorized") {
    try {
      const op = (await db.from("fiscal_operations").select("document_id").eq("id", c.operationId).maybeSingle()).data;
      if (op?.document_id) await captureDocumentFiles(db, ownerId, op.document_id as string, fetchImpl);
    } catch { /* reparado pela varredura */ }
  }
  return out;
}

/** Reparo: documentos autorizados sem XML ou sem PDF guardados. */
export async function repairMissingFiles(db: Db, fetchImpl?: FetchLike, limit = 10): Promise<number> {
  const { data: docs } = await db.from("fiscal_documents").select("id, owner_id").eq("status", "authorized").eq("direction", "issued").order("authorized_at", { ascending: false }).limit(50);
  let n = 0;
  for (const d of docs ?? []) {
    if (n >= limit) break;
    const { data: files } = await db.from("fiscal_document_files").select("kind").eq("document_id", d.id);
    const kinds = new Set((files ?? []).map((f) => f.kind as string));
    if (kinds.has("xml") && kinds.has("pdf")) continue;
    try { await captureDocumentFiles(db, d.owner_id as string, d.id as string, fetchImpl); } catch { /* tenta de novo na próxima */ }
    n++;
  }
  return n;
}

export type WebhookEventRow = { id: string; ref: string | null; connection_id: string; owner_id?: string | null };

/**
 * Processa UM evento de webhook já gravado: acha a operação pela `ref`, consulta a Focus (única fonte do estado), guarda XML/PDF e
 * marca o evento. Usado na hora em que o webhook chega (sem varredura periódica) e pela reconciliação manual. O corpo recebido só
 * serve de dica; evento cujo tenant não bate com o da operação é ignorado (isolamento multi-tenant).
 */
export async function processWebhookEvent(db: Db, ev: WebhookEventRow, fetchImpl?: FetchLike): Promise<"processed" | "ignored" | "error"> {
  const finish = async (status: "processed" | "ignored" | "error", error?: string) => { await db.rpc("fiscal_webhook_finish", { p_event: ev.id, p_status: status, p_error: error ?? null }); return status; };
  try {
    if (!ev.ref) return await finish("ignored");
    const op = (await db.from("fiscal_operations").select("id, owner_id, ref, kind, document_id, company_id").eq("ref", ev.ref).maybeSingle()).data;
    const doc = op?.document_id ? (await db.from("fiscal_documents").select("document_kind").eq("id", op.document_id).maybeSingle()).data : null;
    if (!op || !doc) return await finish("ignored");
    if (ev.owner_id && ev.owner_id !== op.owner_id) return await finish("ignored");
    const comp = (await db.from("fiscal_companies").select("connection_id").eq("id", op.company_id).eq("owner_id", op.owner_id).maybeSingle()).data;
    if (!comp) return await finish("ignored");
    const r = await reconcileCandidate(db, op.owner_id as string, { operationId: op.id as string, ref: op.ref as string, documentKind: doc.document_kind as FocusDocumentPath, opKind: op.kind as string }, comp.connection_id as string, fetchImpl);
    return r.result === "transport_error" ? await finish("error", "transport_error") : await finish("processed");
  } catch (e) {
    return await finish("error", String((e as Error).message).slice(0, 200));
  }
}

/**
 * Eventos `pending` de UMA conexão (ex.: chegaram durante a ativação ou falharam no processamento imediato). Sem cron: roda na carga
 * inicial e como autocura a cada webhook novo, para que nenhum evento fique esquecido.
 */
export async function drainPendingEvents(db: Db, connectionId: string, limit: number, fetchImpl?: FetchLike, exceptEventId?: string): Promise<number> {
  const { data } = await db.from("fiscal_webhook_events").select("id, ref, connection_id, owner_id").eq("connection_id", connectionId).eq("status", "pending").order("received_at").limit(limit + 1);
  let n = 0;
  for (const ev of (data ?? []) as WebhookEventRow[]) {
    if (ev.id === exceptEventId || n >= limit) continue;
    await processWebhookEvent(db, ev, fetchImpl);
    n++;
  }
  return n;
}

/** Processamento imediato a partir do id do evento recém-gravado (rota do webhook), seguido de autocura dos pendentes da mesma conexão. */
export async function processWebhookEventById(db: Db, eventId: string, fetchImpl?: FetchLike): Promise<void> {
  const { data } = await db.from("fiscal_webhook_events").select("id, ref, connection_id, owner_id").eq("id", eventId).eq("status", "pending").maybeSingle();
  if (!data) return;
  await processWebhookEvent(db, data as WebhookEventRow, fetchImpl);
  try { await drainPendingEvents(db, (data as WebhookEventRow).connection_id, 5, fetchImpl, eventId); } catch { /* melhor esforço */ }
}

/** Varredura: marca `sent` órfão como desconhecido, consome webhooks pendentes e consulta candidatos. Nunca reenvia. */
export async function runReconciliation(db: Db, fetchImpl?: FetchLike, limit = 25) {
  const swept = Number(must(await db.rpc("fiscal_attempt_sweep_unknown", { p_threshold: "15 minutes" }), "varredura") ?? 0);
  const events = (must(await db.rpc("fiscal_webhook_claim", { p_limit: limit }), "claim") ?? []) as WebhookEventRow[];
  let webhookOk = 0;
  for (const ev of events) if ((await processWebhookEvent(db, ev, fetchImpl)) === "processed") webhookOk++;
  const cands = (must(await db.rpc("fiscal_reconcile_candidates", { p_stale: "2 minutes", p_limit: limit }), "candidatos") ?? []) as Array<{ operation_id: string; company_id: string; owner_id: string; document_kind: string; ref: string; op_kind: string }>;
  let queried = 0;
  for (const c of cands) {
    const { data: comp } = await db.from("fiscal_companies").select("connection_id").eq("id", c.company_id).maybeSingle();
    if (!comp) continue;
    await reconcileCandidate(db, c.owner_id, { operationId: c.operation_id, ref: c.ref, documentKind: c.document_kind as FocusDocumentPath, opKind: c.op_kind }, comp.connection_id as string, fetchImpl);
    queried++;
  }
  const repaired = await repairMissingFiles(db, fetchImpl);
  return { swept, webhookEvents: events.length, webhookOk, queried, repaired };
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


/* ----------------------------------------------- janelas: dados, serviços, preferências */

async function ownCompany(db: Db, ownerId: string, companyId: string) {
  const { data } = await db.from("fiscal_companies").select("id, tax_id, connection_id, status, cnae_code").eq("id", companyId).eq("owner_id", ownerId).is("soft_deleted_at", null).maybeSingle();
  if (!data) throw new Error("not_found");
  return data as { id: string; tax_id: string; connection_id: string; status: string; cnae_code: string | null };
}

/** "Editar dados" (Empresa/Fiscal/Avançado). Dados cadastrais vão ao provedor primeiro; só grava local se ele aceitar. */
export async function updateCompanyData(db: Db, ownerId: string, userId: string, companyId: string, input: unknown, fetchImpl?: FetchLike): Promise<{ ok: true } | { ok: false; code: string }> {
  const d = CompanyEditInput.parse(input);
  const co = await ownCompany(db, ownerId, companyId);
  const providerBody: Record<string, unknown> = { inscricao_municipal: d.municipalRegistration, ...(d.tradeName ? { nome_fantasia: d.tradeName } : {}), ...(d.email ? { email: d.email } : {}), ...(d.phone ? { telefone: d.phone } : {}) };
  try {
    const client = await focusFor(db, ownerId, co.connection_id, fetchImpl);
    const res = await client.updateCompany(co.tax_id, providerBody);
    if (res.status < 200 || res.status >= 300) { await audit(db, ownerId, userId, "company_update_rejected", "company", companyId, { httpStatus: res.status }); return { ok: false, code: classifyProviderRejection(res.status, res.body) }; }
  } catch (e) {
    return { ok: false, code: e instanceof FocusTransportError ? e.reason : "unreachable" };
  }
  must(await db.from("fiscal_companies").update({
    trade_name: d.tradeName || null, municipal_registration: d.municipalRegistration, contact_email: d.email ?? null, contact_phone: d.phone ?? null,
    special_regime: d.specialRegime, dps_series: d.dpsSeries, dps_next_number: d.dpsNextNumber, updated_at: new Date().toISOString(),
  }).eq("id", companyId).eq("owner_id", ownerId), "editar empresa");
  await audit(db, ownerId, userId, "company_update", "company", companyId, {});
  return { ok: true };
}

export async function savePreferences(db: Db, ownerId: string, userId: string, companyId: string, input: unknown): Promise<{ ok: true }> {
  const p = PreferencesInput.parse(input);
  await ownCompany(db, ownerId, companyId);
  must(await db.from("fiscal_companies").update({
    approximate_taxes: p.approximateTaxes, invoice_note: p.invoiceNote || null, withholding_text_ir: p.withholdingTextIr || null,
    withholding_text_csrf: p.withholdingTextCsrf || null, withholding_text_inss: p.withholdingTextInss || null, updated_at: new Date().toISOString(),
  }).eq("id", companyId).eq("owner_id", ownerId), "salvar preferências");
  await audit(db, ownerId, userId, "company_preferences", "company", companyId, {});
  return { ok: true };
}

const SERVICE_COLS = "id, national_code, service_code, nbs_code, description, is_default, inss_pct, ir_pct, cst, cclass_trib, operation_indicator";
export type FiscalServicePublic = { id: string; nationalCode: string; serviceCode: string | null; nbsCode: string | null; description: string; isDefault: boolean; inssPct: number | null; irPct: number | null; cst: string | null; cclassTrib: string | null; operationIndicator: string | null };
const toService = (r: Record<string, unknown>): FiscalServicePublic => ({
  id: r.id as string, nationalCode: r.national_code as string, serviceCode: (r.service_code as string | null) ?? null, nbsCode: (r.nbs_code as string | null) ?? null,
  description: r.description as string, isDefault: r.is_default === true, inssPct: r.inss_pct == null ? null : Number(r.inss_pct), irPct: r.ir_pct == null ? null : Number(r.ir_pct),
  cst: (r.cst as string | null) ?? null, cclassTrib: (r.cclass_trib as string | null) ?? null, operationIndicator: (r.operation_indicator as string | null) ?? null,
});

export async function listServices(db: Db, ownerId: string, companyId: string): Promise<{ items: FiscalServicePublic[]; suggestion: ReturnType<typeof suggestServiceForCnae> }> {
  const co = await ownCompany(db, ownerId, companyId);
  const { data } = await db.from("fiscal_services").select(SERVICE_COLS).eq("company_id", companyId).eq("owner_id", ownerId).is("soft_deleted_at", null).order("is_default", { ascending: false }).order("created_at");
  const items = (data ?? []).map(toService);
  return { items, suggestion: items.length ? null : suggestServiceForCnae(co.cnae_code) };
}

const serviceRow = (i: ServiceInput) => ({
  national_code: i.nationalCode, service_code: i.serviceCode, nbs_code: i.nbsCode, description: i.description, is_default: i.isDefault,
  inss_pct: i.inssPct ?? null, ir_pct: i.irPct ?? null, cst: i.cst, cclass_trib: i.cclassTrib, operation_indicator: i.operationIndicator, updated_at: new Date().toISOString(),
});

/** Só um serviço padrão por empresa; o primeiro serviço vira padrão automaticamente. */
async function clearOtherDefaults(db: Db, ownerId: string, companyId: string, exceptId: string | null) {
  let q = db.from("fiscal_services").update({ is_default: false, updated_at: new Date().toISOString() }).eq("company_id", companyId).eq("owner_id", ownerId).eq("is_default", true).is("soft_deleted_at", null);
  if (exceptId) q = q.neq("id", exceptId);
  must(await q, "limpar padrão");
}

export async function createService(db: Db, ownerId: string, userId: string, companyId: string, input: unknown): Promise<FiscalServicePublic> {
  const i = ServiceInput.parse(input);
  await ownCompany(db, ownerId, companyId);
  const { count } = await db.from("fiscal_services").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("owner_id", ownerId).is("soft_deleted_at", null);
  const makeDefault = i.isDefault || !count;
  if (makeDefault) await clearOtherDefaults(db, ownerId, companyId, null);
  const ins = await db.from("fiscal_services").insert({ owner_id: ownerId, company_id: companyId, ...serviceRow({ ...i, isDefault: makeDefault }) }).select(SERVICE_COLS).single();
  if (ins.error) throw new Error(`criar serviço: ${ins.error.message}`);
  await audit(db, ownerId, userId, "service_create", "service", ins.data.id as string, {});
  return toService(ins.data as Record<string, unknown>);
}

export async function updateService(db: Db, ownerId: string, userId: string, companyId: string, serviceId: string, input: unknown): Promise<FiscalServicePublic> {
  const i = ServiceInput.parse(input);
  await ownCompany(db, ownerId, companyId);
  if (i.isDefault) await clearOtherDefaults(db, ownerId, companyId, serviceId);
  const up = await db.from("fiscal_services").update(serviceRow(i)).eq("id", serviceId).eq("company_id", companyId).eq("owner_id", ownerId).is("soft_deleted_at", null).select(SERVICE_COLS).maybeSingle();
  if (up.error) throw new Error(`editar serviço: ${up.error.message}`);
  if (!up.data) throw new Error("not_found");
  await audit(db, ownerId, userId, "service_update", "service", serviceId, {});
  return toService(up.data as Record<string, unknown>);
}

/** Exclusão lógica: as notas já emitidas não são afetadas. Se era o padrão, o mais antigo restante assume. */
export async function deleteService(db: Db, ownerId: string, userId: string, companyId: string, serviceId: string): Promise<{ ok: true }> {
  await ownCompany(db, ownerId, companyId);
  const now = new Date().toISOString();
  const del = await db.from("fiscal_services").update({ soft_deleted_at: now, is_default: false, updated_at: now }).eq("id", serviceId).eq("company_id", companyId).eq("owner_id", ownerId).is("soft_deleted_at", null).select("id").maybeSingle();
  if (del.error) throw new Error(`excluir serviço: ${del.error.message}`);
  if (!del.data) throw new Error("not_found");
  const { data: rest } = await db.from("fiscal_services").select("id, is_default").eq("company_id", companyId).eq("owner_id", ownerId).is("soft_deleted_at", null).order("created_at");
  if (rest?.length && !rest.some((r) => r.is_default === true)) must(await db.from("fiscal_services").update({ is_default: true, updated_at: now }).eq("id", rest[0].id as string).eq("owner_id", ownerId), "novo padrão");
  await audit(db, ownerId, userId, "service_delete", "service", serviceId, {});
  return { ok: true };
}

/** "Desativar": só local (status `deactivated`); nenhum ato no provedor e nenhum dado fiscal é apagado. Reativável pelo fluxo de ativação. */
export async function deactivateCompany(db: Db, ownerId: string, userId: string, companyId: string): Promise<{ ok: true }> {
  await ownCompany(db, ownerId, companyId);
  must(await db.from("fiscal_companies").update({ status: "deactivated", updated_at: new Date().toISOString() }).eq("id", companyId).eq("owner_id", ownerId), "desativar");
  await audit(db, ownerId, userId, "company_deactivate", "company", companyId, {});
  return { ok: true };
}
