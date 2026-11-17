/**
 * Perfil · quadrante Empresa (CNPJ). Tipos e regras puras, usados pelo servidor e pela tela.
 * Regra do produto (17/11/2026): o CNPJ SEMPRE passa pela consulta na Receita; o que a Receita devolve entra
 * bloqueado (só o suporte altera). Só ficam abertos os campos que a Receita não informa: inscrição municipal e,
 * quando ela não traz, e-mail, telefone, nome fantasia e (para quem não é do Simples) o regime tributário.
 */
export type TaxRegime = "simples_nacional" | "mei" | "lucro_presumido" | "lucro_real";

export const TAX_REGIME_LABEL: Record<TaxRegime, string> = {
  simples_nacional: "Simples Nacional",
  mei: "MEI",
  lucro_presumido: "Lucro Presumido",
  lucro_real: "Lucro Real",
};

export type CompanyFieldKey =
  | "legalName"
  | "tradeName"
  | "email"
  | "phone"
  | "cep"
  | "street"
  | "number"
  | "city"
  | "state"
  | "taxRegime"
  | "municipalRegistration";

/** Campos que a consulta preenche (e, quando vêm preenchidos, bloqueia). A inscrição municipal nunca vem da Receita. */
export const RECEITA_FIELDS: CompanyFieldKey[] = [
  "legalName",
  "tradeName",
  "email",
  "phone",
  "cep",
  "street",
  "number",
  "city",
  "state",
  "taxRegime",
];

export type CompanyData = {
  cnpj: string;
  situation: string;
  legalName: string;
  tradeName: string;
  email: string;
  phone: string;
  cep: string;
  street: string;
  number: string;
  city: string;
  state: string;
  taxRegime: TaxRegime | "";
  municipalRegistration: string;
};

/** Dados fiscais da Receita guardados junto da empresa (alimentam a ativação das Notas Fiscais). */
export type ReceitaExtra = { neighborhood: string; ibgeCityCode: string; cnaeCode: string; cnaeDescription: string; simples: "nao_optante" | "mei" | "me_epp" };

export type CompanyLookupResult =
  | { ok: true; data: CompanyData; locked: CompanyFieldKey[]; checkedAt: string; receita?: ReceitaExtra }
  | { ok: false; code: "invalid" | "not_found" | "inactive" | "unavailable" | "in_use"; situation?: string };

/** Campos obrigatórios que ainda estão vazios (todos são obrigatórios no quadrante Empresa). */
export function missingCompanyFields(d: CompanyData): CompanyFieldKey[] {
  const out: CompanyFieldKey[] = [];
  const need: CompanyFieldKey[] = [
    "legalName",
    "tradeName",
    "email",
    "phone",
    "cep",
    "street",
    "number",
    "city",
    "state",
    "taxRegime",
    "municipalRegistration",
  ];
  for (const k of need) if (!String(d[k] ?? "").trim()) out.push(k);
  if (d.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email.trim())) out.push("email");
  if (d.phone.trim() && d.phone.replace(/\D+/g, "").length < 10) out.push("phone");
  if (d.cep.trim() && d.cep.replace(/\D+/g, "").length !== 8) out.push("cep");
  if (d.state.trim() && d.state.trim().length !== 2) out.push("state");
  if (d.municipalRegistration.trim() && !/^\d{1,20}$/.test(d.municipalRegistration.replace(/\D+/g, ""))) out.push("municipalRegistration");
  return Array.from(new Set(out));
}

/** Palavra usada na mensagem de CNPJ fora de situação ativa: "Este CNPJ está <baixado> na Receita Federal". */
export function situationWord(situation: string): string {
  const s = situation.toUpperCase();
  if (s.includes("BAIXAD")) return "baixado";
  if (s.includes("INAPT")) return "inapto";
  if (s.includes("SUSPENS")) return "suspenso";
  if (s.includes("NUL")) return "nulo";
  return "inativo";
}

/** Selo curto do CNPJ inativo ("Baixada", "Inapta"...). */
export function situationChip(situation: string): string {
  const s = situation.trim().toLowerCase();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Inativa";
}
