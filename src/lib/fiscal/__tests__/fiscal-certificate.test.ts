import { describe, expect, it, vi } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { encryptConnectionKey } from "@/lib/connection-key-crypto.server";
import { formatCertificateLabel, parseCertificateExpiry, scrubCertificate, validateCertificateInput } from "../certificate";
import { getFiscalStatusPublic, submitCompanyCertificate } from "../service.server";
import type { FetchLike } from "../focus/client";

process.env.APP_USER_CONNECTION_KEY_SECRET = Buffer.alloc(32, 7).toString("base64");

const PFX = Buffer.from("PFX-CONTEUDO-BINARIO-FAKE-0123456789").toString("base64");
const PASS = "senha-super-secreta-123";
const TOKEN = "TOKEN-SUBEMPRESA-XYZ";
const OWNER = "11111111-1111-4111-8111-111111111111";
const CO = "22222222-2222-4222-8222-222222222222";

/** Db falso que REGISTRA toda escrita para provar que nada sensível é persistido. */
function fakeDb(over: { env?: string; companyRow?: Record<string, unknown> | null } = {}) {
  const writes: Array<{ table: string; op: string; payload: unknown }> = [];
  const company = over.companyRow === undefined ? { id: CO, owner_id: OWNER, tax_id: "12345678000195", connection_id: "c1" } : over.companyRow;
  const conn = { id: "c1", owner_id: OWNER, environment: over.env ?? "production", status: "active", secret_ref: { v: 1, ct: encryptConnectionKey(TOKEN) } };
  const q = (table: string) => {
    const st: { filters: Record<string, unknown> } = { filters: {} };
    const api: Record<string, unknown> = {};
    const chain = () => api;
    Object.assign(api, {
      select: chain, eq: chain, is: chain, or: chain, order: chain,
      maybeSingle: async () => ({ data: table === "fiscal_companies" ? company : table === "fiscal_provider_connections" ? conn : null, error: null }),
      insert: async (payload: unknown) => { writes.push({ table, op: "insert", payload }); return { data: null, error: null }; },
      update: (payload: unknown) => { writes.push({ table, op: "update", payload }); return { eq: () => ({ eq: async () => ({ data: null, error: null }) }) }; },
    });
    void st;
    return api;
  };
  return { db: { from: q } as never, writes };
}

const ok = (body: unknown, status = 200): FetchLike => async () => ({ status, text: async () => JSON.stringify(body) });

