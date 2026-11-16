import { describe, expect, it, vi } from "vitest";
import { handleFocusWebhook, sha256Hex, webhookDedupeKey, type WebhookPorts } from "../webhook";
import { drainPendingEvents, ensureTenantWebhook, processWebhookEvent, runInitialSync, setupCompanyWithCertificate } from "../service.server";
import { FocusClient, type FetchLike } from "../focus/client";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const REF = "cia-0f8fad5b-d9cb-469f-a165-70867728950e";
const PFX = Buffer.from("pfx-binario-de-teste-0123456789").toString("base64");
const setupArgs = { taxId: "11.222.333/0001-81", legalName: "Empresa Teste Ltda", tradeName: null, municipalRegistration: "12345", address: { cep: "85851-000", street: "Rua A", number: "10", neighborhood: "Centro", city: "Foz", state: "PR" }, pfxBase64: PFX, password: "senha-secreta-123" };

type Calls = Array<{ t: string; op: string; p?: unknown }>;
/** Banco falso: `maybe` por tabela, `list` por tabela, `claim` decide se o UPDATE atômico de initial_sync_at "ganha". */
const PLAT = { id: "plat", status: "active", owner_id: null, environment: "production", secret_ref: null };
// conexões consultadas em ordem: ensurePlatformConnection, focusFor, ensureTenantWebhook (sem webhook ainda)
const connSeq = () => [PLAT, PLAT, null];
function fakeDb(o: { maybe?: Record<string, unknown>; list?: Record<string, unknown[]>; claim?: boolean } = {}) {
  const calls: Calls = [];
  const from = (t: string) => {
    let claiming = false;
    const api: Record<string, unknown> = {};
    const ch = () => api;
    Object.assign(api, {
      select: ch, eq: ch, is: ch, or: ch, order: ch, limit: ch,
      maybeSingle: async () => { const v = o.maybe?.[t]; return { data: (Array.isArray(v) ? v.shift() : v) ?? null, error: null }; },
      single: async () => ({ data: { id: `novo-${t}` }, error: null }),
      insert: (p: unknown) => { calls.push({ t, op: "insert", p }); return api; },
      update: (p: unknown) => { calls.push({ t, op: "update", p }); claiming = !!(p as Record<string, unknown>)?.initial_sync_at; return api; },
      upsert: async (p: unknown) => { calls.push({ t, op: "upsert", p }); return { data: null, error: null }; },
      then: (r: (v: unknown) => unknown) => r(claiming ? { data: o.claim === false ? [] : [{ id: "c" }], error: null } : { data: o.list?.[t] ?? null, error: null }),
    });
    return api;
  };
  const rpc = async (fn: string, p: unknown) => { calls.push({ t: "rpc", op: fn, p }); return { data: null, error: null }; };
  return { db: { from, rpc } as never, calls };
}
const fetchOk = (status = 200, body: unknown = { certificado_valido_ate: "2027-05-10T00:00:00Z" }) => vi.fn<FetchLike>(async () => ({ status, text: async () => JSON.stringify(body) }));
const client = (f: FetchLike) => new FocusClient({ environment: "production", token: "MASTER-TOKEN-PROD-XYZ", fetch: f });

