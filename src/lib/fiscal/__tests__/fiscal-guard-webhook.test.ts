import { describe, expect, it, vi } from "vitest";
import { requireFiscalAccess, type FiscalGuardPorts } from "../guard";
import { handleFocusWebhook, sha256Hex, webhookDedupeKey, type WebhookPorts } from "../webhook";
import { reconcileOne, type ReconcilePorts } from "../reconcile";

const O = "owner", U = "user";
const ports = (o: Partial<FiscalGuardPorts> = {}): FiscalGuardPorts => ({ moduleEnabled: async () => true, ...o });
const ACTIONS = ["empresas.ver","empresas.cadastrar","empresas.certificado","empresas.desativar","documentos.ver","documentos.preparar","documentos.consultar","documentos.baixar","documentos.cancelar-preparar","autorizacoes.ver","autorizacoes.autorizar","autorizacoes.rejeitar","provedor.ver","provedor.configurar","provedor.webhook","provedor.testar","auditoria"] as const;

describe("FiscalGuard (owner_only)", () => {
  it("módulo desabilitado nega até o dono", async () => {
    await expect(requireFiscalAccess(ports({ moduleEnabled: async () => false }), { userId: O, ownerId: O, action: "documentos.ver" })).rejects.toMatchObject({ code: "module_disabled", httpStatus: 403 });
  });
  it("só o titular passa, em toda ação", async () => {
    for (const a of ACTIONS) await requireFiscalAccess(ports(), { userId: O, ownerId: O, action: a });
  });
  it("qualquer outro papel (admin SaaS, admin operacional, membro, prestador) recebe 403 em toda ação, mesmo com módulo ativo", async () => {
    for (const who of ["saas-admin", "admin-operacional", "membro", "prestador"])
      for (const a of ACTIONS)
        await expect(requireFiscalAccess(ports(), { userId: who, ownerId: O, action: a })).rejects.toMatchObject({ code: "not_owner", httpStatus: 403 });
  });
  it("não-titular não descobre se o módulo está habilitado (mesmo erro com módulo ligado ou desligado)", async () => {
    const off = requireFiscalAccess(ports({ moduleEnabled: async () => false }), { userId: U, ownerId: O, action: "documentos.ver" });
    await expect(off).rejects.toMatchObject({ code: "not_owner" });
  });
  it("contexto vazio é entrada inválida (400), nunca acesso", async () => {
    await expect(requireFiscalAccess(ports(), { userId: "", ownerId: "", action: "documentos.ver" })).rejects.toMatchObject({ code: "invalid_input", httpStatus: 400 });
  });
});

describe("webhook", () => {
  const SECRET = "segredo-longo-de-teste";
  const mk = (over: Partial<WebhookPorts> = {}) => {
    const ingest = vi.fn(async (..._a: Parameters<WebhookPorts["ingest"]>) => ({ new: true }));
    const p: WebhookPorts = { loadConnection: async () => ({ webhookSecretHash: sha256Hex(SECRET), active: true }), ingest, ...over };
    return { p, ingest };
  };
  const body = JSON.stringify({ ref: "cia-0f8fad5b-d9cb-469f-a165-70867728950e", status: "autorizado" });
  it("segredo errado ou conexão inexistente: 401 idêntico e nada gravado", async () => {
    const { p, ingest } = mk();
    expect(await handleFocusWebhook(p, { connectionId: "c", secret: "errado", rawBody: body })).toEqual({ status: 401, code: "unauthorized" });
    expect(await handleFocusWebhook(mk({ loadConnection: async () => null }).p, { connectionId: "c", secret: SECRET, rawBody: body })).toEqual({ status: 401, code: "unauthorized" });
    expect(await handleFocusWebhook(mk({ loadConnection: async () => ({ webhookSecretHash: null, active: true }) }).p, { connectionId: "c", secret: "", rawBody: body })).toMatchObject({ status: 401 });
    expect(ingest).not.toHaveBeenCalled();
  });
  it("válido grava com chave de idempotência e ref como dica; duplicado devolve 200", async () => {
    const { p, ingest } = mk();
    expect(await handleFocusWebhook(p, { connectionId: "c", secret: SECRET, rawBody: body })).toEqual({ status: 202, code: "accepted" });
    expect(ingest).toHaveBeenCalledWith("c", webhookDedupeKey("c", body), sha256Hex(body), expect.anything(), "cia-0f8fad5b-d9cb-469f-a165-70867728950e");
    const dup = mk({ ingest: async () => ({ new: false }) });
    expect(await handleFocusWebhook(dup.p, { connectionId: "c", secret: SECRET, rawBody: body })).toEqual({ status: 200, code: "duplicate" });
  });
  it("corpo inválido e grande demais", async () => {
    expect((await handleFocusWebhook(mk().p, { connectionId: "c", secret: SECRET, rawBody: "{x" })).status).toBe(400);
    expect((await handleFocusWebhook(mk().p, { connectionId: "c", secret: SECRET, rawBody: "x".repeat(300_000) })).status).toBe(413);
  });
  it("ref fora do padrão é ignorada", async () => {
    const { p, ingest } = mk();
    await handleFocusWebhook(p, { connectionId: "c", secret: SECRET, rawBody: JSON.stringify({ ref: "outra" }) });
    expect(ingest.mock.calls[0]![4]).toBeNull();
  });
});

describe("reconciliação", () => {
  const cand = { operationId: "op", ref: "cia-x", documentKind: "nfse" as const, opKind: "issue" };
  const mk = (res: { status: number; body: unknown } | Error) => {
    const applyQuery = vi.fn(async () => {});
    const p: ReconcilePorts = { query: async () => { if (res instanceof Error) throw res; return res; }, applyQuery, hash: () => "h", redact: (b) => b };
    return { p, applyQuery };
  };
  it("falha de transporte não altera nada", async () => {
    const { p, applyQuery } = mk(new Error("x"));
    expect(await reconcileOne(p, cand)).toEqual({ operationId: "op", result: "transport_error" });
    expect(applyQuery).not.toHaveBeenCalled();
  });
  it("autorizado com protocolo é aplicado; sem protocolo vira unmapped; 404 = absent", async () => {
    expect((await reconcileOne(mk({ status: 200, body: { status: "autorizado", protocolo: "P" } }).p, cand)).result).toBe("authorized");
    expect((await reconcileOne(mk({ status: 200, body: { status: "autorizado" } }).p, cand)).result).toBe("unmapped");
    expect((await reconcileOne(mk({ status: 404, body: null }).p, cand)).result).toBe("absent");
  });
  it("resultado incompatível com o tipo da operação não é presumido", async () => {
    expect((await reconcileOne(mk({ status: 200, body: { status: "cancelado" } }).p, cand)).result).toBe("unmapped");
    expect((await reconcileOne(mk({ status: 200, body: { status: "autorizado", protocolo: "P" } }).p, { ...cand, opKind: "cancel" })).result).toBe("unmapped");
  });
});