describe("certificado A1 — write-only", () => {
  it("dry-run (padrão): chama POST /v2/empresas?dry_run=1 em produção, envia cert+senha e NÃO persiste nada além da auditoria sem segredos", async () => {
    const { db, writes } = fakeDb();
    const f = vi.fn<FetchLike>(ok({ ok: true }));
    const r = await submitCompanyCertificate(db, OWNER, OWNER, { companyId: CO, pfxBase64: PFX, password: PASS, companyFields: { cnpj: "12.345.678/0001-95" }, dryRun: true }, f);
    expect(r).toEqual({ ok: true, dryRun: true, code: "ok" });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://api.focusnfe.com.br/v2/empresas?dry_run=1");
    expect(init.method).toBe("POST");
    const sent = JSON.parse(init.body!);
    expect(sent.arquivo_certificado_base64).toBe(PFX);
    expect(sent.senha_certificado).toBe(PASS);
    const dump = JSON.stringify(writes);
    expect(dump).not.toContain(PFX);
    expect(dump).not.toContain(PASS);
    expect(dump).not.toContain(TOKEN);
    expect(writes.every((w) => w.table === "fiscal_audit")).toBe(true); // dry-run não altera a empresa
    expect(JSON.stringify(r)).not.toContain(PASS);
  });

  it("execução real: grava apenas validade/data (sem .pfx/senha) e a validade vem da resposta do provedor", async () => {
    const { db, writes } = fakeDb();
    const f = vi.fn<FetchLike>(ok({ certificado_valido_ate: "2027-08-15T00:00:00Z" }, 201));
    const r = await submitCompanyCertificate(db, OWNER, OWNER, { companyId: CO, pfxBase64: PFX, password: PASS, companyFields: {}, dryRun: false }, f);
    expect(r.ok).toBe(true);
    expect(f.mock.calls[0]![0]).toBe("https://api.focusnfe.com.br/v2/empresas");
    const upd = writes.find((w) => w.table === "fiscal_companies")!;
    expect(Object.keys(upd.payload as object).sort()).toEqual(["certificate_updated_at", "certificate_valid_until", "updated_at"]);
    const dump = JSON.stringify(writes);
    expect(dump).not.toContain(PFX);
    expect(dump).not.toContain(PASS);
  });

  it("erro do provedor ou rede que ecoe segredos nunca vaza para resultado/auditoria", async () => {
    const { db, writes } = fakeDb();
    const bad: FetchLike = async () => { throw new Error(`falha ${PFX} ${PASS} ${TOKEN}`); };
    const r = await submitCompanyCertificate(db, OWNER, OWNER, { companyId: CO, pfxBase64: PFX, password: PASS, companyFields: {}, dryRun: true }, bad);
    expect(r.ok).toBe(false);
    const dump = JSON.stringify({ r, writes });
    for (const secret of [PFX, PASS, TOKEN]) expect(dump).not.toContain(secret);
    const http: FetchLike = async () => ({ status: 422, text: async () => `eco ${PASS}` });
    const r2 = await submitCompanyCertificate(db, OWNER, OWNER, { companyId: CO, pfxBase64: PFX, password: PASS, companyFields: {}, dryRun: true }, http);
    expect(r2).toEqual({ ok: false, dryRun: true, code: "http_422" });
  });

  it("entradas inválidas são recusadas antes de qualquer rede; homologação é recusada (Empresas = produção)", async () => {
    const f = vi.fn<FetchLike>(ok({}));
    const { db } = fakeDb();
    expect((await submitCompanyCertificate(db, OWNER, OWNER, { companyId: CO, pfxBase64: "não é base64!", password: PASS, companyFields: {}, dryRun: true }, f)).code).toBe("pfx_invalid");
    expect((await submitCompanyCertificate(db, OWNER, OWNER, { companyId: CO, pfxBase64: PFX, password: "", companyFields: {}, dryRun: true }, f)).code).toBe("password_required");
    expect((await submitCompanyCertificate(db, OWNER, OWNER, { companyId: CO, pfxBase64: PFX, password: PASS, companyFields: { senha_certificado: "x" }, dryRun: true }, f)).code).toBe("reserved_field");
    expect((await submitCompanyCertificate(db, OWNER, OWNER, { companyId: CO, pfxBase64: PFX, password: PASS, companyFields: { cnpj: "99999999000199" }, dryRun: true }, f)).code).toBe("cnpj_mismatch");
    await expect(submitCompanyCertificate(fakeDb({ env: "homologation" }).db, OWNER, OWNER, { companyId: CO, pfxBase64: PFX, password: PASS, companyFields: {}, dryRun: true }, f)).rejects.toThrow(/produção/);
    await expect(submitCompanyCertificate(fakeDb({ companyRow: null }).db, OWNER, OWNER, { companyId: CO, pfxBase64: PFX, password: PASS, companyFields: {}, dryRun: true }, f)).rejects.toThrow(/não encontrada/);
    expect(f).not.toHaveBeenCalled();
  });

  it("helpers: validação, scrub e validade", () => {
    expect(() => validateCertificateInput(PFX, PASS)).not.toThrow();
    expect(scrubCertificate(`a ${PFX} b ${PASS}`, PFX, PASS)).toBe("a [redacted] b [redacted]");
    expect(parseCertificateExpiry({ certificado_valido_ate: "2027-08-15T00:00:00Z" })).toBe("2027-08-15T00:00:00.000Z");
    expect(parseCertificateExpiry({ outro: 1 })).toBeNull();
    expect(parseCertificateExpiry(null)).toBeNull();
    expect(formatCertificateLabel("2027-08-15T00:00:00.000Z")).toBe("Certificado A1 válido até 15/08/2027");
    expect(formatCertificateLabel(null)).toBeNull();
  });
});

