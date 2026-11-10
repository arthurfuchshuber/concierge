import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ESTIMATED_TOKENS_PER_IMAGE, LIMITS, type LlmMessage, type LlmRequest, type LlmResult } from "@/lib/guest-ai/llm/contracts";
import { MIN_RETRY_BUDGET_MS, RETRY_BACKOFF_MS, generateGuestLlm, normalizeUsage, parseJsonText, validateLlmRequest, type GatewayDeps } from "@/lib/guest-ai/llm/gateway.server";
import { GUEST_AI_MODELS, estimateCostUsd, modelSpec } from "@/lib/guest-ai/llm/models";
import type { LlmProvider, ProviderOutcome, ProviderRequest } from "@/lib/guest-ai/llm/providers/types";
import type { LlmCallLogEvent } from "@/lib/guest-ai/llm/telemetry";

// ───────────── relógio, agenda e provedor simulados ─────────────

function harness(script: Array<ProviderOutcome | "hang" | "hang-ignore-signal" | Error | ((signal: AbortSignal) => Promise<ProviderOutcome>)>, opts: { stepMs?: number } = {}) {
  let clock = 0;
  const timers: Array<{ at: number; fn: () => void; done: boolean }> = [];
  const logs: LlmCallLogEvent[] = [];
  const seen: Array<{ req: ProviderRequest; signal: AbortSignal }> = [];
  const advance = (ms: number) => {
    clock += ms;
    for (const t of [...timers].sort((a, b) => a.at - b.at)) {
      if (!t.done && t.at <= clock) {
        t.done = true;
        t.fn();
      }
    }
  };
  let i = 0;
  const provider: LlmProvider = {
    id: "fake",
    async complete(req, signal) {
      seen.push({ req, signal });
      const step = script[Math.min(i, script.length - 1)];
      i += 1;
      clock += opts.stepMs ?? 100;
      if (step instanceof Error) throw step;
      if (typeof step === "function") return step(signal);
      if (step === "hang") {
        return new Promise<ProviderOutcome>((_, reject) => signal.addEventListener("abort", () => reject(new Error("AbortError")), { once: true }));
      }
      if (step === "hang-ignore-signal") return new Promise<ProviderOutcome>(() => undefined);
      return step!;
    },
  };
  const deps: GatewayDeps = {
    provider,
    now: () => clock,
    schedule: (fn, ms) => {
      const t = { at: clock + ms, fn, done: false };
      timers.push(t);
      // Agendamentos de backoff disparam já (o relógio simulado avança junto).
      if (ms === RETRY_BACKOFF_MS) queueMicrotask(() => advance(ms));
      return () => {
        t.done = true;
      };
    },
    log: (e) => logs.push(e),
  };
  return { deps, logs, seen, advance, calls: () => seen.length, clock: () => clock };
}

const ok = (over: Partial<Extract<ProviderOutcome, { kind: "ok" }>> = {}): ProviderOutcome => ({
  kind: "ok",
  text: "Olá! O check-in é às 15h.",
  finishReason: "stop",
  usage: { inputTokens: 1000, outputTokens: 500, reasoningTokens: 120, totalTokens: 1500 },
  requestId: "req-1",
  ...over,
});
const err = (code: Extract<ProviderOutcome, { kind: "error" }>["error"]["code"], httpStatus: number | null = null, retryable = false): ProviderOutcome => ({
  kind: "error",
  error: { code, retryable, httpStatus },
  usage: null,
  requestId: null,
});

const MSGS: LlmMessage[] = [
  { role: "system", content: "Você é o concierge do imóvel." },
  { role: "user", content: "Que horas é o check-in?" },
];
const req = (over: Partial<LlmRequest> = {}): LlmRequest => ({
  purpose: "test",
  model: "google/gemini-3.8-flash",
  messages: MSGS,
  maxOutputTokens: 512,
  ...over,
});
const failed = (r: LlmResult) => {
  if (r.ok) throw new Error("esperava falha");
  return r;
};
const succeeded = (r: LlmResult) => {
  if (!r.ok) throw new Error(`esperava sucesso, veio ${r.error.code}`);
  return r;
};

