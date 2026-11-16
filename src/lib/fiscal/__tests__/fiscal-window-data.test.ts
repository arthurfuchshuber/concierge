import { describe, expect, it, vi } from "vitest";
import { classifyProviderRejection, CompanyEditInput, PreferencesInput, ServiceInput } from "../window-data";
import { formatNationalCode, searchNationalCodes, suggestServiceForCnae } from "../national-codes";
import { buildSetupCompanyFields, SetupInputError } from "../setup";
import { createService, deleteService, deactivateCompany, listServices, savePreferences, updateCompanyData } from "../service.server";
import { FocusClient, type FetchLike } from "../focus/client";

const OWNER = "11111111-1111-4111-8111-111111111111";
const CO = "22222222-2222-4222-8222-222222222222";

describe("validação das janelas", () => {
  it("serviço: código nacional vira 6 dígitos, vazios viram null, percentuais 0–100", () => {
    const s = ServiceInput.parse({ nationalCode: "10.05.01", description: "Agenciamento de imóveis", serviceCode: "", nbsCode: "1.1501.30.00", inssPct: 11, irPct: null });
    expect(s).toMatchObject({ nationalCode: "100501", serviceCode: null, nbsCode: "1.1501.30.00", isDefault: false, inssPct: 11, irPct: null });
    expect(() => ServiceInput.parse({ nationalCode: "1005", description: "abc" })).toThrow();
    expect(() => ServiceInput.parse({ nationalCode: "100501", description: "ab" })).toThrow();
    expect(() => ServiceInput.parse({ nationalCode: "100501", description: "abc", inssPct: 101 })).toThrow();
  });
  it("editar dados: regime 0–6, série numérica, próximo número ≥ 1, telefone com 10–11 dígitos", () => {
    const base = { municipalRegistration: "123", specialRegime: 0, dpsSeries: "1", dpsNextNumber: 1 };
    expect(CompanyEditInput.parse({ ...base, phone: "(45) 99999-0000", email: "A@B.com" })).toMatchObject({ phone: "45999990000", email: "a@b.com" });
    for (const bad of [{ specialRegime: 7 }, { dpsSeries: "A" }, { dpsNextNumber: 0 }, { municipalRegistration: "" }, { phone: "123" }]) expect(() => CompanyEditInput.parse({ ...base, ...bad })).toThrow();
  });
  it("preferências: só 'none' ou 'included'", () => {
    expect(PreferencesInput.parse({ approximateTaxes: "included" }).approximateTaxes).toBe("included");
    expect(() => PreferencesInput.parse({ approximateTaxes: "x" })).toThrow();
  });
  it("recusa do provedor vira código estável (certificado de outro CNPJ)", () => {
    expect(classifyProviderRejection(422, { erros: [{ mensagem: "O CNPJ do certificado difere do CNPJ da empresa" }] })).toBe("certificate_cnpj_mismatch");
    expect(classifyProviderRejection(422, { mensagem: "Senha do certificado incorreta" })).toBe("certificate_invalid");
    expect(classifyProviderRejection(500, "erro")).toBe("http_500");
  });
  it("setup: e-mail e telefone da Receita seguem para o provedor; inválidos são recusados", () => {
    const addr = { cep: "85851-000", street: "Rua A", number: "10", neighborhood: "Centro", city: "Foz", state: "PR" };
    const base = { taxId: "11.222.333/0001-81", legalName: "Empresa Teste Ltda", municipalRegistration: "12345", address: addr };
    const ok = buildSetupCompanyFields({ ...base, email: "Contato@Teste.com", phone: "(45) 3523-0000" });
    expect(ok.providerFields).toMatchObject({ email: "contato@teste.com", telefone: "4535230000" });
    expect(ok.contact).toEqual({ email: "contato@teste.com", phone: "4535230000" });
    expect(() => buildSetupCompanyFields({ ...base, email: "sem-arroba" })).toThrow(SetupInputError);
    expect(() => buildSetupCompanyFields({ ...base, phone: "123" })).toThrow(SetupInputError);
    expect(buildSetupCompanyFields(base).providerFields).not.toHaveProperty("email");
  });
});

describe("códigos nacionais", () => {
  it("formata e busca por código ou texto, com e sem pontos/acentos", () => {
    expect(formatNationalCode("100501")).toBe("10.05.01");
    expect(searchNationalCodes("10.05").map((c) => c.code)).toEqual(["100501"]);
    expect(searchNationalCodes("1005")[0]?.code).toBe("100501");
    expect(searchNationalCodes("contabilidade")[0]?.code).toBe("171901");
    expect(searchNationalCodes("zzzz")).toEqual([]);
    expect(searchNationalCodes("").length).toBeGreaterThan(0);
  });
  it("sugestão pelo CNAE: imobiliário/hospedagem sim, outros não", () => {
    expect(suggestServiceForCnae("6821801")?.nationalCode).toBe("100501");
    expect(suggestServiceForCnae("5590601")?.nationalCode).toBe("100501");
    expect(suggestServiceForCnae("4711301")).toBeNull();
    expect(suggestServiceForCnae(null)).toBeNull();
  });
});