describe("projeção segura do status", () => {
  const dbWith = (comps: unknown[], conns: unknown[]) => ({
    from: (t: string) => {
      const rows = t === "fiscal_companies" ? comps : conns;
      const api: Record<string, unknown> = {};
      const chain = () => api;
      Object.assign(api, { select: chain, eq: chain, is: chain, or: chain });
      (api as { order: unknown }).order = async () => ({ data: rows, error: null });
      (api as { then: unknown }).then = (res: (v: unknown) => unknown) => res({ data: rows, error: null });
      return api;
    },
  }) as never;
  const co = (status: string) => ({ id: CO, tax_id: "12345678000195", legal_name: "ACME LTDA", trade_name: "Acme", status, connection_id: "c1", certificate_valid_until: "2027-08-15T00:00:00.000Z",
    // campos que NUNCA devem sair, mesmo se a linha os trouxesse:
    provider_company_ref: "SEGREDO-REF", capabilities: { municipal_registration: "123" } });
  it("expõe somente metadados públicos e nada de segredo", async () => {
    const out = await getFiscalStatusPublic(dbWith([co("active")], [{ id: "c1", environment: "production", status: "active", secret_ref: { ct: "CIFRADO" } }]), OWNER);
    expect(out.companies[0]).toEqual({ companyId: CO, status: "Ativa", legalName: "ACME LTDA", tradeName: "Acme", taxId: "12345678000195", certificateValidUntil: "2027-08-15T00:00:00.000Z", certificateLabel: "Certificado A1 válido até 15/08/2027", certificateAlert: { level: expect.stringMatching(/^(ok|expiring|expired)$/), daysLeft: expect.any(Number) }, canReplaceCertificate: true });
    const dump = JSON.stringify(out);
    for (const s of ["SEGREDO-REF", "CIFRADO", "municipal", "secret_ref", "token"]) expect(dump).not.toContain(s);
  });
  it("mapeia Homologação e Pendente", async () => {
    const h = await getFiscalStatusPublic(dbWith([co("active")], [{ id: "c1", environment: "homologation", status: "active" }]), OWNER);
    expect(h.companies[0]!.status).toBe("Homologação");
    const p = await getFiscalStatusPublic(dbWith([co("awaiting_certificate")], [{ id: "c1", environment: "production", status: "active" }]), OWNER);
    expect(p.companies[0]!.status).toBe("Pendente");
    const p2 = await getFiscalStatusPublic(dbWith([co("active")], [{ id: "c1", environment: "production", status: "error" }]), OWNER);
    expect(p2.companies[0]!.status).toBe("Pendente");
  });
});

describe("não existe caminho de download/exportação do certificado", () => {
  const walk = (d: string): string[] => !existsSync(d) ? [] : readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() && n !== "__tests__" ? walk(p) : p.endsWith(".ts") || p.endsWith(".tsx") ? [p] : []; });
  const files = [...walk("src/lib/fiscal"), ...walk("src/components/fiscal"), ...walk("src/routes/api/public").filter((f) => /fiscal/.test(f))];
  it("nenhuma server fn/rota/botão de baixar certificado, exportar .pfx ou ver senha", () => {
    const re = /(baixar|download|exportar|export)[a-z_\s-]*(certificad|\.pfx|pfx)|(ver|visualizar|mostrar|reveal|show)[a-z_\s-]*senha|getCertificate|downloadCertificate|exportPfx/i;
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(re);
  });
  it("o esquema não tem coluna para .pfx/senha/token de sub-empresa", () => {
    const sql = ["20261114200000_fiscal_core.sql", "20261114210000_fiscal_enablement_webhooks.sql"].map((n) => readFileSync(join("supabase/migrations", n), "utf8")).join("\n");
    const cols = sql.match(/^\s+(\w+)\s+(text|bytea|jsonb)\b/gim) ?? [];
    for (const c of cols) expect(c, c).not.toMatch(/\b(pfx|certificate_file|certificate_blob|certificate_password|cert_password|senha|sub_token|subcompany_token)\b/i);
  });
  it("o módulo de certificado não importa banco nem storage", () => {
    expect(readFileSync("src/lib/fiscal/certificate.ts", "utf8")).not.toMatch(/^import .*(supabase|storage|node:fs)/m);
  });
});
