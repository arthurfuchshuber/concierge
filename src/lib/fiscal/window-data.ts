/** Validação pura dos dados das janelas fiscais (sem banco, sem rede). Mensagens e códigos em português/estáveis. */
import { z } from "zod";
import { onlyDigits } from "./setup";

export const SPECIAL_REGIMES = [
  "Nenhum (padrão)", "Ato cooperado (Sociedade cooperativa)", "Estimativa", "Microempresa municipal",
  "Notário ou registrador", "Profissional autônomo", "Sociedade de profissionais",
] as const;

const pct = z.number().min(0).max(100).nullable().optional();
const opt = (n: number) => z.string().trim().max(n).nullish().transform((v) => (v ? v : null));

export const ServiceInput = z.object({
  nationalCode: z.string().transform(onlyDigits).pipe(z.string().length(6)),
  serviceCode: opt(20),
  nbsCode: z.string().trim().max(13).regex(/^[0-9.]*$/).nullish().transform((v) => (v ? v : null)),
  description: z.string().trim().min(3).max(2000),
  isDefault: z.boolean().default(false),
  inssPct: pct, irPct: pct,
  cst: opt(10), cclassTrib: opt(10), operationIndicator: opt(10),
});
export type ServiceInput = z.infer<typeof ServiceInput>;

export const CompanyEditInput = z.object({
  tradeName: z.string().trim().max(200).nullish(),
  municipalRegistration: z.string().trim().min(1).max(30),
  email: z.string().trim().toLowerCase().email().max(200).nullish(),
  phone: z.string().transform(onlyDigits).pipe(z.string().min(10).max(11)).nullish(),
  specialRegime: z.number().int().min(0).max(6),
  dpsSeries: z.string().regex(/^[0-9]{1,5}$/),
  dpsNextNumber: z.number().int().min(1).max(999_999_999),
});

export const PreferencesInput = z.object({
  approximateTaxes: z.enum(["none", "included"]),
  invoiceNote: z.string().trim().max(2000).nullish(),
  withholdingTextIr: z.string().trim().max(500).nullish(),
  withholdingTextCsrf: z.string().trim().max(500).nullish(),
  withholdingTextInss: z.string().trim().max(500).nullish(),
});

/** Resposta da Focus à criação da empresa → código estável para a janela (mockup N: certificado de outro CNPJ). */
export function classifyProviderRejection(status: number, body: unknown): string {
  const text = (typeof body === "string" ? body : JSON.stringify(body ?? "")).toLowerCase();
  if (/certificad/.test(text) && /cnpj/.test(text)) return "certificate_cnpj_mismatch";
  if (/senha/.test(text) && /certificad/.test(text)) return "certificate_invalid";
  if (/certificad/.test(text)) return "certificate_invalid";
  return `http_${status}`;
}