describe("webhook: processamento imediato (sem cron)", () => {
  const SECRET = "segredo-do-tenant";
  const base = (over: Partial<WebhookPorts> = {}) => {
    const process = vi.fn(async () => {});
    const ports: WebhookPorts = { loadConnection: async () => ({ webhookSecretHash: sha256Hex(SECRET), active: true }), ingest: async () => ({ new: true, id: "ev1" }), process, ...over };
    return { ports, process };
  };
  const raw = JSON.stringify({ ref: REF, status: "autorizado" });
  it("evento novo é processado na hora, com o id gravado", async () => {
    const { ports, process } = base();
    expect(await handleFocusWebhook(ports, { connectionId: "c", secret: SECRET, rawBody: raw })).toEqual({ status: 202, code: "accepted" });
    expect(process).toHaveBeenCalledWith("ev1", "c");
  });
  it("reentrega de evento que ficou pendente é reprocessada; duplicado já concluído não", async () => {
    const pending = base({ ingest: async () => ({ new: false }), findPending: async (c, k) => (k === webhookDedupeKey(c, raw) ? "ev-pend" : null) });
    expect((await handleFocusWebhook(pending.ports, { connectionId: "c", secret: SECRET, rawBody: raw })).status).toBe(200);
    expect(pending.process).toHaveBeenCalledWith("ev-pend", "c");
    const done = base({ ingest: async () => ({ new: false }), findPending: async () => null });
    await handleFocusWebhook(done.ports, { connectionId: "c", secret: SECRET, rawBody: raw });
    expect(done.process).not.toHaveBeenCalled();
  });
  it("falha no processamento NÃO derruba a resposta ao provedor (evento segue pendente)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { ports } = base({ process: async () => { throw new Error("boom"); } });
    expect(await handleFocusWebhook(ports, { connectionId: "c", secret: SECRET, rawBody: raw })).toEqual({ status: 202, code: "accepted" });
    err.mockRestore();
  });
  it("segredo errado não processa nada", async () => {
    const { ports, process } = base();
    expect((await handleFocusWebhook(ports, { connectionId: "c", secret: "errado", rawBody: raw })).status).toBe(401);
    expect(process).not.toHaveBeenCalled();
  });
});

describe("processWebhookEvent: isolamento e descarte seguro", () => {
  it("evento sem ref ou sem operação é ignorado (fica registrado, nunca some em silêncio)", async () => {
    const a = fakeDb();
    expect(await processWebhookEvent(a.db, { id: "e", ref: null, connection_id: "c" })).toBe("ignored");
    const b = fakeDb();
    expect(await processWebhookEvent(b.db, { id: "e", ref: REF, connection_id: "c" })).toBe("ignored");
    expect(b.calls.find((c) => c.op === "fiscal_webhook_finish")?.p).toMatchObject({ p_event: "e", p_status: "ignored" });
  });
  it("evento de um tenant não age sobre a operação de outro", async () => {
    const { db, calls } = fakeDb({ maybe: { fiscal_operations: { id: "op", owner_id: OWNER, ref: REF, kind: "issue", document_id: "d", company_id: "co" }, fiscal_documents: { document_kind: "nfse" } } });
    expect(await processWebhookEvent(db, { id: "e", ref: REF, connection_id: "c", owner_id: OTHER })).toBe("ignored");
    expect(calls.some((c) => c.t === "fiscal_companies")).toBe(false);
  });
});

describe("cadastro automático do webhook (POST /v2/hooks)", () => {
  it("registra um gatilho por evento com a URL do tenant e grava só o HASH do segredo", async () => {
    const { db, calls } = fakeDb();
    const f = fetchOk(201, {});
    const r = await ensureTenantWebhook(db, OWNER, OWNER, "11222333000181", client(f));
    expect(r.state).toBe("registered");
    const sent = f.mock.calls.map(([url, init]) => ({ url, body: JSON.parse(init.body as string) }));
    expect(sent.map((x) => x.body.event)).toEqual(["nfse", "nfsen", "nfe"]);
    expect(sent.every((x) => x.url === "https://api.focusnfe.com.br/v2/hooks" && x.body.cnpj === "11222333000181")).toBe(true);
    const url = sent[0].body.url as string;
    const m = url.match(/^https:\/\/conciergeia\.app\/api\/public\/webhooks\/fiscal\/([^/]+)\/([^/]+)$/)!;
    expect(m).toBeTruthy();
    const row = calls.find((c) => c.t === "fiscal_provider_connections" && c.op === "insert")!.p as Record<string, unknown>;
    expect(row).toMatchObject({ owner_id: OWNER, environment: "production", secret_ref: null, status: "pending", webhook_secret_hash: sha256Hex(m[2]) });
    const everything = JSON.stringify(calls);
    expect(everything).not.toContain(m[2]);               // o segredo em claro nunca é gravado (nem na auditoria)
    expect(everything).not.toContain("MASTER-TOKEN-PROD-XYZ");
    expect(calls.some((c) => c.t === "fiscal_provider_connections" && c.op === "update" && (c.p as Record<string, unknown>).status === "active")).toBe(true);
  });
  it("já ativo ⇒ não recadastra", async () => {
    const { db } = fakeDb({ maybe: { fiscal_provider_connections: { id: "w", status: "active", webhook_secret_hash: "h" } } });
    const f = fetchOk();
    expect((await ensureTenantWebhook(db, OWNER, OWNER, "11222333000181", client(f))).state).toBe("already");
    expect(f).not.toHaveBeenCalled();
  });
  it("Focus recusa ⇒ conexão fica pendente e o erro é registrado sem a URL", async () => {
    const { db, calls } = fakeDb();
    const r = await ensureTenantWebhook(db, OWNER, OWNER, "11222333000181", client(fetchOk(422, { erro: "x" })));
    expect(r).toMatchObject({ state: "failed", code: "hook_nfse:http_422" });
    expect(calls.some((c) => c.t === "fiscal_provider_connections" && c.op === "update" && (c.p as Record<string, unknown>).status === "active")).toBe(false);
    expect(JSON.stringify(calls)).not.toContain("/api/public/webhooks/");
  });
});