// ───────────── contrato ─────────────

describe("F2-A · contrato validado antes da rede", () => {
  it.each<[string, Partial<LlmRequest>]>([
    ["modelo fora do registro", { model: "openai/gpt-qualquer" }],
    ["modelo da camada convencional não registrado aqui", { model: "google/gemini-embedding-2" }],
    ["sem mensagens", { messages: [] }],
    ["sem mensagem do usuário", { messages: [{ role: "system", content: "x" }] }],
    ["papel inválido (tool)", { messages: [{ role: "tool" as never, content: "x" }, { role: "user", content: "y" }] }],
    ["conteúdo não-texto", { messages: [{ role: "user", content: 42 as never }] }],
    ["mensagens demais", { messages: Array.from({ length: LIMITS.maxMessages + 1 }, () => ({ role: "user" as const, content: "a" })) }],
    ["texto demais", { messages: [{ role: "user", content: "a".repeat(LIMITS.maxTotalChars + 1) }] }],
    ["maxOutputTokens zero", { maxOutputTokens: 0 }],
    ["maxOutputTokens acima do teto", { maxOutputTokens: LIMITS.maxOutputTokens + 1 }],
    ["maxOutputTokens fracionário", { maxOutputTokens: 10.5 }],
    ["esforço desconhecido", { reasoningEffort: "xhigh" as never }],
    ["temperatura fora de 0–2", { temperature: 2.5 }],
    ["temperatura NaN", { temperature: Number.NaN }],
    ["formato desconhecido", { responseFormat: "xml" as never }],
    ["timeout não numérico", { timeoutMs: "15000" as never }],
  ])("%s ⇒ invalid_request, sem chamada ao provedor", async (_n, over) => {
    const h = harness([ok()]);
    const r = failed(await generateGuestLlm(req(over), h.deps));
    expect(r.error).toEqual({ code: "invalid_request", retryable: false, httpStatus: null });
    expect(h.calls()).toBe(0);
    expect(h.logs).toHaveLength(1);
    expect(h.logs[0]!.code).toBe("invalid_request");
  });

  it("entrada lixo (null) não lança", async () => {
    const h = harness([ok()]);
    const r = failed(await generateGuestLlm(null as never, h.deps));
    expect(r.error.code).toBe("invalid_request");
  });

  it("timeout é limitado a [1 s, 15 s]; padrão 15 s", () => {
    expect(validateLlmRequest(req())!.timeoutMs).toBe(15_000);
    expect(validateLlmRequest(req({ timeoutMs: 60_000 }))!.timeoutMs).toBe(15_000);
    expect(validateLlmRequest(req({ timeoutMs: 10 }))!.timeoutMs).toBe(1_000);
    expect(validateLlmRequest(req({ timeoutMs: 8_000.9 }))!.timeoutMs).toBe(8_000);
  });

  it("esforço de raciocínio dinâmico: aceito quando o modelo suporta; 'none' = não enviar", () => {
    for (const e of ["none", "low", "medium", "high"] as const) expect(validateLlmRequest(req({ reasoningEffort: e }))!.provider.reasoningEffort).toBe(e);
    expect(validateLlmRequest(req())!.provider.reasoningEffort).toBe("none");
  });

  it("modelo sem controle de raciocínio recusa esforço diferente de 'none'", () => {
    const base = modelSpec("google/gemini-3.8-flash")!;
    const map = GUEST_AI_MODELS as Map<string, typeof base>;
    map.set("test/no-reasoning", { ...base, id: "test/no-reasoning", reasoningEfforts: [] });
    try {
      expect(validateLlmRequest(req({ model: "test/no-reasoning", reasoningEffort: "low" }))).toBeNull();
      expect(validateLlmRequest(req({ model: "test/no-reasoning", reasoningEffort: "none" }))).not.toBeNull();
    } finally {
      map.delete("test/no-reasoning");
    }
  });

  it("registro de modelos: só fornecedores servidos pelo gateway, preços positivos, wire coerente", () => {
    expect(GUEST_AI_MODELS.size).toBeGreaterThanOrEqual(2);
    for (const s of GUEST_AI_MODELS.values()) {
      expect(s.provider).toBe("lovable-gateway");
      expect(s.wire).toBe(s.vendor === "openai" ? "responses" : "chat");
      expect(s.pricePerMTok.input).toBeGreaterThan(0);
      expect(s.pricePerMTok.output).toBeGreaterThan(0);
    }
  });
});

