/**
 * Ativação do módulo fiscal pelo próprio cliente (White-Label): dados da empresa + certificado A1 numa só chamada.
 * Validação pura (sem banco, sem rede). Os nomes dos campos enviados à Focus seguem a API de Empresas
 * (cnpj, razao_social, nome_fantasia, inscricao_municipal, logradouro, numero, bairro, municipio, uf, cep, habilita_nfse);
 * a lista exata aceita/obrigatória é conferida na homologação (N/L).
 */
export interface CompanyAddress { cep: string; street: string; number: string; neighborhood: string; city: string; state: string }
export interface CompanySetupFields {
  taxId: string; legalName: string; tradeName?: string | null; municipalRegistration: string; address: CompanyAddress;
}

export const onlyDigits = (v: string) => v.replace(/\D+/g, "");

/** CNPJ numérico de 14 dígitos com dígitos verificadores (rejeita sequências repetidas). */
export function isValidCnpj(raw: string): boolean {
  const c = onlyDigits(raw);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const dv = (base: string) => {
    let sum = 0, w = base.length - 7;
    for (const ch of base) { sum += Number(ch) * w--; if (w < 2) w = 9; }
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(c.slice(0, 12)) === Number(c[12]) && dv(c.slice(0, 13)) === Number(c[13]);
}

const UFS = new Set(["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"]);

export class SetupInputError extends Error {
  constructor(readonly code: "cnpj_invalid" | "legal_name_required" | "municipal_registration_required" | "address_invalid", message: string) {
    super(message);
    this.name = "SetupInputError";
  }
}

/** Normaliza e valida; devolve os campos públicos já no formato da Focus (sem certificado). */
export function buildSetupCompanyFields(f: CompanySetupFields): { taxId: string; legalName: string; tradeName: string | null; providerFields: Record<string, unknown> } {
  const taxId = onlyDigits(f.taxId);
  if (!isValidCnpj(taxId)) throw new SetupInputError("cnpj_invalid", "CNPJ inválido.");
  const legalName = f.legalName.trim();
  if (legalName.length < 2) throw new SetupInputError("legal_name_required", "Informe a razão social.");
  const im = f.municipalRegistration.trim();
  if (!im) throw new SetupInputError("municipal_registration_required", "Informe a inscrição municipal.");
  const a = f.address;
  const cep = onlyDigits(a.cep), uf = a.state.trim().toUpperCase();
  if (cep.length !== 8 || !a.street.trim() || !a.number.trim() || !a.neighborhood.trim() || !a.city.trim() || !UFS.has(uf)) throw new SetupInputError("address_invalid", "Endereço incompleto ou inválido.");
  const tradeName = f.tradeName?.trim() ? f.tradeName.trim() : null;
  return {
    taxId, legalName, tradeName,
    providerFields: {
      cnpj: taxId, razao_social: legalName, ...(tradeName ? { nome_fantasia: tradeName } : {}), inscricao_municipal: im,
      logradouro: a.street.trim(), numero: a.number.trim(), bairro: a.neighborhood.trim(), municipio: a.city.trim(), uf, cep, habilita_nfse: true,
    },
  };
}
