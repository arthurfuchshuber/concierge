import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { LlmRequest, LlmResult } from "@/lib/guest-ai/llm/contracts";
import { CONSERVATIVE_CONTEXT_WINDOW, GUEST_AI_MODELS } from "@/lib/guest-ai/llm/models";
import { PROBE_CASES, PROBE_FLAG, PROBE_MAX_CONCURRENCY, PROBE_MAX_OUTPUT_TOKENS, PROBE_TIMEOUT_MS, handleProbeRequest, isProbeEnabled, runProbe } from "@/lib/guest-ai/llm/probe.server";
import { safeEqual } from "@/lib/cron-auth.server";

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

describe("Fechamento B1 · item 2 — auditoria de segurança da sonda", () => {
  /** Requisição cujo corpo registra se foi lido. */
  const trackedPost = (method = "POST") => {
    let pulled = false;
    // highWaterMark 0: o stream só é puxado se alguém de fato ler o corpo
    const body = new ReadableStream({ pull(c) { pulled = true; c.enqueue(new TextEncoder().encode("{}")); c.close(); } }, { highWaterMark: 0 });
    const r = new Request("https://x.test/api/public/guest-ai/llm-probe", { method, body, duplex: "half" } as RequestInit);
    return { r, wasRead: () => pulled || r.bodyUsed };
  };

  it("o corpo da requisição NUNCA é lido, em nenhum caminho (404, 405, 401, 200)", async () => {
    const s = spyGenerate();
    const off = trackedPost();
    expect((await handleProbeRequest(off.r, { env: {}, verify: () => true, generate: s.generate })).status).toBe(404);
    expect(off.wasRead()).toBe(false);
    const put = trackedPost("PUT");
    expect((await handleProbeRequest(put.r, { env: { [PROBE_FLAG]: "on" }, verify: () => true, generate: s.generate })).status).toBe(405);
    expect(put.wasRead()).toBe(false);
    const noSecret = trackedPost();
    expect((await handleProbeRequest(noSecret.r, { env: { [PROBE_FLAG]: "on" }, verify: () => false, generate: s.generate })).status).toBe(401);
    expect(noSecret.wasRead()).toBe(false);
    const ok = trackedPost();
    expect((await handleProbeRequest(ok.r, { env: { [PROBE_FLAG]: "on" }, verify: () => true, generate: s.generate })).status).toBe(200);
    expect(ok.wasRead()).toBe(false);
  });

  it("sondagem concorrente no mesmo processo ⇒ 429 sem nenhuma chamada extra (sem custo)", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((r) => { release = r; });
    const calls: LlmRequest[] = [];
    const generate = async (r: LlmRequest) => { calls.push(r); await gate; return okResult(r); };
    const env = { [PROBE_FLAG]: "on" };
    const first = handleProbeRequest(post(), { env, verify: () => true, generate });
    await Promise.resolve();
    const before = calls.length;
    const second = await handleProbeRequest(post(), { env, verify: () => true, generate });
    expect(second.status).toBe(429);
    expect(calls.length).toBe(before);
    release!();
    expect((await first).status).toBe(200);
    // trava liberada ao terminar
    expect((await handleProbeRequest(post(), { env, verify: () => true, generate: spyGenerate().generate })).status).toBe(200);
  });

  it("trava liberada mesmo se a sondagem falhar por completo", async () => {
    const env = { [PROBE_FLAG]: "on" };
    await handleProbeRequest(post(), { env, verify: () => true, generate: async () => { throw new Error("tudo caiu"); } });
    expect((await handleProbeRequest(post(), { env, verify: () => true, generate: spyGenerate().generate })).status).toBe(200);
  });

  it("isolamento de falha: um modelo que LANÇA não derruba os demais (vira internal_error só nele)", async () => {
    const res = await runProbe({
      generate: async (r) => { if (r.model === "openai/gpt-6-astra") throw new Error("contrato violado"); return okResult(r); },
    });
    const broken = res.filter((r) => r.model === "openai/gpt-6-astra");
    expect(broken.length).toBe(PROBE_CASES.length);
    expect(broken.every((r) => !r.ok && r.code === "internal_error" && r.costUsd === 0)).toBe(true);
    expect(res.filter((r) => r.model !== "openai/gpt-6-astra").every((r) => r.ok)).toBe(true);
  });

  it("limites de custo: ≤ 256 tokens de saída, prazo de 15 s por caso, concorrência ≤ 4, no máximo 12 chamadas", async () => {
    expect(PROBE_MAX_OUTPUT_TOKENS).toBe(256);
    expect(PROBE_TIMEOUT_MS).toBe(15_000);
    expect(PROBE_MAX_CONCURRENCY).toBe(4);
    let inFlight = 0;
    let peak = 0;
    const calls: LlmRequest[] = [];
    await runProbe({
      concurrency: 99,
      generate: async (r) => { calls.push(r); inFlight += 1; peak = Math.max(peak, inFlight); await new Promise((x) => setTimeout(x, 1)); inFlight -= 1; return okResult(r); },
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(calls.length).toBeLessThanOrEqual(12);
    expect(calls.every((c) => c.maxOutputTokens === 256 && c.timeoutMs === 15_000)).toBe(true);
  });

  it("a sonda não registra nada em log por conta própria e não referencia dados reais", () => {
    const src = readFileSync(path.resolve(__dirname, "../llm/probe.server.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(src).not.toMatch(/console\./);
    expect(src).not.toMatch(/guest-ai\/(data|context)|supabase|getGuestAiDb|reservation|conversation/i);
  });

  it("safeEqual (segredo de cron): comparação sem saída antecipada — iguala só o valor exato", () => {
    const secret = "s3cret-value-0123456789";
    expect(safeEqual(secret, secret)).toBe(true);
    expect(safeEqual(secret.slice(0, -1) + "X", secret)).toBe(false); // difere só no último caractere
    expect(safeEqual("X" + secret.slice(1), secret)).toBe(false); // difere só no primeiro
    expect(safeEqual(secret.slice(0, 5), secret)).toBe(false); // prefixo
    expect(safeEqual(secret + "extra", secret)).toBe(false); // mais longo com o segredo como prefixo
    expect(safeEqual("", secret)).toBe(false);
    expect(safeEqual("ç".repeat(secret.length), secret)).toBe(false); // multibyte
    const src = readFileSync(path.resolve(__dirname, "../../cron-auth.server.ts"), "utf8");
    const body = src.slice(src.indexOf("export function safeEqual"), src.indexOf("export function verifyCronSecret"));
    expect(body).toMatch(/diff \|=/); // acumula diferenças em todos os bytes
    expect(body).not.toMatch(/return false|break/); // sem retorno antecipado dentro da comparação
  });
});