describe("F2-A · credenciais nunca saem para o provedor", () => {
  it("valor proibido em qualquer mensagem ⇒ sensitive_content_blocked, nada vai à rede, nada vai ao log", async () => {
    const h = harness([ok()]);
    const secret = "PORTA-4821#";
    const r = failed(
      await generateGuestLlm(req({ messages: [{ role: "system", content: `senha ${secret}` }, { role: "user", content: "oi" }], forbiddenValues: [secret] }), h.deps),
    );
    expect(r.error.code).toBe("sensitive_content_blocked");
    expect(h.calls()).toBe(0);
    expect(JSON.stringify(h.logs)).not.toContain(secret);
    expect(JSON.stringify(r)).not.toContain(secret);
  });
  it("valores vazios na lista proibida são ignorados; ausência do valor segue normalmente", async () => {
    const h = harness([ok()]);
    succeeded(await generateGuestLlm(req({ forbiddenValues: ["", "segredo-que-nao-aparece"] }), h.deps));
    expect(h.calls()).toBe(1);
  });
});

// ───────────── sucesso e telemetria ─────────────

describe("F2-A · sucesso, normalização e telemetria", () => {
  it("texto, uso do provedor, raciocínio, latência, tentativas, custo e id de requisição", async () => {
    const h = harness([ok()], { stepMs: 840 });
    const r = succeeded(await generateGuestLlm(req({ reasoningEffort: "low", traceId: "turn-123" }), h.deps));
    expect(r.text).toBe("Olá! O check-in é às 15h.");
    expect(r.telemetry).toEqual({
      provider: "fake",
      model: "google/gemini-3.8-flash",
      purpose: "test",
      latencyMs: 840,
      attempts: 1,
      usage: { inputTokens: 1000, outputTokens: 500, reasoningTokens: 120, totalTokens: 1500, source: "provider" },
      costUsd: 0.00155, // 1000 × 0,30/1M + 500 × 2,50/1M
      providerRequestId: "req-1",
      traceId: "turn-123",
    });
    expect(h.seen[0]!.req.reasoningEffort).toBe("low");
  });

  it("custo por modelo (tabela do registro) e arredondamento", () => {
    expect(estimateCostUsd(modelSpec("openai/gpt-6-astra")!, 2_000_000, 1_000_000)).toBe(12.5);
    expect(estimateCostUsd(modelSpec("google/gemini-3.8-flash")!, 1, 1)).toBe(2.8e-6);
    expect(estimateCostUsd(modelSpec("google/gemini-3.8-flash")!, 0, 0)).toBe(0);
    expect(estimateCostUsd(modelSpec("google/gemini-3.8-flash")!, 10_000, 10_000)).toBe(0.028);
    // catálogo único (07/11/2026): modelos aposentados não estão mais no registro
    expect(modelSpec("google/gemini-3.1-flash-lite")).toBeNull();
    expect(modelSpec("openai/gpt-5.6-sol")).toBeNull();
  });

  it("uso não informado ⇒ estimativa por caracteres, marcada 'estimated'", async () => {
    const h = harness([ok({ usage: null, text: "x".repeat(40) })]);
    const r = succeeded(await generateGuestLlm(req(), h.deps));
    const inputChars = MSGS.reduce((n, m) => n + m.content.length, 0);
    expect(r.telemetry.usage).toEqual({ inputTokens: Math.ceil(inputChars / 4), outputTokens: 10, reasoningTokens: 0, totalTokens: Math.ceil(inputChars / 4) + 10, source: "estimated" });
  });

  it("normalizeUsage: raciocínio nunca passa da saída; total ausente = soma", () => {
    expect(normalizeUsage({ inputTokens: 10, outputTokens: 5, reasoningTokens: 50 }, 0, 0)).toEqual({ inputTokens: 10, outputTokens: 5, reasoningTokens: 5, totalTokens: 15, source: "provider" });
    expect(normalizeUsage({ inputTokens: 10 }, 8, 4).source).toBe("estimated");
  });

  it("traceId inválido (dado pessoal, espaços, longo) é descartado", async () => {
    const h = harness([ok()]);
    const r = succeeded(await generateGuestLlm(req({ traceId: "joao@email.com ap 14" }), h.deps));
    expect(r.telemetry.traceId).toBeNull();
    const r2 = succeeded(await generateGuestLlm(req({ traceId: "a".repeat(81) }), harness([ok()]).deps));
    expect(r2.telemetry.traceId).toBeNull();
  });

  it("JSON: cercas removidas e objeto validado; JSON inválido ⇒ invalid_response (com uso contabilizado)", async () => {
    const good = succeeded(await generateGuestLlm(req({ responseFormat: "json" }), harness([ok({ text: '```json\n{"intent":"checkin_time"}\n```' })]).deps));
    expect(good.json).toEqual({ intent: "checkin_time" });
    const bad = failed(await generateGuestLlm(req({ responseFormat: "json" }), harness([ok({ text: "não é json" })]).deps));
    expect(bad.error.code).toBe("invalid_response");
    expect(bad.telemetry.usage.source).toBe("provider");
    expect(parseJsonText("  {\"a\":1}  ")).toEqual({ ok: true, value: { a: 1 } });
  });
});

