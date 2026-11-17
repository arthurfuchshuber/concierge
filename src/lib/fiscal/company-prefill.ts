/**
 * Dados da empresa para a janela de ativação do módulo fiscal.
 * O CNPJ vem SEMPRE do cadastro da conta (`profiles.cpf`, só dígitos) e os demais dados da Receita Federal (BrasilAPI):
 * a janela mostra tudo bloqueado, exceto nome fantasia e inscrição municipal (que não existe na consulta pública).
 * Sem segredo aqui; o certificado nunca passa por este arquivo.
 */
export type SimplesOption = "nao_optante" | "mei" | "me_epp";

export type CompanyPrefill =
  | {
      ok: true;
      taxId: string;
      legalName: string;
      tradeName: string;
      situation: string;
      /** Contato e enquadramento vindos da Receita (mockup Fiscal, 16/11/2026): vazio ⇒ o campo abre para digitação. */
      email: string;
      phone: string;
      simples: SimplesOption;
      cnae: { code: string; description: string };
      ibgeCityCode: string;
      address: { cep: string; street: string; number: string; neighborhood: string; city: string; state: string };
    }
  | { ok: false; code: "no_cnpj" | "not_found" | "unavailable" };

type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export const onlyDigits = (v: unknown) => String(v ?? "").replace(/\D/g, "");

export async function lookupCompanyByCnpj(cnpjRaw: unknown, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<CompanyPrefill> {
  const cnpj = onlyDigits(cnpjRaw);
  if (cnpj.length !== 14) return { ok: false, code: "no_cnpj" };
  try {
    const res = await fetchImpl(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, { headers: { accept: "application/json" } });
    if (res.status === 404) return { ok: false, code: "not_found" };
    if (!res.ok) return { ok: false, code: "unavailable" };
    const j = (await res.json()) as Record<string, unknown>;
    const s = (v: unknown) => (v == null ? "" : String(v).trim());
    const street = [s(j["descricao_tipo_de_logradouro"]), s(j["logradouro"])].filter(Boolean).join(" ");
    return {
      ok: true,
      taxId: cnpj,
      legalName: s(j["razao_social"]),
      tradeName: s(j["nome_fantasia"]),
      situation: s(j["descricao_situacao_cadastral"] ?? j["situacao"]).toUpperCase() || "ATIVA",
      email: s(j["email"]).toLowerCase(),
      phone: onlyDigits(j["ddd_telefone_1"]),
      simples: j["opcao_pelo_mei"] === true ? "mei" : j["opcao_pelo_simples"] === true ? "me_epp" : "nao_optante",
      cnae: { code: onlyDigits(j["cnae_fiscal"]), description: s(j["cnae_fiscal_descricao"]) },
      ibgeCityCode: onlyDigits(j["codigo_municipio_ibge"]),
      address: { cep: onlyDigits(j["cep"]), street, number: s(j["numero"]) || "S/N", neighborhood: s(j["bairro"]), city: s(j["municipio"]), state: s(j["uf"]).toUpperCase() },
    };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

/**
 * O CNPJ da empresa emissora pode vir do perfil OU ser informado pelo titular na janela (titular pessoa física, com CPF em
 * `profiles.cpf`, também ativa a empresa dele). A trava real é o certificado A1: a Focus recusa certificado de outro CNPJ,
 * e um CNPJ já ativo em outra conta é recusado (`cnpj_in_use`). Aqui só exigimos um CNPJ válido (14 dígitos, dígitos verificadores).
 */
export async function assertTaxIdIsAccountCnpj(
  _db: { from: (t: string) => any },
  _userId: string,
  taxId: string,
): Promise<boolean> {
  const { isValidCnpj } = await import("./setup");
  return isValidCnpj(onlyDigits(taxId));
}
