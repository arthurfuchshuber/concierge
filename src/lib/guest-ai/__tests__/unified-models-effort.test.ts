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
  TASK_REASONING_EFFORT,
  fallbackModel,
  reasoningEffortFor,
} from "@/lib/llm/models";
import { GUEST_AI_MODELS, guestFallbackModel } from "@/lib/guest-ai/llm/models";
import {
  GUEST_AI_DEFAULT_MODEL,
  GUEST_AI_RESERVE_MODEL,
} from "@/lib/guest-ai/orchestrator/contracts";
import {
  COPILOT_OUTPUT_TOKENS_BY_EFFORT,
  copilotEffortSignals,
  copilotModelId,
  copilotReasoningEffort,
} from "@/lib/guest-ai/copilot/contracts";
import { generateGuestLlm } from "@/lib/guest-ai/llm/gateway.server";
import type { LlmProvider, ProviderOutcome } from "@/lib/guest-ai/llm/providers/types";
import type { HistoryEntry, HistoryResult } from "@/lib/guest-ai/history";
import { LIMITS } from "@/lib/guest-ai/llm/contracts";

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
    expect(copilotModelId({})).toBe(TITULAR);
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

describe("raciocínio elástico por tarefa (funções convencionais)", () => {
  it("rotina em low, curadoria em medium, documentos e contratos em high", () => {
    expect(reasoningEffortFor("translate")).toBe("low");
    expect(reasoningEffortFor("content")).toBe("low");
    expect(reasoningEffortFor("cityPulse")).toBe("medium");
    expect(reasoningEffortFor("recommendations")).toBe("medium");
    expect(reasoningEffortFor("documents")).toBe("high");
    expect(reasoningEffortFor("contracts")).toBe("high");
    expect(reasoningEffortFor("embeddings")).toBeNull();
    expect(Object.keys(TASK_REASONING_EFFORT)).not.toContain("embeddings");
  });

  it("a trava fixa COPILOT_REASONING_EFFORT deixou de existir", () => {
    const src = readFileSync("src/lib/guest-ai/copilot/contracts.ts", "utf8");
    expect(src).not.toMatch(/COPILOT_REASONING_EFFORT\s*=/);
    expect(readFileSync("src/lib/guest-ai/copilot/generate.server.ts", "utf8")).not.toMatch(
      /COPILOT_REASONING_EFFORT/,
    );
  });
});