// ───────────── falhas ─────────────

describe("F2-A · falhas: fail-closed limpo", () => {
  it("resposta truncada (limite de tokens) ⇒ truncated_response; tokens cobrados entram no custo", async () => {
    const r = failed(await generateGuestLlm(req(), harness([ok({ finishReason: "length", text: "O check-in é às" })]).deps));
    expect(r.error.code).toBe("truncated_response");
    expect(r.telemetry.costUsd).toBeGreaterThan(0);
    expect(r).not.toHaveProperty("text");
  });
  it("filtro de conteúdo, resposta vazia e término desconhecido", async () => {
    expect(failed(await generateGuestLlm(req(), harness([ok({ finishReason: "content_filter" })]).deps)).error.code).toBe("content_filtered");
    expect(failed(await generateGuestLlm(req(), harness([ok({ text: "   \n" })]).deps)).error.code).toBe("empty_response");
    expect(failed(await generateGuestLlm(req(), harness([ok({ finishReason: "other" })]).deps)).error.code).toBe("invalid_response");
  });

  it("429 ⇒ rate_limited, SEM nova tentativa", async () => {
    const h = harness([err("rate_limited", 429, true), ok()]);
    const r = failed(await generateGuestLlm(req(), h.deps));
    expect(r.error).toEqual({ code: "rate_limited", retryable: true, httpStatus: 429 });
    expect(h.calls()).toBe(1);
  });
  it("402 ⇒ billing, SEM nova tentativa", async () => {
    const h = harness([err("billing", 402), ok()]);
    expect(failed(await generateGuestLlm(req(), h.deps)).error).toEqual({ code: "billing", retryable: false, httpStatus: 402 });
    expect(h.calls()).toBe(1);
  });
  it.each(["auth", "model_unavailable", "bad_request", "config_missing", "invalid_response"] as const)("%s não é repetido", async (code) => {
    const h = harness([err(code), ok()]);
    expect(failed(await generateGuestLlm(req(), h.deps)).error.code).toBe(code);
    expect(h.calls()).toBe(1);
  });

  it("5xx seguido de sucesso ⇒ uma nova tentativa dentro do prazo", async () => {
    const h = harness([err("provider_unavailable", 503, true), ok()]);
    const r = succeeded(await generateGuestLlm(req(), h.deps));
    expect(r.telemetry.attempts).toBe(2);
    expect(h.calls()).toBe(2);
  });
  it("5xx duas vezes ⇒ provider_unavailable após 2 tentativas (nunca 3)", async () => {
    const h = harness([err("provider_unavailable", 500, true), err("provider_unavailable", 502, true), ok()]);
    const r = failed(await generateGuestLlm(req(), h.deps));
    expect(r.error).toEqual({ code: "provider_unavailable", retryable: true, httpStatus: 502 });
    expect(r.telemetry.attempts).toBe(2);
    expect(h.calls()).toBe(2);
  });
  it("erro de rede ⇒ nova tentativa; provedor que lança exceção comum também é tratado", async () => {
    expect(succeeded(await generateGuestLlm(req(), harness([err("network", null, true), ok()]).deps)).telemetry.attempts).toBe(2);
    const h = harness([new Error("ECONNRESET"), new Error("ECONNRESET")]);
    const r = failed(await generateGuestLlm(req(), h.deps));
    expect(r.error.code).toBe("network");
    expect(h.calls()).toBe(2);
  });
  it("sem prazo suficiente para repetir (< 3 s restantes) ⇒ não repete", async () => {
    const h = harness([err("provider_unavailable", 500, true), ok()], { stepMs: 15_000 - MIN_RETRY_BUDGET_MS + 1 });
    const r = failed(await generateGuestLlm(req(), h.deps));
    expect(r.error.code).toBe("provider_unavailable");
    expect(h.calls()).toBe(1);
  });

  it("timeout de 15 s: o sinal entregue ao provedor é abortado e o resultado é 'timeout'", async () => {
    const h = harness(["hang"], { stepMs: 0 });
    const p = generateGuestLlm(req(), h.deps);
    await Promise.resolve();
    h.advance(14_999);
    await Promise.resolve();
    expect(h.seen[0]!.signal.aborted).toBe(false);
    h.advance(1);
    const r = failed(await p);
    expect(r.error).toEqual({ code: "timeout", retryable: true, httpStatus: null });
    expect(h.seen[0]!.signal.aborted).toBe(true);
    expect(h.calls()).toBe(1); // timeout nunca é repetido
  });
  it("provedor que IGNORA o sinal também é cortado no prazo (corrida)", async () => {
    const h = harness(["hang-ignore-signal"]);
    const p = generateGuestLlm(req({ timeoutMs: 5_000 }), h.deps);
    await Promise.resolve();
    h.advance(5_000);
    expect(failed(await p).error.code).toBe("timeout");
  });
  it("cancelamento externo no meio da chamada ⇒ 'aborted'; sinal já abortado ⇒ nem chama", async () => {
    const ac = new AbortController();
    const h = harness(["hang"]);
    const p = generateGuestLlm(req({ signal: ac.signal }), h.deps);
    await Promise.resolve();
    ac.abort();
    expect(failed(await p).error).toEqual({ code: "aborted", retryable: false, httpStatus: null });
    const pre = new AbortController();
    pre.abort();
    const h2 = harness([ok()]);
    expect(failed(await generateGuestLlm(req({ signal: pre.signal }), h2.deps)).error.code).toBe("aborted");
    expect(h2.calls()).toBe(0);
  });
  it("logger que lança não derruba a chamada", async () => {
    const h = harness([ok()]);
    const r = await generateGuestLlm(req(), { ...h.deps, log: () => { throw new Error("log caiu"); } });
    expect(r.ok).toBe(true);
  });
});

