import { describe, expect, it } from "vitest";
import { assertTaxIdIsAccountCnpj, lookupCompanyByCnpj, prefillFromAccountCompany } from "../company-prefill";

const ok = (body: unknown, status = 200) => async () => ({ ok: status < 300, status, json: async () => body });

describe("company-prefill", () => {
  it("monta todos os dados da empresa a partir do CNPJ da conta", async () => {
    const r = await lookupCompanyByCnpj("12.345.678/0001-95", ok({ razao_social: "ACME LTDA", nome_fantasia: "Acme", descricao_tipo_de_logradouro: "RUA", logradouro: "DAS FLORES", numero: "", bairro: "CENTRO", municipio: "FOZ DO IGUACU", uf: "pr", cep: "85851-000", descricao_situacao_cadastral: "Ativa" }));
    expect(r).toEqual({ ok: true, taxId: "12345678000195", legalName: "ACME LTDA", tradeName: "Acme", situation: "ATIVA", email: "", phone: "", simples: "nao_optante", cnae: { code: "", description: "" }, ibgeCityCode: "", address: { cep: "85851000", street: "RUA DAS FLORES", number: "S/N", neighborhood: "CENTRO", city: "FOZ DO IGUACU", state: "PR" } });
  });
  it("traz e-mail, telefone, Simples, CNAE e município (IBGE) da Receita", async () => {
    const base = { razao_social: "ACME LTDA", email: "Contato@Acme.com.br", ddd_telefone_1: "(45) 3523-0000", cnae_fiscal: 6821801, cnae_fiscal_descricao: "Corretagem na compra e venda de imóveis", codigo_municipio_ibge: 4108304, cep: "85851000", uf: "PR" };
    const me = await lookupCompanyByCnpj("12345678000195", ok({ ...base, opcao_pelo_simples: true, opcao_pelo_mei: false }));
    expect(me).toMatchObject({ ok: true, email: "contato@acme.com.br", phone: "4535230000", simples: "me_epp", cnae: { code: "6821801", description: "Corretagem na compra e venda de imóveis" }, ibgeCityCode: "4108304" });
    expect(await lookupCompanyByCnpj("12345678000195", ok({ ...base, opcao_pelo_simples: true, opcao_pelo_mei: true }))).toMatchObject({ simples: "mei" });
    expect(await lookupCompanyByCnpj("12345678000195", ok({ ...base, opcao_pelo_simples: false }))).toMatchObject({ simples: "nao_optante" });
  });
  it("sem CNPJ válido não consulta", async () => {
    let called = false;
    const r = await lookupCompanyByCnpj("123", async () => { called = true; return { ok: true, status: 200, json: async () => ({}) }; });
    expect(r).toEqual({ ok: false, code: "no_cnpj" }); expect(called).toBe(false);
  });
  it("404 e falha de rede viram códigos", async () => {
    expect(await lookupCompanyByCnpj("12345678000195", ok({}, 404))).toEqual({ ok: false, code: "not_found" });
    expect(await lookupCompanyByCnpj("12345678000195", async () => { throw new Error("x"); })).toEqual({ ok: false, code: "unavailable" });
  });
  it("aceita qualquer CNPJ válido informado pelo titular (mesmo com CPF no perfil) e recusa inválidos", async () => {
    const db = { from: () => ({}) };
    expect(await assertTaxIdIsAccountCnpj(db, "u", "11.222.333/0001-81")).toBe(true);
    expect(await assertTaxIdIsAccountCnpj(db, "u", "12345678901")).toBe(false); // CPF
    expect(await assertTaxIdIsAccountCnpj(db, "u", "11222333000182")).toBe(false); // dígito verificador errado
    expect(await assertTaxIdIsAccountCnpj(db, "u", "00000000000000")).toBe(false);
  });
  describe("empresa do Perfil (account_companies)", () => {
    const ac = { cnpj: "11.222.333/0001-81".replace(/\D/g, ""), legal_name: "ACME SALVA", trade_name: "Acme Perfil", email: "Perfil@Acme.com", phone: "45999990000", municipal_registration: "12345", cep: "85851000", street: "RUA A", number: "10", neighborhood: "CENTRO", city: "FOZ", state: "pr", tax_regime: "simples_nacional", cnae_code: "6821801", cnae_description: "Corretagem", ibge_city_code: "4108304", simples: "me_epp", situation: "ATIVA" };
    it("sem cadastro ou sem CNPJ válido no Perfil: devolve null (cai no fallback)", async () => {
      expect(await prefillFromAccountCompany(null)).toBeNull();
      expect(await prefillFromAccountCompany({ cnpj: "123" })).toBeNull();
    });
    it("Receita responde: dados da Receita + o que o titular salvou (fantasia, e-mail, telefone, inscrição municipal)", async () => {
      const r = await prefillFromAccountCompany(ac, ok({ razao_social: "ACME LTDA", nome_fantasia: "Acme Receita", email: "r@acme.com", ddd_telefone_1: "4535230000", cep: "85851000", uf: "PR" }));
      expect(r).toMatchObject({ ok: true, legalName: "ACME LTDA", tradeName: "Acme Perfil", email: "perfil@acme.com", phone: "45999990000", municipalRegistration: "12345" });
    });
    it("Receita instável: usa o cadastro salvo no Perfil", async () => {
      const r = await prefillFromAccountCompany(ac, ok({}, 503));
      expect(r).toMatchObject({ ok: true, taxId: "11222333000181", legalName: "ACME SALVA", simples: "me_epp", municipalRegistration: "12345", cnae: { code: "6821801", description: "Corretagem" }, ibgeCityCode: "4108304", address: { neighborhood: "CENTRO", state: "PR", number: "10" } });
    });
    it("CNPJ não encontrado na Receita: não usa o cadastro (devolve null)", async () => {
      expect(await prefillFromAccountCompany(ac, ok({}, 404))).toBeNull();
    });
  });
});
