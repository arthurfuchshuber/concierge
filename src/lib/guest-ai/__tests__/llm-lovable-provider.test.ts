import { describe, expect, it, vi } from "vitest";
import { generateGuestLlm } from "@/lib/guest-ai/llm/gateway.server";
import { modelSpec } from "@/lib/guest-ai/llm/models";
import {
  LOVABLE_GATEWAY_BASE_URL,
  MAX_BODY_BYTES,
  buildChatBody,
  buildResponsesBody,
  createLovableGatewayProvider,
  parseResponsesStream,
} from "@/lib/guest-ai/llm/providers/lovable-gateway.server";
import type { FetchLike, ProviderRequest } from "@/lib/guest-ai/llm/providers/types";
import type { LlmCallLogEvent } from "@/lib/guest-ai/llm/telemetry";

const KEY = "lk-test-0000-secreta";
const GEMINI = modelSpec("google/gemini-3.8-flash")!;
const GPT = modelSpec("openai/gpt-6-astra")!;

const preq = (over: Partial<ProviderRequest> = {}): ProviderRequest => ({
  spec: GEMINI,
  messages: [
    { role: "system", content: "Regras do imóvel." },
    { role: "user", content: "Tem estacionamento?" },
    { role: "assistant", content: "Sim, uma vaga." },
    { role: "user", content: "Coberta?" },
  ],
  maxOutputTokens: 300,
  reasoningEffort: "none",
  responseFormat: "text",
  temperature: null,
  ...over,
});

function respond(body: string | null, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(body, { status: init.status ?? 200, headers: init.headers });
}
function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit; body: Record<string, unknown> }> = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(String(init.body)) });
    return handler(url, init);
  };
  return { fn, calls };
}
const provider = (fn: FetchLike, key: string | null = KEY) => createLovableGatewayProvider({ getApiKey: () => key, fetch: fn });
const signal = () => new AbortController().signal;

const CHAT_OK = {
  id: "x",
  choices: [{ message: { role: "assistant", content: "Sim, coberta." }, finish_reason: "stop" }],
  usage: { prompt_tokens: 210, completion_tokens: 40, total_tokens: 250, completion_tokens_details: { reasoning_tokens: 12 } },
};
const sse = (...events: unknown[]) => events.map((e) => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";

describe("F2-A · Lovable AI Gateway — requisição", () => {
  it("chat/completions: URL, cabeçalho da chave, corpo com limites, raciocínio e JSON; sem stream", async () => {
    const f = fakeFetch(() => respond(JSON.stringify(CHAT_OK), { headers: { "x-request-id": "gw-abc_1" } }));
    const out = await provider(f.fn).complete(preq({ reasoningEffort: "medium", responseFormat: "json", temperature: 0.3 }), signal());
    expect(f.calls[0]!.url).toBe(`${LOVABLE_GATEWAY_BASE_URL}/chat/completions`);
    expect(LOVABLE_GATEWAY_BASE_URL).toBe("https://ai.gateway.lovable.dev/v1");
    expect(f.calls[0]!.init.method).toBe("POST");
    expect((f.calls[0]!.init.headers as Record<string, string>)["Lovable-API-Key"]).toBe(KEY);
    expect(f.calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
    expect(f.calls[0]!.body).toEqual({
      model: "google/gemini-3.8-flash",
      messages: preq().messages,
      max_tokens: 300,
      stream: false,
      reasoning_effort: "medium",
      temperature: 0.3,
      response_format: { type: "json_object" },
    });
    expect(out).toEqual({
      kind: "ok",
      text: "Sim, coberta.",
      finishReason: "stop",
      usage: { inputTokens: 210, outputTokens: 40, reasoningTokens: 12, totalTokens: 250 },
      requestId: "gw-abc_1",
    });
  });

  it("esforço 'none' não envia parâmetro de raciocínio; temperatura nula não é enviada", () => {
    const b = buildChatBody(preq());
    expect(b).not.toHaveProperty("reasoning_effort");
    expect(b).not.toHaveProperty("temperature");
    expect(b).not.toHaveProperty("response_format");
  });

  it("responses (OpenAI): instruções separadas, entrada tipada, raciocínio, streaming, sem armazenar, sem temperatura", () => {
    const b = buildResponsesBody(preq({ spec: GPT, reasoningEffort: "high", temperature: 0.7, responseFormat: "json" }));
    expect(b).toEqual({
      model: "openai/gpt-6-astra",
      instructions: "Regras do imóvel.",
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "Tem estacionamento?" }] },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "Sim, uma vaga." }] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "Coberta?" }] },
      ],
      max_output_tokens: 300,
      stream: true,
      store: false,
      reasoning: { effort: "high" },
      text: { format: { type: "json_object" } },
    });
  });

  it("sem chave ⇒ config_missing e nenhuma requisição", async () => {
    const f = fakeFetch(() => respond("{}"));
    for (const k of [null, ""]) {
      const out = await provider(f.fn, k).complete(preq(), signal());
      expect(out).toMatchObject({ kind: "error", error: { code: "config_missing" } });
    }
    expect(f.calls).toHaveLength(0);
  });

  it("id de requisição fora do padrão é descartado", async () => {
    const f = fakeFetch(() => respond(JSON.stringify(CHAT_OK), { headers: { "x-request-id": "<script>alert(1)</script>" } }));
    expect((await provider(f.fn).complete(preq(), signal())).requestId).toBeNull();
  });
});