// ───────────── observabilidade segura ─────────────

describe("F2-A · logs estruturados sem conteúdo nem segredo", () => {
  const ALLOWED = [
    "event", "outcome", "code", "httpStatus", "provider", "model", "purpose", "latencyMs", "attempts", "timeoutMs", "reasoningEffort", "responseFormat",
    "messageCount", "inputChars", "outputChars", "inputTokens", "outputTokens", "reasoningTokens", "totalTokens", "usageSource", "costUsd", "providerRequestId", "traceId",
  ].sort();

  it("um evento por chamada, só campos da lista branca, sem texto do hóspede nem da resposta", async () => {
    const h = harness([ok({ text: "Resposta secreta do modelo" })]);
    vi.stubEnv("LOVABLE_API_KEY", "lk-super-secreta");
    await generateGuestLlm(req({ messages: [{ role: "user", content: "Meu CPF é 123.456.789-00" }] }), h.deps);
    vi.unstubAllEnvs();
    expect(h.logs).toHaveLength(1);
    expect(Object.keys(h.logs[0]!).sort()).toEqual(ALLOWED);
    const json = JSON.stringify(h.logs);
    for (const leak of ["123.456.789-00", "CPF", "Resposta secreta", "lk-super-secreta"]) expect(json).not.toContain(leak);
    expect(h.logs[0]).toMatchObject({ event: "guest_ai.llm.call", outcome: "ok", code: null, outputChars: 26, inputTokens: 1000, costUsd: 0.00155 });
  });
  it("falha também gera exatamente um evento, com código e status", async () => {
    const h = harness([err("billing", 402)]);
    await generateGuestLlm(req(), h.deps);
    expect(h.logs).toHaveLength(1);
    expect(h.logs[0]).toMatchObject({ outcome: "error", code: "billing", httpStatus: 402, attempts: 1 });
  });
});