describe("raciocínio elástico do Copiloto", () => {
  const e = (guestText: string, imagesSent = 0, hasAttachment = false) =>
    copilotReasoningEffort({ guestText, imagesSent, hasAttachment });

  it("cortesia e rotina ⇒ low", () => {
    for (const t of [
      "Oi",
      "Bom dia!",
      "Obrigado 🙏",
      "Valeu, perfeito!",
      "ok 👍",
      "Oi, tudo bem?",
      "Muito obrigada ❤️",
      "👩‍🍳☀️",
    ]) {
      expect(e(t), t).toBe("low");
    }
  });

  it("pergunta factual (Dossiê, regras, guia) ⇒ medium", () => {
    for (const t of [
      "Qual a senha do wifi?",
      "Que horas é o check-in?",
      "Posso levar meu cachorro?",
      "Tem algum restaurante bom perto?",
      "O que tem pra fazer na cidade hoje à noite?",
    ]) {
      expect(e(t), t).toBe("medium");
    }
  });

  it("incidente, dano, documento ou contrato ⇒ high", () => {
    for (const t of [
      "O chuveiro não esquenta",
      "Tem um vazamento embaixo da pia",
      "Quebrou o vidro da janela",
      "Estamos sem luz no apartamento",
      "Sinto cheiro de gás na cozinha",
      "Quero o reembolso da cobrança extra",
      "Pode me mandar o contrato?",
    ]) {
      expect(e(t), t).toBe("high");
    }
  });

  it("foto ou anexo do hóspede ⇒ high, mesmo com texto trivial", () => {
    expect(e("Oi", 1)).toBe("high");
    expect(e("", 2)).toBe("high");
    expect(e("segue", 0, true)).toBe("high");
  });

  it("o esforço escala monotonicamente com a complexidade", () => {
    const rank = { low: 0, medium: 1, high: 2 } as const;
    const ladder = [
      e("Obrigado!"),
      e("Qual o horário do check-out?"),
      e("O ar-condicionado parou de funcionar"),
    ];
    expect(ladder).toEqual(["low", "medium", "high"]);
    expect(rank[ladder[0]!]).toBeLessThan(rank[ladder[1]!]);
    expect(rank[ladder[1]!]).toBeLessThan(rank[ladder[2]!]);
  });

  it("teto de saída cresce com o esforço e respeita o limite do gateway", () => {
    expect(COPILOT_OUTPUT_TOKENS_BY_EFFORT.low).toBeLessThan(
      COPILOT_OUTPUT_TOKENS_BY_EFFORT.medium,
    );
    expect(COPILOT_OUTPUT_TOKENS_BY_EFFORT.medium).toBeLessThan(
      COPILOT_OUTPUT_TOKENS_BY_EFFORT.high,
    );
    expect(COPILOT_OUTPUT_TOKENS_BY_EFFORT.high).toBeLessThanOrEqual(LIMITS.maxOutputTokens);
  });

  it("sinais vêm só da rajada atual do hóspede (depois da última fala da equipe)", () => {
    const entry = (
      speaker: HistoryEntry["speaker"],
      text: string,
      media: HistoryEntry["media"] = null,
    ): HistoryEntry =>
      ({
        ref: `hist:${speaker}:h1`,
        messageId: text,
        speaker,
        channel: "airbnb",
        at: "2026-11-07T10:00:00Z",
        text,
        media,
        delivery: "delivered",
        current: false,
      }) as unknown as HistoryEntry;
    const history = {
      status: "available",
      conversationId: "c",
      currentMessageId: "m",
      counts: {},
      entries: [
        entry("guest", "o chuveiro quebrou"),
        entry("team", "Já resolvemos!"),
        entry("guest", "Obrigado"),
        entry("guest", "tudo certo"),
      ],
    } as unknown as HistoryResult;
    const sig = copilotEffortSignals(history, 0);
    expect(sig.guestText).toBe("Obrigado\ntudo certo");
    expect(copilotReasoningEffort(sig)).toBe("low");
    expect(
      copilotEffortSignals({ status: "unavailable", reason: "x" } as unknown as HistoryResult, 1),
    ).toEqual({ guestText: "", imagesSent: 1 });
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

  it("modelo indisponível (404) no Titular ⇒ Reserva", async () => {
    const { models } = await run(err("model_unavailable", 404));
    expect(models).toEqual([TITULAR, RESERVA]);
  });

  it("429 e 402 NÃO trocam de modelo (trocar não resolve e mascararia o problema)", async () => {
    for (const [code, status] of [
      ["rate_limited", 429],
      ["billing", 402],
      ["auth", 401],
    ] as const) {
      const { res, models } = await run(err(code, status));
      expect(models).toEqual([TITULAR]);
      expect(res.ok).toBe(false);
    }
  });
});

describe("gerador do Copiloto com esforço elástico", () => {
  const prompt = {
    system: "s",
    messages: [{ role: "user" as const, content: "olá" }],
    sourceIds: null,
    promptVersion: "x",
  };
  const capture = () => {
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
    return { seen, provider };
  };
  const mk = async (
    effort: (s: { imagesSent: number }) => "low" | "medium" | "high",
    maxTurnCostUsd?: number,
  ) => {
    const { createCopilotGenerator } = await import("@/lib/guest-ai/copilot/generator.server");
    const c = capture();
    const g = createCopilotGenerator({
      modelId: TITULAR,
      maxOutputTokens: COPILOT_OUTPUT_TOKENS_BY_EFFORT.low,
      reasoningEffort: effort,
      outputTokensFor: (x) => COPILOT_OUTPUT_TOKENS_BY_EFFORT[x as "low" | "medium" | "high"],
      remainingMs: () => 10_000,
      beforeNetwork: async () => true,
      traceId: "t",
      provider: c.provider,
      log: () => {},
      ...(maxTurnCostUsd ? { maxTurnCostUsd } : {}),
    });
    await g.generate(prompt, new AbortController().signal);
    return { ...c, telemetry: g.telemetry() };
  };

  it("cortesia vai em low com o teto base; incidente sobe para high com teto maior", async () => {
    const low = await mk(() => copilotReasoningEffort({ guestText: "Obrigado!", imagesSent: 0 }));
    expect(low.seen).toEqual([
      { effort: "low", max: COPILOT_OUTPUT_TOKENS_BY_EFFORT.low, model: TITULAR },
    ]);
    const high = await mk(() =>
      copilotReasoningEffort({ guestText: "Tem um vazamento na pia", imagesSent: 0 }),
    );
    expect(high.seen[0]).toMatchObject({
      effort: "high",
      max: COPILOT_OUTPUT_TOKENS_BY_EFFORT.high,
    });
    expect(high.telemetry).toMatchObject({
      reasoningEffort: "high",
      maxOutputTokens: COPILOT_OUTPUT_TOKENS_BY_EFFORT.high,
      model: TITULAR,
    });
  });

  it("teto de custo do turno continua soberano: esforço alto que não cabe volta ao teto base", async () => {
    // teto que comporta a saída base mas não a de `high`
    const r = await mk(() => "high", 0.02);
    expect(r.seen[0]).toMatchObject({ effort: "high", max: COPILOT_OUTPUT_TOKENS_BY_EFFORT.low });
  });
});