describe("F2-A · Lovable AI Gateway — erros HTTP (corpo de erro nunca é lido)", () => {
  it.each([
    [429, "rate_limited", true],
    [402, "billing", false],
    [401, "auth", false],
    [403, "auth", false],
    [404, "model_unavailable", false],
    [400, "bad_request", false],
    [422, "bad_request", false],
    [500, "provider_unavailable", true],
    [503, "provider_unavailable", true],
    [418, "invalid_response", false],
  ] as const)("HTTP %s ⇒ %s", async (status, code, retryable) => {
    const echo = "eco do prompt: Coberta? Regras do imóvel.";
    const f = fakeFetch(() => respond(echo, { status }));
    const out = await provider(f.fn).complete(preq(), signal());
    expect(out).toEqual({ kind: "error", error: { code, retryable, httpStatus: status }, usage: null, requestId: null });
    expect(JSON.stringify(out)).not.toContain("eco do prompt");
  });

  it("falha de rede ⇒ network; abortado pelo sinal ⇒ propaga (o gateway decide timeout/cancelamento)", async () => {
    const net = await provider(async () => { throw new TypeError("fetch failed"); }).complete(preq(), signal());
    expect(net).toMatchObject({ kind: "error", error: { code: "network" } });
    const ac = new AbortController();
    ac.abort();
    await expect(provider(async () => { throw new DOMException("aborted", "AbortError"); }).complete(preq(), ac.signal)).rejects.toBeTruthy();
  });
});

describe("F2-A · Lovable AI Gateway — respostas malformadas e truncadas", () => {
  it("JSON cortado no meio ⇒ truncated_response; corpo não-JSON ⇒ invalid_response; formato inesperado ⇒ invalid_response", async () => {
    expect(await provider(fakeFetch(() => respond('{"choices":[{"message":{"content":"Sim, cob')).fn).complete(preq(), signal())).toMatchObject({ error: { code: "truncated_response" } });
    expect(await provider(fakeFetch(() => respond("<html>erro</html>")).fn).complete(preq(), signal())).toMatchObject({ error: { code: "invalid_response" } });
    expect(await provider(fakeFetch(() => respond(JSON.stringify({ choices: [] }))).fn).complete(preq(), signal())).toMatchObject({ error: { code: "invalid_response" } });
    expect(await provider(fakeFetch(() => respond(JSON.stringify({ choices: [{ message: { content: 42 } }] }))).fn).complete(preq(), signal())).toMatchObject({ error: { code: "invalid_response" } });
  });
  it("finish_reason length/content_filter preservados; conteúdo em partes é concatenado", async () => {
    const body = { choices: [{ message: { content: [{ type: "text", text: "Sim, " }, { type: "text", text: "coberta." }] }, finish_reason: "length" }] };
    const out = await provider(fakeFetch(() => respond(JSON.stringify(body))).fn).complete(preq(), signal());
    expect(out).toMatchObject({ kind: "ok", text: "Sim, coberta.", finishReason: "length", usage: null });
    const cf = { choices: [{ message: { content: "" }, finish_reason: "content_filter" }] };
    expect(await provider(fakeFetch(() => respond(JSON.stringify(cf))).fn).complete(preq(), signal())).toMatchObject({ finishReason: "content_filter" });
  });
  it("corpo acima do teto ⇒ invalid_response (leitura interrompida)", async () => {
    // Começa como JSON: sem o teto, viraria "truncated_response"; com o teto, a leitura para antes.
    const big = "{" + "x".repeat(MAX_BODY_BYTES + 10);
    expect(await provider(fakeFetch(() => respond(big)).fn).complete(preq(), signal())).toMatchObject({ error: { code: "invalid_response" } });
  });
  it("conexão cai no meio da leitura ⇒ truncated_response", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('{"choices":'));
        c.error(new Error("socket hang up"));
      },
    });
    const out = await provider(async () => new Response(stream)).complete(preq(), signal());
    expect(out).toMatchObject({ kind: "error", error: { code: "truncated_response" } });
  });
});

