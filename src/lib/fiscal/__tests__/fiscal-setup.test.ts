import { describe, expect, it, vi } from "vitest";
import { isValidCnpj, buildSetupCompanyFields } from "../setup";
import { setupCompanyWithCertificate } from "../service.server";
import type { FetchLike } from "../focus/client";

const USER = "11111111-1111-4111-8111-111111111111";
const PFX = Buffer.from("pfx-binario-de-teste-0123456789").toString("base64");
const PASS = "senha-secreta-123";
const CNPJ = "11.222.333/0001-81";
const base = { taxId: CNPJ, legalName: "Empresa Teste Ltda", tradeName: "Teste", municipalRegistration: "12345", address: { cep: "85851-000", street: "Rua A", number: "10", neighborhood: "Centro", city: "Foz do Iguaçu", state: "pr" }, pfxBase64: PFX, password: PASS };

function fakeDb(opts: { dupOwner?: string | null } = {}) {
  const calls: Array<{ t: string; op: string; p?: unknown }> = [];
  const from = (t: string) => {
    const api: Record<string, unknown> = {};
    const ch = () => api;
    Object.assign(api, {
      select: ch, eq: ch, is: ch, or: ch,
      maybeSingle: async () => ({
        data: t === "fiscal_provider_connections" ? { id: "plat", status: "active", owner_id: null, environment: "production", secret_ref: null }
          : t === "fiscal_companies" && opts.dupOwner !== undefined ? (opts.dupOwner ? { id: "c9", owner_id: opts.dupOwner } : null) : null, error: null }),
      single: async () => ({ data: { id: "new" }, error: null }),
      insert: (p: unknown) => { calls.push({ t, op: "insert", p }); return api; },
      update: (p: unknown) => { calls.push({ t, op: "update", p }); return api; },
      upsert: async (p: unknown) => { calls.push({ t, op: "upsert", p }); return { data: null, error: null }; },
      then: (r: (v: unknown) => unknown) => r({ data: null, error: null }),
    });
    return api;
  };
  return { db: { from } as never, calls };
}
const okFetch = (status = 200, body: unknown = { certificado_valido_ate: "2027-05-10T00:00:00Z" }) => vi.fn<FetchLike>(async () => ({ status, text: async () => JSON.stringify(body) }));

describe("validação de CNPJ e dados", () => {
  it("valida dígitos verificadores", () => {
    expect(isValidCnpj(CNPJ)).toBe(true);
    expect(isValidCnpj("11.222.333/0001-82")).toBe(false);
    expect(isValidCnpj("00000000000000")).toBe(false);
  });
  it("normaliza e monta campos da Focus sem certificado", () => {
    const f = buildSetupCompanyFields(base);
    expect(f.providerFields).toMatchObject({ cnpj: "11222333000181", uf: "PR", cep: "85851000", habilita_nfse: true, nome_fantasia: "Teste" });
    expect(JSON.stringify(f.providerFields)).not.toContain(PASS);
  });
});

describe("setupCompanyWithCertificate", () => {
  process.env.FOCUSNFE_API = "MASTER-TOKEN-PROD-XYZ";
  it("envia à Focus com o token mestre, registra a empresa ativa e devolve só metadados", async () => {
    const { db, calls } = fakeDb();
    const f = okFetch();
    const r = await setupCompanyWithCertificate(db, USER, base, f);
    expect(r).toEqual({ ok: true, certificateValidUntil: "2027-05-10T00:00:00.000Z", legalName: "Empresa Teste Ltda", dryRun: false });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://api.focusnfe.com.br/v2/empresas");
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from("MASTER-TOKEN-PROD-XYZ:").toString("base64")}`);
    expect(calls.find((c) => c.t === "fiscal_tenant_enablement")?.op).toBe("upsert");
    const ins = calls.find((c) => c.t === "fiscal_companies" && c.op === "insert")!.p as Record<string, unknown>;
    expect(ins).toMatchObject({ owner_id: USER, tax_id: "11222333000181", status: "active", connection_id: "plat" });
    const everything = JSON.stringify(calls);
    expect(everything).not.toContain(PASS);
    expect(everything).not.toContain(PFX);
    expect(everything).not.toContain("MASTER-TOKEN-PROD-XYZ");
  });
  it("dry-run simula e não grava empresa nem habilita módulo", async () => {
    const { db, calls } = fakeDb();
    const f = okFetch();
    const r = await setupCompanyWithCertificate(db, USER, { ...base, dryRun: true }, f);
    expect(r).toMatchObject({ ok: true, dryRun: true });
    expect(f.mock.calls[0][0]).toContain("dry_run=1");
    expect(calls.some((c) => c.t === "fiscal_companies" || c.t === "fiscal_tenant_enablement")).toBe(false);
  });
  it("Focus recusou ⇒ nada é registrado", async () => {
    const { db, calls } = fakeDb();
    const r = await setupCompanyWithCertificate(db, USER, base, okFetch(422, { erro: "x" }));
    expect(r).toEqual({ ok: false, code: "http_422" });
    expect(calls.some((c) => c.t === "fiscal_companies" || c.t === "fiscal_tenant_enablement")).toBe(false);
  });
  it("CNPJ de outra conta ⇒ recusa sem chamar a Focus", async () => {
    const { db } = fakeDb({ dupOwner: "99999999-9999-4999-8999-999999999999" });
    const f = okFetch();
    expect(await setupCompanyWithCertificate(db, USER, base, f)).toEqual({ ok: false, code: "cnpj_in_use" });
    expect(f).not.toHaveBeenCalled();
  });
  it("entradas inválidas não chegam à rede", async () => {
    const f = okFetch();
    const { db } = fakeDb();
    expect(await setupCompanyWithCertificate(db, USER, { ...base, taxId: "11111111111111" }, f)).toEqual({ ok: false, code: "cnpj_invalid" });
    expect(await setupCompanyWithCertificate(db, USER, { ...base, password: "" }, f)).toEqual({ ok: false, code: "password_required" });
    expect(await setupCompanyWithCertificate(db, USER, { ...base, pfxBase64: "@@@@" }, f)).toEqual({ ok: false, code: "pfx_invalid" });
    expect(f).not.toHaveBeenCalled();
  });
  it("sem FOCUSNFE_API ⇒ falha genérica, sem vazar nada", async () => {
    const saved = process.env.FOCUSNFE_API; delete process.env.FOCUSNFE_API;
    const { db } = fakeDb();
    await expect(setupCompanyWithCertificate(db, USER, base, okFetch())).rejects.toThrow("Módulo fiscal indisponível no momento.");
    process.env.FOCUSNFE_API = saved;
  });
});
