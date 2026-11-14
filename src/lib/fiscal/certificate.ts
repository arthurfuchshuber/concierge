/**
 * Certificado digital A1 — fluxo ESTRITAMENTE write-only (diretriz do proprietário, 14/11/2026).
 * O `.pfx` e a senha existem só na memória da requisição, são enviados à Focus (POST /v2/empresas) e descartados.
 * Este módulo não importa nada de banco/storage e não expõe nenhuma leitura do certificado.
 */
export const CERT_BASE64_FIELD = "arquivo_certificado_base64"; // nomes documentados pela Focus
export const CERT_PASSWORD_FIELD = "senha_certificado";
const MAX_PFX_BYTES = 256 * 1024;

export class CertificateInputError extends Error {
  constructor(readonly code: "pfx_invalid" | "pfx_too_large" | "password_required" | "reserved_field" | "cnpj_mismatch", message: string) {
    super(message);
    this.name = "CertificateInputError";
  }
}

/** Valida SEM decodificar para disco: só tamanho e alfabeto base64. Não tenta abrir o PKCS#12 (sem dependência de parsing). */
export function validateCertificateInput(pfxBase64: string, password: string): void {
  if (!password) throw new CertificateInputError("password_required", "Informe a senha do certificado.");
  const clean = pfxBase64.replace(/\s+/g, "");
  if (!clean || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean) || clean.length % 4 !== 0) throw new CertificateInputError("pfx_invalid", "Arquivo de certificado inválido.");
  if (Math.floor((clean.length * 3) / 4) > MAX_PFX_BYTES) throw new CertificateInputError("pfx_too_large", "Arquivo de certificado grande demais.");
}

export function buildCompanyBody(companyFields: Record<string, unknown>, pfxBase64: string, password: string, taxId: string): Record<string, unknown> {
  for (const k of Object.keys(companyFields)) {
    if (k === CERT_BASE64_FIELD || k === CERT_PASSWORD_FIELD) throw new CertificateInputError("reserved_field", "Campos de certificado não são aceitos em dados da empresa.");
  }
  const cnpj = companyFields.cnpj;
  if (typeof cnpj === "string" && cnpj.replace(/\D/g, "") !== taxId) throw new CertificateInputError("cnpj_mismatch", "O CNPJ informado difere do cadastrado.");
  return { ...companyFields, [CERT_BASE64_FIELD]: pfxBase64.replace(/\s+/g, ""), [CERT_PASSWORD_FIELD]: password };
}

/** Remove do texto qualquer ocorrência do `.pfx` (base64) ou da senha. Usado em toda mensagem de erro/auditoria. */
export function scrubCertificate(text: string, pfxBase64: string, password: string): string {
  let out = text;
  const clean = pfxBase64.replace(/\s+/g, "");
  if (clean) out = out.split(clean).join("[redacted]");
  if (password) out = out.split(password).join("[redacted]");
  return out;
}

/**
 * Validade do certificado a partir da RESPOSTA do provedor. O nome do campo na resposta da Focus NÃO está confirmado (N/L):
 * lista explícita e provisória, a validar na homologação; ausente ⇒ null (a interface mostra "validade não informada").
 */
export const EXPIRY_FIELDS_UNCONFIRMED = ["certificado_valido_ate", "certificado_validade", "data_expiracao_certificado"] as const;
export function parseCertificateExpiry(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  for (const f of EXPIRY_FIELDS_UNCONFIRMED) {
    const v = b[f];
    if (typeof v === "string") {
      const t = Date.parse(v);
      if (Number.isFinite(t)) return new Date(t).toISOString();
    }
  }
  return null;
}

export function formatCertificateLabel(validUntilIso: string | null): string | null {
  if (!validUntilIso) return null;
  const d = new Date(validUntilIso);
  const dd = String(d.getUTCDate()).padStart(2, "0"), mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `Certificado A1 válido até ${dd}/${mm}/${d.getUTCFullYear()}`;
}
