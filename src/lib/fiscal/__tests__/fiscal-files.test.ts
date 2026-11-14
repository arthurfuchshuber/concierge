import { describe, expect, it, vi } from "vitest";
import { certificateAlert, filePath, FiscalFileError, sha256Bytes, validateFiscalFile } from "../files";
import { documentFileSignedUrl, storeDocumentFile } from "../service.server";

const OWNER = "11111111-1111-4111-8111-111111111111";
const DOC = "33333333-3333-4333-8333-333333333333";
const CO = "22222222-2222-4222-8222-222222222222";
const xml = new TextEncoder().encode('<?xml version="1.0"?><NFe/>');
const pdf = new TextEncoder().encode("%PDF-1.4 fake");

function fakeDb(opts: { dup?: boolean; insertFails?: boolean; uploadFails?: boolean; file?: Record<string, unknown> | null } = {}) {
  const calls = { upload: [] as string[], remove: [] as string[], inserts: [] as unknown[], audit: [] as unknown[], signed: [] as Array<[string, number]> };
  const from = (t: string) => {
    const api: Record<string, unknown> = {};
    const ch = () => api;
    Object.assign(api, {
      select: ch, eq: ch, order: ch, is: ch,
      maybeSingle: async () => ({ data: t === "fiscal_documents" ? { id: DOC, company_id: CO } : t === "fiscal_document_files" ? (opts.file !== undefined ? opts.file : opts.dup ? { id: "dup" } : null) : null, error: null }),
      single: async () => ({ data: opts.insertFails ? null : { id: "new" }, error: opts.insertFails ? { message: "x" } : null }),
      insert: (p: unknown) => { if (t === "fiscal_audit") { calls.audit.push(p); return Promise.resolve({ data: null, error: null }); } calls.inserts.push(p); return api; },
    });
    return api;
  };
  const storage = { from: () => ({
    upload: async (p: string) => { calls.upload.push(p); return { error: opts.uploadFails ? { message: "x" } : null }; },
    remove: async (p: string[]) => { calls.remove.push(...p); return { error: null }; },
    createSignedUrl: async (p: string, ttl: number) => { calls.signed.push([p, ttl]); return { data: { signedUrl: "https://signed/x" }, error: null }; },
  }) };
  return { db: { from, storage } as never, calls };
}

describe("arquivos fiscais", () => {
  it("valida pela assinatura do conteúdo, não pela extensão", () => {
    expect(() => validateFiscalFile("xml", xml)).not.toThrow();
    expect(() => validateFiscalFile("pdf", pdf)).not.toThrow();
    expect(() => validateFiscalFile("pdf", xml)).toThrow(FiscalFileError);
    expect(() => validateFiscalFile("xml", pdf)).toThrow(FiscalFileError);
    expect(() => validateFiscalFile("xml", new Uint8Array())).toThrow(/vazio/);
    expect(() => validateFiscalFile("xml", new Uint8Array(10 * 1024 * 1024 + 1).fill(60))).toThrow(/grande/);
  });
  it("caminho começa pela pasta do dono e inclui conta/documento", () => {
    const p = filePath({ ownerId: OWNER, companyId: CO, documentId: DOC, kind: "xml", sha256: sha256Bytes(xml) });
    expect(p.startsWith(`${OWNER}/${CO}/${DOC}/xml-`)).toBe(true);
  });
  it("grava objeto + metadado e audita sem conteúdo; repetição idêntica não duplica", async () => {
    const a = fakeDb();
    expect(await storeDocumentFile(a.db, OWNER, OWNER, { documentId: DOC, kind: "xml", bytes: xml })).toEqual({ id: "new", created: true });
    expect(a.calls.upload).toHaveLength(1);
    expect(JSON.stringify(a.calls.audit)).not.toContain("NFe");
    const b = fakeDb({ dup: true });
    expect(await storeDocumentFile(b.db, OWNER, OWNER, { documentId: DOC, kind: "xml", bytes: xml })).toEqual({ id: "dup", created: false });
    expect(b.calls.upload).toHaveLength(0);
  });
  it("falha ao registrar remove o objeto (nada órfão); falha de upload não registra", async () => {
    const a = fakeDb({ insertFails: true });
    await expect(storeDocumentFile(a.db, OWNER, OWNER, { documentId: DOC, kind: "pdf", bytes: pdf })).rejects.toThrow();
    expect(a.calls.remove).toEqual(a.calls.upload);
    const b = fakeDb({ uploadFails: true });
    await expect(storeDocumentFile(b.db, OWNER, OWNER, { documentId: DOC, kind: "pdf", bytes: pdf })).rejects.toThrow();
    expect(b.calls.inserts).toHaveLength(0);
  });
  it("link assinado dura 60 s, é auditado, e arquivo de outro dono não existe", async () => {
    const a = fakeDb({ file: { id: "f", storage_path: `${OWNER}/p.xml`, kind: "xml", document_id: DOC } });
    expect(await documentFileSignedUrl(a.db, OWNER, OWNER, "f")).toEqual({ url: "https://signed/x", expiresInSeconds: 60 });
    expect(a.calls.signed[0]![1]).toBe(60);
    expect(a.calls.audit).toHaveLength(1);
    await expect(documentFileSignedUrl(fakeDb({ file: null }).db, OWNER, OWNER, "f")).rejects.toThrow(/não encontrado/);
  });
});

describe("aviso de vencimento do certificado", () => {
  const now = new Date("2026-11-14T12:00:00Z");
  it("classifica ok / expiring (≤30 dias) / expired / unknown", () => {
    expect(certificateAlert(null, now)).toEqual({ level: "unknown", daysLeft: null });
    expect(certificateAlert("lixo", now).level).toBe("unknown");
    expect(certificateAlert("2027-06-01T00:00:00Z", now).level).toBe("ok");
    expect(certificateAlert("2026-12-10T00:00:00Z", now)).toMatchObject({ level: "expiring", daysLeft: 25 });
    expect(certificateAlert("2026-12-14T12:00:00Z", now).level).toBe("expiring");
    expect(certificateAlert("2026-11-01T00:00:00Z", now).level).toBe("expired");
  });
});
