import { describe, expect, it } from "vitest";
import { assertTaxIdIsAccountCnpj, lookupCompanyByCnpj } from "../company-prefill";

const ok = (body: unknown, status = 200) => async () => ({ ok: status < 300, status, json: async () => body });

describe("company-prefill", () => {
  it("monta todos os dados da empresa a partir do CNPJ da conta", async () => {
    const r = await lookupCompanyByCnpj("12.345.678/0001-95", ok({ razao_social: "ACME LTDA", nome_fantasia: "Acme", descricao_tipo_de_logradouro: "RUA", logradouro: "DAS FLORES", numero: "", bairro: "CENTRO", municipio: "FOZ DO IGUACU", uf: "pr", cep: "85851-000", descricao_situacao_cadastral: "Ativa" }));
    expect(r).toEqual({ ok: true, taxId: "12345678000195", legalName: "ACME LTDA", tradeName: "Acme", situation: "ATIVA", address: { cep: "85851000", street: "RUA DAS FLORES", number: "S/N", neighborhood: "CENTRO", city: "FOZ DO IGUACU", state: "PR" } });
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
  it("só aceita o CNPJ cadastrado na própria conta", async () => {
    const db = (cpf: string | null) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { cpf } }) }) }) }) });
    expect(await assertTaxIdIsAccountCnpj(db("12345678000195"), "u", "12.345.678/0001-95")).toBe(true);
    expect(await assertTaxIdIsAccountCnpj(db("12345678000195"), "u", "11222333000181")).toBe(false);
    expect(await assertTaxIdIsAccountCnpj(db("12345678901"), "u", "12345678901")).toBe(false);
  });
});
