import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { LlmRequest, LlmResult } from "@/lib/guest-ai/llm/contracts";
import { CONSERVATIVE_CONTEXT_WINDOW, GUEST_AI_MODELS } from "@/lib/guest-ai/llm/models";
import { PROBE_CASES, PROBE_FLAG, handleProbeRequest, isProbeEnabled, runProbe } from "@/lib/guest-ai/llm/probe.server";

const okResult = (req: LlmRequest): LlmResult => ({
  ok: true,
  text: "TEXTO GERADO QUE NÃO PODE VAZAR",
  json: req.responseFormat === "json" ? { ok: true } : undefined,
  finishReason: "stop",
  telemetry: {
    provider: "fake",
    model: req.model,
    purpose: "test",
    latencyMs: 420,
    attempts: 1,
    usage: { inputTokens: 30, outputTokens: 5, reasoningTokens: req.reasoningEffort === "low" ? 12 : 0, totalTokens: 35, source: "provider" },
    costUsd: 0.00001,
    providerRequestId: null,
    traceId: req.traceId ?? null,
  },
});
const spyGenerate = () => {
  const calls: LlmRequest[] = [];
  return { calls, generate: async (r: LlmRequest) => { calls.push(r); return okResult(r); } };
};
const post = (url = "https://x.test/api/public/guest-ai/llm-probe") => new Request(url, { method: "POST" });

describe("B1 · Sonda D14 — DESLIGADA por padrão", () => {
  it("sem a chave (ou com qualquer valor ≠ 'on') ⇒ 404, sem verificar segredo e sem nenhuma chamada", async () => {
    for (const env of [{}, { [PROBE_FLAG]: "" }, { [PROBE_FLAG]: "true" }, { [PROBE_FLAG]: "ON" }, { [PROBE_FLAG]: "1" }]) {
      const s = spyGenerate();
      let verified = 0;
      const res = await handleProbeRequest(post(), { env, verify: () => { verified += 1; return true; }, generate: s.generate });
      expect(res.status).toBe(404);
      expect(verified).toBe(0);
      expect(s.calls).toHaveLength(0);
    }
  });
  it("o ambiente real deste repositório não liga a sonda (variável ausente)", () => {
    expect(isProbeEnabled(process.env)).toBe(false);
  });
  it("ligada mas sem segredo de cron ⇒ 401 e nenhuma chamada; método errado ⇒ 405", async () => {
    const s = spyGenerate();
    expect((await handleProbeRequest(post(), { env: { [PROBE_FLAG]: "on" }, verify: () => false, generate: s.generate })).status).toBe(401);
    expect((await handleProbeRequest(new Request("https://x.test/p"), { env: { [PROBE_FLAG]: "on" }, verify: () => true, generate: s.generate })).status).toBe(405);
    expect(s.calls).toHaveLength(0);
  });
  it("modelo desconhecido no filtro ⇒ 400 sem chamadas", async () => {
    const s = spyGenerate();
    const res = await handleProbeRequest(post("https://x.test/p?model=openai/inexistente"), { env: { [PROBE_FLAG]: "on" }, verify: () => true, generate: s.generate });
    expect(res.status).toBe(400);
    expect(s.calls).toHaveLength(0);
  });
});

describe("B1 · Sonda D14 — quando autorizada (simulada aqui)", () => {
  it("roda os casos sintéticos em todos os modelos cadastrados e devolve SÓ telemetria (nunca o texto)", async () => {
    const s = spyGenerate();
    const res = await handleProbeRequest(post(), { env: { [PROBE_FLAG]: "on" }, verify: () => true, generate: s.generate });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Array<Record<string, unknown>> };
    expect(s.calls).toHaveLength(GUEST_AI_MODELS.size * PROBE_CASES.length);
    expect(body.results).toHaveLength(s.calls.length);
    expect(JSON.stringify(body)).not.toContain("TEXTO GERADO");
    expect(Object.keys(body.results[0]!).sort()).toEqual(
      ["model", "wire", "case", "ok", "code", "httpStatus", "latencyMs", "attempts", "inputTokens", "outputTokens", "reasoningTokens", "usageSource", "costUsd", "jsonValid"].sort(),
    );
    const json = body.results.find((r) => r["case"] === "json_low")!;
    expect(json["jsonValid"]).toBe(true);
    expect(body.results.find((r) => r["case"] === "text_low")!["reasoningTokens"]).toBe(12);
  });
  it("prompts 100% sintéticos: sem dados de cliente, propósito 'test', limite de saída baixo", async () => {
    const s = spyGenerate();
    await runProbe({ generate: s.generate });
    for (const c of s.calls) {
      expect(c.purpose).toBe("test");
      expect(c.maxOutputTokens).toBeLessThanOrEqual(256);
      expect(c.messages).toHaveLength(2);
      expect(c.forbiddenValues).toBeUndefined();
      expect(c.traceId).toMatch(/^probe:(text_none|text_low|json_low)$/);
    }
    const texts = s.calls.flatMap((c) => c.messages.map((m) => m.content)).join(" ");
    expect(texts).not.toMatch(/@|\d{4,}|reserva|hóspede [A-Z]|rua|senha/i);
  });
  it("filtro por modelo roda só aquele modelo", async () => {
    const s = spyGenerate();
    await runProbe({ generate: s.generate, onlyModel: "google/gemini-3.8-flash" });
    expect(new Set(s.calls.map((c) => c.model))).toEqual(new Set(["google/gemini-3.8-flash"]));
  });
  it("falha de um modelo é reportada com código, sem interromper os demais", async () => {
    const res = await runProbe({
      generate: async (r) => (r.model.startsWith("openai/") ? { ok: false, error: { code: "bad_request", retryable: false, httpStatus: 400 }, telemetry: okResult(r).telemetry } : okResult(r)),
    });
    expect(res.filter((r) => !r.ok).every((r) => r.code === "bad_request" && r.httpStatus === 400)).toBe(true);
    expect(res.filter((r) => r.ok).length).toBeGreaterThan(0);
  });
});

describe("B1 · registro de modelos: contextWindowTokens", () => {
  it("todo modelo tem janela de contexto conservadora e maior que o teto de saída", () => {
    expect(CONSERVATIVE_CONTEXT_WINDOW).toBe(128_000);
    for (const s of GUEST_AI_MODELS.values()) {
      expect(s.contextWindowTokens).toBe(CONSERVATIVE_CONTEXT_WINDOW);
      expect(s.contextWindowTokens).toBeGreaterThan(s.maxOutputTokens);
    }
  });
});

describe("B1 · rota da sonda", () => {
  it("a rota só delega ao handler (chave + segredo); não contém lógica nem chamada própria", () => {
    const src = readFileSync(path.resolve(__dirname, "../../../routes/api/public/guest-ai.llm-probe.ts"), "utf8");
    expect(src).toMatch(/handleProbeRequest/);
    expect(src).not.toMatch(/generateGuestLlm|fetch\(|LOVABLE_API_KEY/);
  });
});