describe("F2-A · Lovable AI Gateway — streaming da Responses API", () => {
  const completed = (over: Record<string, unknown> = {}) => ({
    type: "response.completed",
    response: { status: "completed", output_text: "Sim, coberta.", usage: { input_tokens: 300, output_tokens: 80, total_tokens: 380, output_tokens_details: { reasoning_tokens: 60 } }, ...over },
  });

  it("evento terminal 'completed': texto e uso (com raciocínio)", () => {
    const out = parseResponsesStream(sse({ type: "response.output_text.delta", delta: "Sim, " }, completed()));
    expect(out).toEqual({ kind: "ok", text: "Sim, coberta.", finishReason: "stop", usage: { inputTokens: 300, outputTokens: 80, reasoningTokens: 60, totalTokens: 380 }, requestId: null });
  });
  it("sem output_text: junta os itens de mensagem; sem itens: usa os deltas", () => {
    const viaItems = parseResponsesStream(sse(completed({ output_text: undefined, output: [{ type: "reasoning" }, { type: "message", content: [{ type: "output_text", text: "A" }, { type: "output_text", text: "B" }] }] })));
    expect(viaItems).toMatchObject({ text: "AB" });
    const viaDeltas = parseResponsesStream(sse({ type: "response.output_text.delta", delta: "X" }, { type: "response.output_text.delta", delta: "Y" }, completed({ output_text: undefined })));
    expect(viaDeltas).toMatchObject({ text: "XY" });
  });
  it("'incomplete' por limite ⇒ length; por filtro ⇒ content_filter", () => {
    expect(parseResponsesStream(sse({ type: "response.incomplete", response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output_text: "Sim," } }))).toMatchObject({ finishReason: "length" });
    expect(parseResponsesStream(sse({ type: "response.incomplete", response: { status: "incomplete", incomplete_details: { reason: "content_filter" } } }))).toMatchObject({ finishReason: "content_filter" });
  });
  it("fluxo sem evento terminal (conexão caiu) ⇒ truncated_response; 'failed'/'error' ⇒ provider_unavailable", () => {
    expect(parseResponsesStream(sse({ type: "response.output_text.delta", delta: "Sim" }).replace("data: [DONE]\n\n", ""))).toMatchObject({ kind: "error", error: { code: "truncated_response" } });
    expect(parseResponsesStream(sse({ type: "response.failed", response: { status: "failed" } }))).toMatchObject({ error: { code: "provider_unavailable" } });
    expect(parseResponsesStream(sse({ type: "error", message: "x" }))).toMatchObject({ error: { code: "provider_unavailable" } });
  });
  it("linhas corrompidas são ignoradas sem quebrar", () => {
    expect(parseResponsesStream("data: {quebrado\n\n" + sse(completed()))).toMatchObject({ kind: "ok", text: "Sim, coberta." });
  });
  it("transporte completo em /responses", async () => {
    const f = fakeFetch(() => respond(sse(completed())));
    const out = await provider(f.fn).complete(preq({ spec: GPT }), signal());
    expect(f.calls[0]!.url).toBe(`${LOVABLE_GATEWAY_BASE_URL}/responses`);
    expect(out).toMatchObject({ kind: "ok", text: "Sim, coberta." });
  });
});