type Call = { t: string; op: string; p?: unknown; f?: Array<[string, unknown]> };
/** Banco falso: registra as operações e devolve linhas por tabela. */
function fakeDb(o: { company?: unknown; services?: unknown[]; count?: number; upd?: unknown } = {}) {
  const calls: Call[] = [];
  const from = (t: string) => {
    const c: Call = { t, op: "select", f: [] };
    const api: Record<string, unknown> = {};
    const ch = () => api;
    Object.assign(api, {
      select: (_c?: string, opts?: { head?: boolean }) => { if (opts?.head) c.op = "count"; return api; },
      eq: (k: string, v: unknown) => { c.f!.push([k, v]); return api; }, neq: ch, is: ch, or: ch, order: ch, limit: ch,
      insert: (p: unknown) => { c.op = "insert"; c.p = p; return api; },
      update: (p: unknown) => { c.op = "update"; c.p = p; return api; },
      maybeSingle: async () => { calls.push(c); return { data: t === "fiscal_companies" ? (o.company ?? null) : (o.upd ?? null), error: null }; },
      single: async () => { calls.push(c); return { data: { id: "novo", ...(c.p as object) }, error: null }; },
      then: (r: (v: unknown) => unknown) => { calls.push(c); return r({ data: o.services ?? [], count: o.count ?? 0, error: null }); },
    });
    return api;
  };
  return { db: { from } as never, calls };
}
const company = { id: CO, tax_id: "11222333000181", connection_id: "c1", status: "active", cnae_code: "6821801" };

describe("serviços e dados (banco falso)", () => {
  it("empresa de outra conta/inexistente ⇒ not_found e nada é gravado", async () => {
    const { db, calls } = fakeDb({ company: null });
    await expect(createService(db, OWNER, OWNER, CO, { nationalCode: "100501", description: "Agenciamento" })).rejects.toThrow("not_found");
    expect(calls.some((c) => c.t === "fiscal_services" && c.op === "insert")).toBe(false);
  });
  it("primeiro serviço vira padrão automaticamente e limpa outros padrões", async () => {
    const { db, calls } = fakeDb({ company, count: 0 });
    const s = await createService(db, OWNER, OWNER, CO, { nationalCode: "10.05.01", description: "Agenciamento de imóveis" });
    expect(s.isDefault).toBe(true);
    expect(calls.find((c) => c.t === "fiscal_services" && c.op === "update")?.p).toMatchObject({ is_default: false });
    expect(calls.find((c) => c.t === "fiscal_services" && c.op === "insert")?.p).toMatchObject({ owner_id: OWNER, company_id: CO, national_code: "100501", is_default: true });
  });
  it("lista vazia traz a sugestão pelo CNAE; lista com itens não", async () => {
    expect((await listServices(fakeDb({ company }).db, OWNER, CO)).suggestion?.nationalCode).toBe("100501");
    const row = { id: "s1", national_code: "100501", description: "x", is_default: true };
    expect((await listServices(fakeDb({ company, services: [row] }).db, OWNER, CO)).suggestion).toBeNull();
  });
  it("exclusão é lógica (soft_deleted_at), nunca DELETE", async () => {
    const { db, calls } = fakeDb({ company, upd: { id: "s1" } });
    await deleteService(db, OWNER, OWNER, CO, "s1");
    const up = calls.find((c) => c.t === "fiscal_services" && c.op === "update");
    expect((up?.p as Record<string, unknown>).soft_deleted_at).toBeTruthy();
    expect(calls.some((c) => c.op === "delete")).toBe(false);
  });
  it("preferências e desativação só gravam na própria empresa", async () => {
    const a = fakeDb({ company });
    await savePreferences(a.db, OWNER, OWNER, CO, { approximateTaxes: "included", invoiceNote: "obs" });
    expect(a.calls.find((c) => c.t === "fiscal_companies" && c.op === "update")).toMatchObject({ p: { approximate_taxes: "included", invoice_note: "obs" } });
    const b = fakeDb({ company });
    await deactivateCompany(b.db, OWNER, OWNER, CO);
    expect(b.calls.find((c) => c.t === "fiscal_companies" && c.op === "update")?.p).toMatchObject({ status: "deactivated" });
    expect(b.calls.find((c) => c.t === "fiscal_companies" && c.op === "update")?.f).toContainEqual(["owner_id", OWNER]);
  });
  it("editar dados: se o provedor recusa, NADA é gravado; se aceita, grava e audita", async () => {
    process.env.FOCUSNFE_API = "MASTER-TOKEN-PROD-XYZ";
    const input = { municipalRegistration: "999", tradeName: "Fantasia", specialRegime: 3, dpsSeries: "2", dpsNextNumber: 10, email: "a@b.com", phone: "45999990000" };
    const conn = { id: "c1", status: "active", owner_id: null, environment: "production", secret_ref: null };
    const mk = (status: number) => {
      const f = vi.fn<FetchLike>(async () => ({ status, text: async () => JSON.stringify({ mensagem: "x" }) }));
      const x = fakeDb({ company });
      // conexão do provedor para focusFor
      const orig = (x.db as unknown as { from: (t: string) => Record<string, unknown> }).from;
      (x.db as unknown as { from: unknown }).from = (t: string) => { const api = orig(t); if (t === "fiscal_provider_connections") api.maybeSingle = async () => ({ data: conn, error: null }); return api; };
      return { f, ...x };
    };
    const bad = mk(422);
    expect(await updateCompanyData(bad.db, OWNER, OWNER, CO, input, bad.f)).toMatchObject({ ok: false });
    expect(bad.calls.some((c) => c.t === "fiscal_companies" && c.op === "update")).toBe(false);
    const good = mk(200);
    expect(await updateCompanyData(good.db, OWNER, OWNER, CO, input, good.f)).toEqual({ ok: true });
    expect(good.f.mock.calls[0]![0]).toContain("/v2/empresas/11222333000181");
    expect(good.calls.find((c) => c.t === "fiscal_companies" && c.op === "update")?.p).toMatchObject({ municipal_registration: "999", special_regime: 3, dps_series: "2", dps_next_number: 10 });
    void FocusClient;
  });
});
