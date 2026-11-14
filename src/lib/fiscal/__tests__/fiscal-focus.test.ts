import { describe, expect, it, vi } from "vitest";
import { basicAuth, classifySend, FocusClient, FocusTransportError, mapQueryStatus, redactSecret, type FetchLike } from "../focus/client";
import { operationRef } from "../ref";
import { runSendSequence, type SendPorts } from "../send-sequence";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const res = (status: number, body: unknown): ReturnType<FetchLike> => Promise.resolve({ status, text: async () => JSON.stringify(body) });

describe("FocusClient", () => {
  it("usa Basic com token como usuário, ambiente correto e ref na query", async () => {
    const f = vi.fn<FetchLike>(() => res(201, { status: "processando_autorizacao" }));
    const c = new FocusClient({ environment: "homologation", token: "TKN", fetch: f });
    await c.issue("nfse", operationRef(ID), { a: 1 });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe(`https://homologacao.focusnfe.com.br/v2/nfse?ref=cia-${ID}`);
    expect(init.headers.Authorization).toBe(basicAuth("TKN"));
    expect(Buffer.from(init.headers.Authorization.slice(6), "base64").toString()).toBe("TKN:");
  });
  it("produção usa o host de produção", async () => {
    const f = vi.fn<FetchLike>(() => res(200, {}));
    await new FocusClient({ environment: "production", token: "T", fetch: f }).query("nfe", "r1");
    expect(f.mock.calls[0]![0]).toBe("https://api.focusnfe.com.br/v2/nfe/r1");
  });
  it("timeout e queda de conexão viram FocusTransportError sem vazar o token", async () => {
    const abort = Object.assign(new Error("aborted TKN"), { name: "AbortError" });
    const c1 = new FocusClient({ environment: "homologation", token: "TKN", fetch: () => Promise.reject(abort) });
    await expect(c1.query("nfe", "r")).rejects.toMatchObject({ reason: "timeout" });
    const c2 = new FocusClient({ environment: "homologation", token: "TKN", fetch: () => Promise.reject(new Error("ECONNRESET TKN")) });
    const err = (await c2.query("nfe", "r").catch((e: unknown) => e)) as FocusTransportError;
    expect(err).toBeInstanceOf(FocusTransportError);
    expect(err.reason).toBe("connection_lost");
    expect(err.message).not.toContain("TKN");
    expect(redactSecret("x TKN y", "TKN")).toBe("x [redacted] y");
  });
  it("cancelamento exige justificativa de 15 a 255 caracteres", () => {
    const c = new FocusClient({ environment: "homologation", token: "T", fetch: () => res(200, {}) });
    expect(() => c.cancel("nfe", "r", "curta")).toThrow("focus_cancel_reason_length");
  });
  it("sem token não instancia", () => expect(() => new FocusClient({ environment: "homologation", token: "", fetch: () => res(200, {}) })).toThrow());
});

describe("classificação", () => {
  it("2xx é só handoff; 5xx/429 inconclusivos; 4xx não mapeado é unsupported (lista definitiva vazia)", () => {
    expect(classifySend(201)).toBe("accepted");
    expect(classifySend(500)).toBe("inconclusive");
    expect(classifySend(429)).toBe("inconclusive");
    expect(classifySend(422)).toBe("unsupported");
  });
  it("status desconhecido nunca autoriza; autorizado sem protocolo não autoriza", () => {
    expect(mapQueryStatus(200, { status: "algo_novo" }).result).toBe("unmapped");
    expect(mapQueryStatus(200, { status: "autorizado" }).result).toBe("unmapped");
    expect(mapQueryStatus(200, { status: "autorizado", protocolo: "P" }).result).toBe("authorized");
    expect(mapQueryStatus(404, null).result).toBe("absent");
    expect(mapQueryStatus(500, {}).result).toBe("unmapped");
  });
});

function ports(over: Partial<SendPorts> = {}) {
  const log: string[] = [];
  const p: SendPorts = {
    plan: async () => (log.push("plan"), "att"),
    recordPayload: async () => void log.push("S1"),
    markSent: async () => (log.push("S2"), { ok: true }),
    markUnknown: async (_a, r) => void log.push(`unknown:${r}`),
    recordResponse: async () => void log.push("S4"),
    send: async () => (log.push("S3"), { status: 201, body: {} }),
    ...over,
  };
  return { p, log };
}
const args = { operationId: ID, authorizationId: "au", payloadHash: "h", redactedPayload: {}, adapterVersion: "v", hashBody: () => "hb", redactBody: (b: unknown) => b };

describe("sequência de envio P→S4", () => {
  it("ordem estrita e `sent` antes da rede", async () => {
    const { p, log } = ports();
    expect(await runSendSequence(p, args)).toMatchObject({ kind: "responded", responseClass: "accepted" });
    expect(log).toEqual(["plan", "S1", "S2", "S3", "S4"]);
  });
  it("portão negado: nenhuma chamada de rede", async () => {
    const { p, log } = ports({ markSent: async () => ({ ok: false, reason: "authorization_consumed" }) });
    expect(await runSendSequence(p, args)).toEqual({ kind: "denied", reason: "authorization_consumed" });
    expect(log).not.toContain("S3");
  });
  it("falha em S1: nada é enviado", async () => {
    const { p, log } = ports({ recordPayload: async () => { throw new Error("db"); } });
    await expect(runSendSequence(p, args)).rejects.toThrow("db");
    expect(log).not.toContain("S3");
  });
  it("timeout em S3 ⇒ unknown(timeout), sem S4 e sem reenvio", async () => {
    let calls = 0;
    const { p, log } = ports({ send: async () => { calls++; throw new FocusTransportError("timeout", "t"); } });
    expect(await runSendSequence(p, args)).toEqual({ kind: "unknown", reason: "timeout" });
    expect(calls).toBe(1);
    expect(log).toContain("unknown:timeout");
    expect(log).not.toContain("S4");
  });
  it("falha ao persistir E3 ⇒ unknown(response_not_persisted)", async () => {
    const { p, log } = ports({ recordResponse: async () => { throw new Error("db"); } });
    expect(await runSendSequence(p, args)).toEqual({ kind: "unknown", reason: "response_not_persisted" });
    expect(log).toContain("unknown:response_not_persisted");
  });
});

describe("ref", () => {
  it("determinística e validada", () => {
    expect(operationRef(ID)).toBe(`cia-${ID}`);
    expect(() => operationRef("x")).toThrow();
  });
});
