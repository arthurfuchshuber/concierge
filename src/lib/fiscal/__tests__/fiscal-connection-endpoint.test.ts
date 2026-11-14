import { describe, expect, it, vi } from "vitest";
import { handleSaveConnection, type ConnectionEndpointDeps } from "../connection-endpoint";

const req = (body: unknown, auth: string | null = "Bearer jwt") =>
  new Request("https://x/api/fiscal-connection", { method: "POST", headers: { ...(auth ? { authorization: auth } : {}), "content-type": "application/json" }, body: JSON.stringify(body) });
const ok = { environment: "homologation", token: "TOKEN-DE-TESTE-1234" };
const mk = (over: Partial<ConnectionEndpointDeps> = {}) => {
  const save = vi.fn(async () => ({ id: "c1", fingerprint: "abc123", webhookSecret: "seg" }));
  const deps: ConnectionEndpointDeps = { userIdFromBearer: async () => "u1", authorize: async () => ({ save }), ...over };
  return { deps, save };
};

describe("cadastro do token sem interface", () => {
  it("sem Bearer ou com JWT inválido: 401 e nada salvo", async () => {
    const { deps, save } = mk({ userIdFromBearer: async () => null });
    expect((await handleSaveConnection(req(ok, null), deps)).status).toBe(401);
    expect((await handleSaveConnection(req(ok), deps)).status).toBe(401);
    expect(save).not.toHaveBeenCalled();
  });
  it("quem não é titular recebe 403 e nada é salvo", async () => {
    const save = vi.fn();
    const { deps } = mk({ authorize: async () => { throw Object.assign(new Error("x"), { httpStatus: 403 }); } });
    expect((await handleSaveConnection(req(ok), deps)).status).toBe(403);
    expect(save).not.toHaveBeenCalled();
  });
  it("entrada inválida: 400 (inclui campos extras)", async () => {
    const { deps, save } = mk();
    expect((await handleSaveConnection(req({ environment: "x", token: "curto" }), deps)).status).toBe(400);
    expect((await handleSaveConnection(req({ ...ok, extra: 1 }), deps)).status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });
  it("titular: salva, devolve só id/impressão/caminho do webhook, sem cache e sem o token", async () => {
    const { deps, save } = mk();
    const res = await handleSaveConnection(req(ok), deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    expect(text).not.toContain(ok.token);
    expect(JSON.parse(text)).toEqual({ id: "c1", fingerprint: "abc123", webhookPath: "/api/public/webhooks/fiscal/c1/seg" });
    expect(save).toHaveBeenCalledWith(ok);
  });
});