describe("F2-A · ponta a ponta (gateway + transporte Lovable simulado)", () => {
  it("sucesso com telemetria completa e custo; chave nunca aparece no resultado nem no log", async () => {
    const logs: LlmCallLogEvent[] = [];
    let t = 0;
    const f = fakeFetch(() => {
      t += 1234;
      return respond(JSON.stringify(CHAT_OK), { headers: { "x-request-id": "gw-9" } });
    });
    const r = await generateGuestLlm(
      { purpose: "guest_reply", model: "google/gemini-3.8-flash", messages: preq().messages, maxOutputTokens: 300, reasoningEffort: "low" },
      { provider: provider(f.fn), now: () => t, log: (e) => logs.push(e) },
    );
    expect(r).toEqual({
      ok: true,
      text: "Sim, coberta.",
      finishReason: "stop",
      telemetry: {
        provider: "lovable-gateway",
        model: "google/gemini-3.8-flash",
        purpose: "guest_reply",
        latencyMs: 1234,
        attempts: 1,
        usage: { inputTokens: 210, outputTokens: 40, reasoningTokens: 12, totalTokens: 250, source: "provider" },
        costUsd: 0.000163, // 210 × 0,30/1M + 40 × 2,50/1M
        providerRequestId: "gw-9",
        traceId: null,
      },
    });
    expect(JSON.stringify([r, logs])).not.toContain(KEY);
  });

  it("503 e depois sucesso no transporte real ⇒ 2 tentativas", async () => {
    let n = 0;
    const f = fakeFetch(() => (++n === 1 ? respond("x", { status: 503 }) : respond(JSON.stringify(CHAT_OK))));
    const r = await generateGuestLlm(
      { purpose: "test", model: "google/gemini-3.8-flash", messages: preq().messages, maxOutputTokens: 300 },
      { provider: provider(f.fn), log: () => undefined, schedule: (fn, ms) => {
        if (ms < 1_000) { queueMicrotask(fn); return () => undefined; } // backoff instantâneo
        const t = setTimeout(fn, ms);
        return () => clearTimeout(t);
      } },
    );
    expect(r.ok).toBe(true);
    expect(f.calls).toHaveLength(2);
  });

  it("timeout real com AbortSignal: fetch pendurado é abortado pelo prazo", async () => {
    vi.useFakeTimers();
    try {
      const f: FetchLike = (_u, init) =>
        new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
      const p = generateGuestLlm({ purpose: "test", model: "google/gemini-3.8-flash", messages: preq().messages, maxOutputTokens: 300, timeoutMs: 2_000 }, { provider: provider(f), log: () => undefined });
      await vi.advanceTimersByTimeAsync(2_000);
      const r = await p;
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("timeout");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Visão · Lovable AI Gateway — partes multimodais", () => {
  const IMG = "data:image/jpeg;base64,/9j/AAAA";
  const multi = preq({
    messages: [
      { role: "system", content: "Regras do imóvel." },
      {
        role: "user",
        content: [
          { type: "text", text: "A fechadura está assim:" },
          { type: "image_url", image_url: { url: IMG } },
        ],
      },
    ],
  });

  it("chat/completions: partes `text` e `image_url` vão como o formato OpenAI do gateway", async () => {
    const f = fakeFetch(() => respond(JSON.stringify(CHAT_OK)));
    await provider(f.fn).complete(multi, signal());
    expect(f.calls[0]!.body["messages"]).toEqual([
      { role: "system", content: "Regras do imóvel." },
      {
        role: "user",
        content: [
          { type: "text", text: "A fechadura está assim:" },
          { type: "image_url", image_url: { url: IMG } },
        ],
      },
    ]);
  });

  it("responses: imagem vira `input_image` com a Data URL; texto vira `input_text`", () => {
    const body = buildResponsesBody({ ...multi, spec: GPT });
    expect(body["instructions"]).toBe("Regras do imóvel.");
    expect(body["input"]).toEqual([
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: "A fechadura está assim:" },
          { type: "input_image", image_url: IMG },
        ],
      },
    ]);
  });

  it("mensagens só de texto continuam idênticas (compatibilidade)", () => {
    expect(buildChatBody(preq())["messages"]).toEqual(preq().messages);
  });
});