describe("F2-A · isolamento no repositório", () => {
  it("fora de guest-ai/llm, só o orchestrator, os contratos shadow (tipos) e a rota da sonda importam guest-ai/llm", () => {
    const SRC = path.resolve(__dirname, "../../..");
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((n) => {
        const f = path.join(d, n);
        if (n === "node_modules" || n === "__tests__") return [];
        return statSync(f).isDirectory() ? walk(f) : /\.(ts|tsx)$/.test(n) ? [f] : [];
      });
    const offenders = walk(SRC)
      .filter((f) => !f.includes(`${path.sep}guest-ai${path.sep}llm${path.sep}`))
      .filter((f) => /guest-ai\/llm/.test(readFileSync(f, "utf8")));
    const allowed = [/guest-ai[\\/]orchestrator[\\/]/, /guest-ai[\\/]shadow[\\/]contracts\.ts$/, /routes[\\/]api[\\/]public[\\/]guest-ai\.llm-probe\.ts$/, /[\\/]routeTree\.gen\.ts$/, /guest-ai[\\/]shadow-exec[\\/]/,
      // Copiloto (05/11/2026): registro de modelos (contratos), tipos do transporte (geração) e o gerador — lista nominal
      /guest-ai[\\/]copilot[\\/](contracts\.ts|generate\.server\.ts|generator\.server\.ts|ops-extractor\.server\.ts)$/,
      // Memória do hóspede (06/11/2026): processo pós-checkout — prompt (registro de modelos/tipos) e worker (Gateway)
      /lib[\\/]guest-memory[\\/](prompt\.ts|worker\.server\.ts)$/,
      // Tool calling (07/11/2026): só os TIPOS do gateway (declaração de ferramenta e chamada) — lista nominal
      /guest-ai[\\/]tools[\\/](contracts\.ts|executor\.ts|registry\.ts)$/,
      // Extrator do aprendizado (10/11/2026): tipo da mensagem (pedido) e a chamada ao Gateway — lista nominal
      /lib[\\/]guest-ai-learning[\\/](extractor\.ts|extractor\.server\.ts)$/]; // B3.3: Shadow (tipos + gerador emitido)
    expect(offenders.filter((f) => !allowed.some((re) => re.test(f))).map((f) => path.relative(SRC, f))).toEqual([]);
  });
  it("o gateway convencional do SaaS (src/lib/llm) não importa o do Guest AI", () => {
    const g = readFileSync(path.resolve(__dirname, "../../llm/gateway.server.ts"), "utf8");
    expect(g).not.toMatch(/guest-ai/);
  });
});

// ───────────── visão multimodal ─────────────

