/**
 * Diretiva Global (07/11/2026) — catálogo único de modelos, reserva automática e raciocínio elástico.
 * Nenhuma chamada externa: transporte falso injetado no gateway.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AI_MODELS,
  AUTHORIZED_EMBEDDING_MODEL,
  AUTHORIZED_TEXT_MODELS,
  FALLBACK_MODELS,
  fallbackModel,
} from "@/lib/llm/models";
import { GUEST_AI_MODELS, guestFallbackModel } from "@/lib/guest-ai/llm/models";
import {
  GUEST_AI_DEFAULT_MODEL,
  GUEST_AI_RESERVE_MODEL,
} from "@/lib/guest-ai/orchestrator/contracts";
import {
  COPILOT_MAX_OUTPUT_TOKENS,
  COPILOT_MAX_TURN_COST_USD,
  COPILOT_MIN_OUTPUT_TOKENS,
  COPILOT_REASONING_EFFORT,
  copilotModelId,
} from "@/lib/guest-ai/copilot/contracts";
import { generateGuestLlm, validateLlmRequest } from "@/lib/guest-ai/llm/gateway.server";
import {
  buildChatBody,
  buildResponsesBody,
} from "@/lib/guest-ai/llm/providers/lovable-gateway.server";
import type {
  LlmProvider,
  ProviderOutcome,
  ProviderRequest,
} from "@/lib/guest-ai/llm/providers/types";
import { LIMITS } from "@/lib/guest-ai/llm/contracts";
import { createCopilotGenerator } from "@/lib/guest-ai/copilot/generator.server";

const TITULAR = "openai/gpt-6-astra";
const RESERVA = "google/gemini-3.8-flash";

describe("catálogo único de modelos", () => {
  it("só os dois modelos autorizados (mais o de embeddings) existem no SaaS", () => {
    expect([...AUTHORIZED_TEXT_MODELS].sort()).toEqual([RESERVA, TITULAR].sort());
    expect(AUTHORIZED_EMBEDDING_MODEL).toBe("google/gemini-embedding-2");
    for (const [task, model] of Object.entries(AI_MODELS)) {
      if (task === "embeddings") expect(model).toBe(AUTHORIZED_EMBEDDING_MODEL);
      else expect(AUTHORIZED_TEXT_MODELS).toContain(model);
    }
  });

  it("registro da Guest AI contém estritamente Titular e Reserva", () => {
    expect([...GUEST_AI_MODELS.keys()].sort()).toEqual([RESERVA, TITULAR].sort());
  });

  it("Titular é o padrão global; Reserva só como reserva e rotina de fundo", () => {
    expect(GUEST_AI_DEFAULT_MODEL).toBe(TITULAR);
    expect(GUEST_AI_RESERVE_MODEL).toBe(RESERVA);
    expect(copilotModelId({})).toBe(RESERVA);
    expect(AI_MODELS.contracts).toBe(TITULAR);
    expect(AI_MODELS.internal).toBe(TITULAR);
  });

  it("modelos aposentados não aparecem em nenhum arquivo de código", () => {
    const files = [
      "src/lib/llm/models.ts",
      "src/lib/llm/gateway.server.ts",
      "src/lib/guest-ai/llm/models.ts",
      "src/lib/guest-ai/orchestrator/contracts.ts",
      "src/lib/guest-ai/copilot/contracts.ts",
      "src/lib/guest-memory/worker.server.ts",
    ];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/flash-lite|gpt-5\.6-sol/);
    }
  });

  it("reserva automática: Titular → Reserva (e Reserva → Titular nas funções convencionais)", () => {
    expect(fallbackModel(TITULAR)).toBe(RESERVA);
    expect(fallbackModel(RESERVA)).toBe(TITULAR);
    expect(Object.keys(FALLBACK_MODELS).sort()).toEqual([RESERVA, TITULAR].sort());
    expect(guestFallbackModel(TITULAR)).toBe(RESERVA);
    expect(guestFallbackModel(RESERVA)).toBeNull();
  });

  it("agente com ferramentas não troca para reserva fora da Responses API", () => {
    const src = readFileSync("src/lib/llm/gateway.server.ts", "utf8");
    expect(src).toMatch(/!isResponsesModel\(backup\)/);
  });
});

describe("raciocínio 100% elástico (sem tabela de esforço por assunto)", () => {
  it("não existe mais classificação estática de esforço em lugar nenhum", () => {
    const files = [
      "src/lib/guest-ai/copilot/contracts.ts",
      "src/lib/guest-ai/copilot/generate.server.ts",
      "src/lib/guest-ai/copilot/generator.server.ts",
      "src/lib/llm/models.ts",
      "src/lib/llm/gateway.server.ts",
      "src/lib/translate.functions.ts",
      "src/lib/city-news.functions.ts",
      "src/lib/daily-tip.functions.ts",
      "src/lib/maps.functions.ts",
      "src/routes/api/public/guest-doc-upload.ts",
    ];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(
        /copilotReasoningEffort|TASK_REASONING_EFFORT|reasoningEffortFor|OUTPUT_TOKENS_BY_EFFORT/,
      );
      expect(src, f).not.toMatch(/reasoning_effort:\s*["'](low|medium|high)["']/);
    }
  });

  it("o Copiloto chama o modelo em `auto`", () => {
    expect(COPILOT_REASONING_EFFORT).toBe("auto");
    expect(readFileSync("src/lib/guest-ai/copilot/generate.server.ts", "utf8")).toMatch(
      /reasoningEffort: COPILOT_REASONING_EFFORT/,
    );
  });

  it("`auto` é aceito pelo gateway para os dois modelos do catálogo", () => {
    for (const model of [TITULAR, RESERVA]) {
      const v = validateLlmRequest({
        purpose: "test",
        model,
        messages: [{ role: "user", content: "oi" }],
        maxOutputTokens: COPILOT_MAX_OUTPUT_TOKENS,
        reasoningEffort: "auto",
      });
      expect(v, model).not.toBeNull();
      expect(v!.provider.reasoningEffort).toBe("auto");
    }
  });

  it("em `auto` nenhum esforço é fixado no fio: o modelo dosa sozinho", () => {
    const req = (
      model: string,
      reasoningEffort: ProviderRequest["reasoningEffort"],
    ): ProviderRequest => ({
      spec: GUEST_AI_MODELS.get(model)!,
      messages: [{ role: "user", content: "oi" }],
      maxOutputTokens: 512,
      reasoningEffort,
      responseFormat: "json",
      temperature: null,
    });
    expect(buildChatBody(req(RESERVA, "auto"))).not.toHaveProperty("reasoning_effort");
    expect(buildResponsesBody(req(TITULAR, "auto"))).not.toHaveProperty("reasoning");
    // um esforço explícito continua indo ao fio (contrato do gateway preservado)
    expect(buildChatBody(req(RESERVA, "high"))).toMatchObject({ reasoning_effort: "high" });
    expect(buildResponsesBody(req(TITULAR, "high"))).toMatchObject({
      reasoning: { effort: "high" },
    });
  });

  it("funções convencionais: Responses API sem `effort` fixo; chat sem `reasoning_effort`", () => {
    const src = readFileSync("src/lib/llm/gateway.server.ts", "utf8");
    expect(src).toMatch(/reasoningEffort: "auto"/);
    expect(src).toMatch(/params\.reasoningEffort === "auto"\s*\?\s*\{ summary: "auto" \}/);
  });
});

describe("guarda-corpo financeiro externo do Copiloto", () => {
  const prompt = {
    system: "s",
    messages: [{ role: "user" as const, content: "olá" }],
    sourceIds: null,
    promptVersion: "x",
  };
  const run = async (opts: { maxTurnCostUsd?: number; content?: string } = {}) => {
    const seen: Array<{ effort: string; max: number; model: string }> = [];
    const provider: LlmProvider = {
      id: "fake",
      async complete(req) {
        seen.push({ effort: req.reasoningEffort, max: req.maxOutputTokens, model: req.spec.id });
        return {
          kind: "ok",
          text: '{"ok":true}',
          finishReason: "stop",
          usage: { inputTokens: 10, outputTokens: 10 },
          requestId: null,
        };
      },
    };
    const g = createCopilotGenerator({
      modelId: TITULAR,
      maxOutputTokens: COPILOT_MAX_OUTPUT_TOKENS,
      minOutputTokens: COPILOT_MIN_OUTPUT_TOKENS,
      reasoningEffort: COPILOT_REASONING_EFFORT,
      remainingMs: () => 10_000,
      beforeNetwork: async () => true,
      traceId: "t",
      provider,
      log: () => {},
      ...(opts.maxTurnCostUsd ? { maxTurnCostUsd: opts.maxTurnCostUsd } : {}),
    });
    const p = opts.content
      ? { ...prompt, messages: [{ role: "user" as const, content: opts.content }] }
      : prompt;
    const outcome = await g.generate(p, new AbortController().signal).then(
      () => "ok" as const,
      (e: { code?: string }) => e.code ?? "erro",
    );
    return { seen, telemetry: g.telemetry(), outcome };
  };

  it("teto de US$ 0,15 por turno e teto de saída dentro do limite do gateway", () => {
    expect(COPILOT_MAX_TURN_COST_USD).toBe(0.15);
    expect(COPILOT_MAX_OUTPUT_TOKENS).toBeLessThanOrEqual(LIMITS.maxOutputTokens);
    expect(COPILOT_MIN_OUTPUT_TOKENS).toBeLessThan(COPILOT_MAX_OUTPUT_TOKENS);
  });

  it("chamada normal: `auto` + teto de saída cheio, no Titular", async () => {
    const r = await run();
    expect(r.seen).toEqual([{ effort: "auto", max: COPILOT_MAX_OUTPUT_TOKENS, model: TITULAR }]);
    expect(r.telemetry).toMatchObject({
      reasoningEffort: "auto",
      maxOutputTokens: COPILOT_MAX_OUTPUT_TOKENS,
      model: TITULAR,
    });
  });

  it("teto cheio que não cabe no custo do turno ⇒ recua para o teto mínimo (ainda em `auto`)", async () => {
    // US$ 0,02 comporta 1.536 tokens de saída do Titular (US$ 0,0154), mas não 4.096 (US$ 0,041)
    const r = await run({ maxTurnCostUsd: 0.02 });
    expect(r.seen).toEqual([{ effort: "auto", max: COPILOT_MIN_OUTPUT_TOKENS, model: TITULAR }]);
  });

  it("nem o teto mínimo cabe ⇒ bloqueia antes da rede (disjuntor financeiro)", async () => {
    const r = await run({ maxTurnCostUsd: 0.005 });
    expect(r.outcome).toBe("budget_turn_exceeded");
    expect(r.seen).toEqual([]);
  });
});

describe("reserva automática no gateway da Guest AI", () => {
  const ok = (text: string): ProviderOutcome =>
    ({
      kind: "ok",
      text,
      finishReason: "stop",
      usage: null,
      requestId: null,
    }) as unknown as ProviderOutcome;
  const err = (code: string, httpStatus: number | null): ProviderOutcome =>
    ({
      kind: "error",
      error: { code, retryable: true, httpStatus },
      usage: null,
      requestId: null,
    }) as unknown as ProviderOutcome;

  const run = async (first: ProviderOutcome) => {
    const models: string[] = [];
    const provider: LlmProvider = {
      id: "fake",
      async complete(req) {
        models.push(req.spec.id);
        return models.length === 1 ? first : ok('{"ok":true}');
      },
    };
    const res = await generateGuestLlm(
      {
        purpose: "test",
        model: TITULAR,
        messages: [{ role: "user", content: "oi" }],
        maxOutputTokens: 256,
        reasoningEffort: "low",
        responseFormat: "json",
        timeoutMs: 15_000,
      },
      { provider, log: () => {} },
    );
    return { res, models };
  };

  it("5xx no Titular ⇒ segunda tentativa no Reserva", async () => {
    const { res, models } = await run(err("provider_unavailable", 503));
    expect(models).toEqual([TITULAR, RESERVA]);
    expect(res.ok).toBe(true);
    expect(res.telemetry.model).toBe(RESERVA);
  });

  it("falha de rede no Titular ⇒ Reserva", async () => {
    const { models } = await run(err("network", null));
    expect(models).toEqual([TITULAR, RESERVA]);
  });

  it("429 no Titular ⇒ Reserva (Etapa 0: erro recuperável do provedor)", async () => {
    const { models } = await run(err("rate_limited", 429));
    expect(models).toEqual([TITULAR, RESERVA]);
  });

  it("outros 4xx (404, 402, 401) NÃO trocam de modelo: falha fechada (Etapa 0)", async () => {
    for (const [code, status] of [
      ["model_unavailable", 404],
      ["billing", 402],
      ["auth", 401],
    ] as const) {
      const { res, models } = await run(err(code, status));
      expect(models).toEqual([TITULAR]);
      expect(res.ok).toBe(false);
    }
  });
});
