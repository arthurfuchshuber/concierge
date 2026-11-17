/** Formatação e textos das janelas fiscais (puro, testável). */
export const fmtCnpj = (d: string) => d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2}).*/, "$1.$2.$3/$4-$5");
export const fmtCep = (d: string) => d.replace(/^(\d{5})(\d{3}).*/, "$1-$2");
export const fmtPhone = (d: string) =>
  d.length === 11 ? d.replace(/^(\d{2})(\d{5})(\d{4})$/, "($1) $2-$3") : d.length === 10 ? d.replace(/^(\d{2})(\d{4})(\d{4})$/, "($1) $2-$3") : d;
export const fmtCnae = (d: string) => d.replace(/^(\d{4})(\d)(\d{2})$/, "$1-$2/$3");
export const fmtNationalCode = (c: string) => c.replace(/^(\d{2})(\d{2})(\d{2})$/, "$1.$2.$3");
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" });

export type SimplesOption = "nao_optante" | "mei" | "me_epp";
export const simplesLabel = (s: SimplesOption | null | undefined) =>
  s === "me_epp" ? "Sim · ME/EPP" : s === "mei" ? "Sim · MEI" : s === "nao_optante" ? "Não" : "—";

export const fiscalErrorText = (code?: string) =>
  ({
    cnpj_mismatch: "O CNPJ informado difere do cadastrado.",
    cnpj_invalid: "CNPJ inválido. Confira os números.",
    cnpj_in_use: "Este CNPJ já está ativo em outra conta.",
    certificate_invalid: "Certificado inválido. Confira o arquivo e a senha.",
    pfx_invalid: "Certificado inválido. Confira o arquivo e a senha.",
    password_required: "Informe a senha do certificado.",
    municipal_registration_required: "Informe a inscrição municipal.",
    email_invalid: "Informe um e-mail válido.",
    phone_invalid: "Informe um telefone válido.",
    interrupted: "A ativação foi interrompida. Envie o certificado de novo.",
    unreachable: "Não foi possível falar com o provedor agora. Tente de novo.",
  } as Record<string, string>)[code ?? ""] ?? "Não foi possível concluir. Confira os dados e tente de novo.";

/** Texto da faixa vermelha da janela de erro (mockup N). */
export function activationErrorText(code: string | null | undefined, cnpj: string) {
  if (code === "certificate_cnpj_mismatch") return `Não foi possível ativar. O certificado enviado pertence a outro CNPJ. Envie o certificado A1 da empresa ${fmtCnpj(cnpj)}.`;
  return `Não foi possível ativar. ${fiscalErrorText(code ?? undefined)}`;
}

export const REGIME_OPTIONS = [
  { value: 0, label: "Nenhum (padrão)" },
  { value: 1, label: "Ato cooperado (Sociedade cooperativa)" },
  { value: 2, label: "Estimativa" },
  { value: 3, label: "Microempresa municipal" },
  { value: 4, label: "Notário ou registrador" },
  { value: 5, label: "Profissional autônomo" },
  { value: 6, label: "Sociedade de profissionais" },
] as const;

export const parsePct = (v: string): number | null => {
  const t = v.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};
export const pctText = (n: number | null) => (n == null ? "" : String(n).replace(".", ","));