describe("Visão · contrato multimodal do Gateway", () => {
  const IMG = "data:image/png;base64,iVBORw0KGgo=";
  const withImages = (n: number, over: Partial<LlmMessage> = {}): LlmMessage[] => [
    { role: "system", content: "Você é o concierge do imóvel." },
    {
      role: "user",
      content: [
        { type: "text", text: "Olha a foto:" },
        ...Array.from({ length: n }, () => ({ type: "image_url" as const, image_url: { url: IMG } })),
      ],
      ...over,
    },
  ];

  it("aceita texto + até 3 imagens Data URL (JPEG/PNG/WebP) em mensagem do usuário", () => {
    for (const url of [IMG, "data:image/jpeg;base64,/9j/", "data:image/webp;base64,UklGR"]) {
      const v = validateLlmRequest(req({ messages: [{ role: "user", content: [{ type: "text", text: "x" }, { type: "image_url", image_url: { url } }] }] }));
      expect(v, url).not.toBeNull();
      expect(v!.imageCount).toBe(1);
    }
    expect(validateLlmRequest(req({ messages: withImages(3) }))!.imageCount).toBe(3);
  });

  it.each<[string, LlmMessage[]]>([
    ["mais de 3 imagens", withImages(4)],
    ["URL externa (não Data URL)", [{ role: "user", content: [{ type: "text", text: "x" }, { type: "image_url", image_url: { url: "https://exemplo.com/a.jpg" } }] }]],
    ["Data URL de outro tipo (gif/svg)", [{ role: "user", content: [{ type: "text", text: "x" }, { type: "image_url", image_url: { url: "data:image/svg+xml;base64,PHN2Zz4=" } }] }]],
    ["Data URL vazia", [{ role: "user", content: [{ type: "text", text: "x" }, { type: "image_url", image_url: { url: "data:image/png;base64," } }] }]],
    ["imagem em mensagem do assistente", [{ role: "user", content: "oi" }, { role: "assistant", content: [{ type: "image_url", image_url: { url: IMG } }] }]],
    ["só imagem, sem texto algum", [{ role: "user", content: [{ type: "image_url", image_url: { url: IMG } }] }]],
    ["lista de partes vazia", [{ role: "user", content: [] }]],
    ["parte de tipo desconhecido", [{ role: "user", content: [{ type: "text", text: "x" }, { type: "audio", data: "x" } as never] }]],
  ])("recusa antes da rede: %s", async (_, messages) => {
    expect(validateLlmRequest(req({ messages }))).toBeNull();
    const h = harness([ok()]);
    const r = failed(await generateGuestLlm(req({ messages }), h.deps));
    expect(r.error.code).toBe("invalid_request");
    expect(h.calls()).toBe(0);
  });

  it("recusa a soma de Data URLs acima do teto do gateway", () => {
    const big = "data:image/png;base64," + "A".repeat(LIMITS.maxImageDataUrlChars);
    expect(validateLlmRequest(req({ messages: [{ role: "user", content: [{ type: "text", text: "x" }, { type: "image_url", image_url: { url: big } }] }] }))).toBeNull();
  });

  it("valor proibido dentro de uma parte de texto bloqueia a chamada", async () => {
    const h = harness([ok()]);
    const messages: LlmMessage[] = [{ role: "user", content: [{ type: "text", text: "a senha é 4321" }, { type: "image_url", image_url: { url: IMG } }] }];
    const r = failed(await generateGuestLlm(req({ messages, forbiddenValues: ["4321"] }), h.deps));
    expect(r.error.code).toBe("sensitive_content_blocked");
    expect(h.calls()).toBe(0);
  });

  it("as partes chegam ao transporte sem alteração; sem uso informado, a estimativa soma tokens por imagem", async () => {
    const h = harness([ok({ usage: null })]);
    const r = succeeded(await generateGuestLlm(req({ messages: withImages(2) }), h.deps));
    expect(h.seen[0]!.req.messages).toEqual(withImages(2));
    expect(r.telemetry.usage.source).toBe("estimated");
    expect(normalizeUsage(null, 400, 0, 2).inputTokens).toBe(normalizeUsage(null, 400, 0, 0).inputTokens + 2 * ESTIMATED_TOKENS_PER_IMAGE);
  });

  it("todos os modelos registrados declaram suporte a imagem", () => {
    for (const spec of GUEST_AI_MODELS.values()) expect(spec.supportsImages, spec.id).toBe(true);
  });
});
