import { describe, expect, it, vi } from "vitest";
import { encryptConnectionKey } from "@/lib/connection-key-crypto.server";
import { extractFileLinks, FocusClient, resolveFileUrl, type FetchLike } from "../focus/client";
import { captureDocumentFiles } from "../service.server";

process.env.APP_USER_CONNECTION_KEY_SECRET = Buffer.alloc(32, 7).toString("base64");
const OWNER = "11111111-1111-4111-8111-111111111111";
const DOC = "33333333-3333-4333-8333-333333333333";
const CO = "22222222-2222-4222-8222-222222222222";
const TOKEN = "TOKEN-HML-ABCDEFGH";
const XML = new TextEncoder().encode('<?xml version="1.0"?><nfeProc/>');
const PDF = new TextEncoder().encode("%PDF-1.7 corpo");
const ab = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

describe("links de arquivos e anti-SSRF", () => {
  it("lê os campos documentados", () => {
    expect(extractFileLinks({ caminho_xml_nota_fiscal: "/a.xml", caminho_danfe: "/a.pdf" })).toEqual({ xml: "/a.xml", pdf: "/a.pdf" });
    expect(extractFileLinks({ caminho_pdf: "/b.pdf" })).toEqual({ xml: null, pdf: "/b.pdf" });
    expect(extractFileLinks(null)).toEqual({ xml: null, pdf: null });
  });
  it("só hosts da Focus, só https; token só no host da API", () => {
    expect(resolveFileUrl("homologation", "/arquivos/a.xml")).toEqual({ url: "https://homologacao.focusnfe.com.br/arquivos/a.xml", sendAuth: true });
    expect(resolveFileUrl("production", "https://api.focusnfe.com.br/x.pdf")).toMatchObject({ sendAuth: true });
    expect(resolveFileUrl("production", "https://arquivos.focusnfe.com.br/x.pdf")).toMatchObject({ sendAuth: false });
    for (const bad of ["http://api.focusnfe.com.br/x", "https://evil.com/x", "https://focusnfe.com.br.evil.com/x", "//evil.com/x", "https://u:p@api.focusnfe.com.br/x", "file:///etc/passwd", "javascript:1", "https://169.254.169.254/"])
      expect(resolveFileUrl("production", bad), bad).toBeNull();
  });
  it("fetchFile recusa host estranho sem chamar a rede e respeita o limite", async () => {
    const f = vi.fn<FetchLike>();
    const c = new FocusClient({ environment: "homologation", token: TOKEN, fetch: f });
    expect(await c.fetchFile("https://evil.com/x", 100)).toEqual({ rejected: "host" });
    expect(f).not.toHaveBeenCalled();
    const big: FetchLike = async () => ({ status: 200, text: async () => "", arrayBuffer: async () => new ArrayBuffer(200) });
    expect(await new FocusClient({ environment: "homologation", token: TOKEN, fetch: big }).fetchFile("/a", 100)).toEqual({ rejected: "too_large" });
  });
});

function fakeDb(status = "authorized") {
  const stored: string[] = [];
  const audit: Array<Record<string, unknown>> = [];
  const from = (t: string) => {
    const api: Record<string, unknown> = {};
    const ch = () => api;
    Object.assign(api, {
      select: ch, eq: ch, order: ch, is: ch,
      maybeSingle: async () => ({
        data: t === "fiscal_documents" ? { id: DOC, company_id: CO, document_kind: "nfe", status, ref: "cia-x" }
          : t === "fiscal_companies" ? { connection_id: "c1" }
          : t === "fiscal_provider_connections" ? { environment: "homologation", status: "active", owner_id: OWNER, secret_ref: { v: 1, ct: encryptConnectionKey(TOKEN) } }
          : null, error: null }),
      single: async () => ({ data: { id: "new" }, error: null }),
      insert: (p: Record<string, unknown>) => { if (t === "fiscal_audit") { audit.push(p); return Promise.resolve({ data: null, error: null }); } return api; },
    });
    return api;
  };
  const storage = { from: () => ({ upload: async (p: string) => { stored.push(p); return { error: null }; }, remove: async () => ({ error: null }) }) };
  return { db: { from, storage } as never, stored, audit };
}

describe("captura de XML/PDF", () => {
  const provider = (over: Record<string, unknown> = {}, files: Record<string, Uint8Array | number> = {}): { f: FetchLike; calls: Array<[string, Record<string, string>]> } => {
    const calls: Array<[string, Record<string, string>]> = [];
    const f: FetchLike = async (url, init) => {
      calls.push([url, init.headers]);
      if (url.includes("/v2/nfe/")) return { status: 200, text: async () => JSON.stringify({ status: "autorizado", caminho_xml_nota_fiscal: "/arq/n.xml", caminho_danfe: "/arq/n.pdf", ...over }) };
      const k = url.endsWith(".xml") ? "xml" : "pdf";
      const v = files[k] ?? (k === "xml" ? XML : PDF);
      return typeof v === "number" ? { status: v, text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) } : { status: 200, text: async () => "", arrayBuffer: async () => ab(v) };
    };
    return { f, calls };
  };
  it("guarda XML e PDF no bucket privado e audita sem conteúdo", async () => {
    const { db, stored, audit } = fakeDb();
    const { f, calls } = provider();
    const r = await captureDocumentFiles(db, OWNER, DOC, f);
    expect(r).toEqual({ stored: ["xml", "pdf"], skipped: [] });
    expect(stored).toHaveLength(2);
    expect(stored.every((p) => p.startsWith(`${OWNER}/${CO}/${DOC}/`))).toBe(true);
    expect(calls[1]![0]).toBe("https://homologacao.focusnfe.com.br/arq/n.xml");
    expect(JSON.stringify(audit)).not.toContain("nfeProc");
  });
  it("host estranho, link ausente, HTTP de erro e conteúdo trocado ficam em 'skipped' sem derrubar o outro", async () => {
    const a = fakeDb();
    expect((await captureDocumentFiles(a.db, OWNER, DOC, provider({ caminho_xml_nota_fiscal: "https://evil.com/x.xml", caminho_danfe: undefined }).f)).skipped).toEqual([{ kind: "xml", reason: "host" }, { kind: "pdf", reason: "link_ausente" }]);
    const b = fakeDb();
    const r = await captureDocumentFiles(b.db, OWNER, DOC, provider({}, { xml: 404, pdf: XML }).f);
    expect(r.stored).toEqual([]);
    expect(r.skipped).toEqual([{ kind: "xml", reason: "http_404" }, { kind: "pdf", reason: "not_pdf" }]);
    expect(b.stored).toHaveLength(0);
  });
  it("só documento autorizado; nunca muda estado fiscal", async () => {
    await expect(captureDocumentFiles(fakeDb("processing").db, OWNER, DOC, provider().f)).rejects.toThrow(/autorizados/);
  });
});
