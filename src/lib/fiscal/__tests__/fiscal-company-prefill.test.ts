import { describe, expect, it } from "vitest";
import { assertTaxIdIsAccountCnpj, lookupCompanyByCnpj } from "../company-prefill";

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
});
