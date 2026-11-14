import { createHash } from "node:crypto";

/** Guarda mínima dos documentos fiscais: 60 meses (decisão D-14, 14/11/2026). */
export const RETENTION_MONTHS = 60;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const FISCAL_BUCKET = "fiscal-documents";
export const FILE_URL_TTL_SECONDS = 60;
export type FileKind = "xml" | "pdf";

export class FiscalFileError extends Error {
  constructor(readonly code: "empty" | "too_large" | "not_xml" | "not_pdf" | "bad_kind", message: string) {
    super(message);
    this.name = "FiscalFileError";
  }
}

export function sha256Bytes(b: Uint8Array): string { return createHash("sha256").update(b).digest("hex"); }

/** Confere o conteúdo pela assinatura (não pela extensão) antes de gravar. */
export function validateFiscalFile(kind: FileKind, bytes: Uint8Array): void {
  if (kind !== "xml" && kind !== "pdf") throw new FiscalFileError("bad_kind", "Tipo de arquivo inválido.");
  if (bytes.byteLength === 0) throw new FiscalFileError("empty", "Arquivo vazio.");
  if (bytes.byteLength > MAX_FILE_BYTES) throw new FiscalFileError("too_large", "Arquivo grande demais (máx. 10 MB).");
  const head = Buffer.from(bytes.subarray(0, 64)).toString("latin1").replace(/^﻿|^\xEF\xBB\xBF/, "").trimStart();
  if (kind === "pdf" && !head.startsWith("%PDF-")) throw new FiscalFileError("not_pdf", "O arquivo não é um PDF.");
  if (kind === "xml" && !head.startsWith("<")) throw new FiscalFileError("not_xml", "O arquivo não é um XML.");
}

export function filePath(args: { ownerId: string; companyId: string; documentId: string; kind: FileKind; sha256: string }): string {
  return `${args.ownerId}/${args.companyId}/${args.documentId}/${args.kind}-${args.sha256.slice(0, 16)}.${args.kind}`;
}

export function contentType(kind: FileKind): string { return kind === "pdf" ? "application/pdf" : "application/xml"; }

/** Estado do aviso de vencimento do certificado A1 (30 dias de antecedência por padrão). */
export type CertificateAlert = { level: "unknown" | "ok" | "expiring" | "expired"; daysLeft: number | null };
export function certificateAlert(validUntilIso: string | null, now: Date = new Date(), warnDays = 30): CertificateAlert {
  if (!validUntilIso) return { level: "unknown", daysLeft: null };
  const t = Date.parse(validUntilIso);
  if (!Number.isFinite(t)) return { level: "unknown", daysLeft: null };
  const daysLeft = Math.floor((t - now.getTime()) / 86_400_000);
  if (t <= now.getTime()) return { level: "expired", daysLeft };
  return { level: daysLeft <= warnDays ? "expiring" : "ok", daysLeft };
}