describe("carga retroativa única + blindagem da janela de onboarding", () => {
  it("a carga é tomada de forma atômica: só a primeira execução roda", async () => {
    const first = fakeDb({ claim: true });
    expect(await runInitialSync(first.db, OWNER, OWNER, "co", "w")).toMatchObject({ ran: true });
    expect(first.calls.find((c) => c.op === "update")?.p).toHaveProperty("initial_sync_at");
    const second = fakeDb({ claim: false });
    expect(await runInitialSync(second.db, OWNER, OWNER, "co", "w")).toEqual({ ran: false, documents: 0, stored: 0 });
    expect(second.calls.some((c) => c.t === "fiscal_audit")).toBe(false);
  });
  it("a carga consome eventos que chegaram durante a ativação (nenhuma nota fica na janela)", async () => {
    const { db, calls } = fakeDb({ claim: true, list: { fiscal_webhook_events: [{ id: "e1", ref: null, connection_id: "w" }, { id: "e2", ref: null, connection_id: "w" }] } });
    await runInitialSync(db, OWNER, OWNER, "co", "w");
    expect(calls.filter((c) => c.op === "fiscal_webhook_finish").map((c) => (c.p as Record<string, unknown>).p_event)).toEqual(["e1", "e2"]);
    expect(await drainPendingEvents(fakeDb().db, "w", 5)).toBe(0);
  });
  it("ativação: webhook é cadastrado ANTES da carga; carga só roda com webhook ativo", async () => {
    process.env.FOCUSNFE_API = "MASTER-TOKEN-PROD-XYZ";
    const ok = fakeDb({ claim: true, maybe: { fiscal_provider_connections: connSeq() } });
    const f = fetchOk();
    const r = await setupCompanyWithCertificate(ok.db, OWNER, setupArgs, f);
    expect(r).toMatchObject({ ok: true, webhook: "registered" });
    const urls = f.mock.calls.map(([u]) => u);
    expect(urls[0]).toContain("/v2/empresas");
    expect(urls.slice(1)).toEqual(Array(3).fill("https://api.focusnfe.com.br/v2/hooks"));
    const iHook = ok.calls.findIndex((c) => c.t === "fiscal_provider_connections" && c.op === "update" && (c.p as Record<string, unknown>).status === "active");
    const iSync = ok.calls.findIndex((c) => c.t === "fiscal_provider_connections" && c.op === "update" && (c.p as Record<string, unknown>).initial_sync_at);
    expect(iHook).toBeGreaterThan(-1);
    expect(iSync).toBeGreaterThan(iHook);

    // webhook recusado ⇒ ativação vale, mas a carga NÃO é consumida (continua devida)
    const bad = fakeDb({ claim: true, maybe: { fiscal_provider_connections: connSeq() } });
    const f2 = vi.fn<FetchLike>(async (url) => (url.includes("/v2/hooks") ? { status: 500, text: async () => "{}" } : { status: 200, text: async () => JSON.stringify({ certificado_valido_ate: "2027-05-10T00:00:00Z" }) }));
    expect(await setupCompanyWithCertificate(bad.db, OWNER, setupArgs, f2)).toMatchObject({ ok: true, webhook: "failed" });
    expect(bad.calls.some((c) => (c.p as Record<string, unknown> | undefined)?.initial_sync_at)).toBe(false);
  });
});
