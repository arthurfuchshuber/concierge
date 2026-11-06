import { describe, expect, it } from "vitest";
import {
  CHARS_PER_TOKEN_CONSERVATIVE,
  GATEWAY_LIMITS,
  PROVISIONAL_CONTEXT_WINDOW_TOKENS,
  defaultBudgetConfig,
  estimateTokens,
  evaluateBudget,
} from "@/lib/guest-ai/budget";
import { LIMITS } from "@/lib/guest-ai/llm/contracts";
import { CONSERVATIVE_CONTEXT_WINDOW, modelSpec } from "@/lib/guest-ai/llm/models";
import { GUEST_AI_DEFAULT_MODEL, TURN_MAX_OUTPUT_TOKENS } from "@/lib/guest-ai/orchestrator/contracts";

const msg = (n: number) => ({ content: "x".repeat(n) });

describe("B2.1 · orçamento — espelhos fiéis do Gateway F2-A e do registro de modelos", () => {
  it("tetos do Gateway iguais a LIMITS (60 mensagens, 200 mil caracteres)", () => {
    expect(GATEWAY_LIMITS.maxMessages).toBe(LIMITS.maxMessages);
    expect(GATEWAY_LIMITS.maxTotalChars).toBe(LIMITS.maxTotalChars);
  });
  it("janela provisória igual à do registro e à do modelo padrão; saída = teto do turno", () => {
    expect(PROVISIONAL_CONTEXT_WINDOW_TOKENS).toBe(CONSERVATIVE_CONTEXT_WINDOW);
    expect(PROVISIONAL_CONTEXT_WINDOW_TOKENS).toBe(modelSpec(GUEST_AI_DEFAULT_MODEL)!.contextWindowTokens);
    expect(defaultBudgetConfig().reservedOutputTokens).toBe(TURN_MAX_OUTPUT_TOKENS);
  });
});

describe("B2.1 · orçamento — estimativa conservadora", () => {
  it("ceil(chars/3), nunca negativa", () => {
    expect(CHARS_PER_TOKEN_CONSERVATIVE).toBe(3);
    expect(estimateTokens(0)).toBe(0);
    expect(estimateTokens(-5)).toBe(0);
    expect(estimateTokens(Number.NaN)).toBe(0);
    expect(estimateTokens(1)).toBe(1);
    expect(estimateTokens(3)).toBe(1);
    expect(estimateTokens(4)).toBe(2);
  });
  it("superestima em relação à medição do Gate B2.0 (chars/4)", () => {
    expect(estimateTokens(57_203)).toBeGreaterThan(Math.ceil(57_203 / 4));
  });
});

describe("B2.1 · orçamento — vereditos tipados, sem cortar nada", () => {
  it("pior caso medido no Gate B2.0 (~80 mil caracteres) cabe com folga", () => {
    const v = evaluateBudget([msg(5_000), msg(75_000)], []);
    expect(v.ok).toBe(true);
    expect(v.metrics.totalChars).toBe(80_000);
    expect(v.metrics.availableInputTokens).toBe(128_000 - 1_024 - 8_000);
  });
  it("caracteres acima do Gateway ⇒ gateway_chars (limite exato ainda passa)", () => {
    expect(evaluateBudget([msg(100_000), msg(100_000)], []).ok).toBe(true);
    const v = evaluateBudget([msg(100_000), msg(100_001)], []);
    expect(v).toMatchObject({ ok: false, reason: "gateway_chars" });
  });
  it("tokens acima da janela útil ⇒ input_tokens (com janela menor)", () => {
    const cfg = { ...defaultBudgetConfig(), contextWindowTokens: 20_000 };
    const usable = 20_000 - 1_024 - 8_000;
    expect(evaluateBudget([msg(usable * 3)], [], cfg).ok).toBe(true);
    expect(evaluateBudget([msg(usable * 3 + 1)], [], cfg)).toMatchObject({ ok: false, reason: "input_tokens" });
  });
  it("número de mensagens fora de 1..60 ⇒ gateway_messages", () => {
    expect(evaluateBudget([], [])).toMatchObject({ ok: false, reason: "gateway_messages" });
    expect(evaluateBudget(Array.from({ length: 61 }, () => msg(1)), [])).toMatchObject({ ok: false, reason: "gateway_messages" });
    expect(evaluateBudget(Array.from({ length: 60 }, () => msg(1)), []).ok).toBe(true);
  });
  it("configuração inválida ⇒ invalid_config (nunca passa por padrão)", () => {
    const base = defaultBudgetConfig();
    for (const bad of [
      { ...base, contextWindowTokens: 0 },
      { ...base, contextWindowTokens: 1.5 },
      { ...base, reservedOutputTokens: -1 },
      { ...base, safetyMarginTokens: -1 },
      { ...base, gatewayMaxChars: 0 },
      { ...base, gatewayMaxMessages: Number.NaN },
      { ...base, contextWindowTokens: 9_000 }, // sem espaço útil depois de saída+margem
    ]) {
      expect(evaluateBudget([msg(10)], [], bad)).toMatchObject({ ok: false, reason: "invalid_config" });
    }
  });
  it("métricas só com números e nomes de seção — nunca conteúdo; capacidade e latência NÃO validadas", () => {
    const secret = "TEXTO-PRIVADO-DO-HOSPEDE";
    const v = evaluateBudget([{ content: secret }], [{ name: "history", chars: secret.length }]);
    const json = JSON.stringify(v.metrics);
    expect(json).not.toContain(secret);
    expect(v.metrics.capacityValidated).toBe(false);
    expect(v.metrics.latencyValidated).toBe(false);
    expect(v.metrics.sections).toEqual([{ name: "history", chars: secret.length, estimatedTokens: estimateTokens(secret.length) }]);
    expect(v.metrics.estimator).toBe("chars_div_3_conservative");
  });
  it("não altera as mensagens recebidas", () => {
    const m = [msg(10), msg(20)];
    const copy = JSON.stringify(m);
    evaluateBudget(m, []);
    expect(JSON.stringify(m)).toBe(copy);
  });
});
