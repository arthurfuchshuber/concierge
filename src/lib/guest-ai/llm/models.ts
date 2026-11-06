/**
 * F2-A — Registro de modelos do Guest AI (próprio; NÃO usa `src/lib/llm/models.ts`).
 *
 * Só modelos registrados podem ser chamados: modelo desconhecido = custo desconhecido =
 * recusa (`invalid_request`). Preços em USD por 1M de tokens, para OBSERVABILIDADE
 * (estimativa; a cobrança real é a do saldo de IA do Lovable). Revisar ao trocar de modelo.
 *
 * `wire` diz como o gateway do Lovable serve o modelo:
 *  - `chat`      → POST /chat/completions (Google), `reasoning_effort`
 *  - `responses` → POST /responses em streaming (OpenAI), `reasoning.effort`
 */
import type { ReasoningEffort } from "./contracts";

export type WireFormat = "chat" | "responses";

export interface ModelSpec {
  id: string;
  provider: "lovable-gateway";
  /** Família do modelo (para relatórios). */
  vendor: "google" | "openai";
  wire: WireFormat;
  /** Esforços aceitos além de `none`. Vazio = modelo sem controle de raciocínio. */
  reasoningEfforts: readonly Exclude<ReasoningEffort, "none">[];
  supportsTemperature: boolean;
  supportsJson: boolean;
  /** Aceita partes de imagem (visão multimodal). Modelo sem visão + imagem ⇒ `invalid_request`. */
  supportsImages: boolean;
  /** Teto de saída do modelo neste gateway (o menor entre isto e `LIMITS.maxOutputTokens` vale). */
  maxOutputTokens: number;
  /**
   * Janela de contexto (entrada + saída) usada no ORÇAMENTO de contexto do Guest AI.
   * Valor CONSERVADOR PROVISÓRIO (piso comum aos modelos cadastrados), não o máximo anunciado
   * pelo fornecedor: a sonda D14 confirma os limites reais antes de qualquer ajuste para cima.
   */
  contextWindowTokens: number;
  pricePerMTok: { input: number; output: number };
}

/** Piso conservador provisório da janela de contexto (ver `contextWindowTokens`). */
export const CONSERVATIVE_CONTEXT_WINDOW = 128_000;

const SPECS: readonly ModelSpec[] = [
  {
    id: "google/gemini-3.8-flash",
    provider: "lovable-gateway",
    vendor: "google",
    wire: "chat",
    reasoningEfforts: ["low", "medium", "high"],
    supportsTemperature: true,
    supportsJson: true,
    supportsImages: true,
    maxOutputTokens: 8_192,
    contextWindowTokens: CONSERVATIVE_CONTEXT_WINDOW,
    pricePerMTok: { input: 0.3, output: 2.5 },
  },
  {
    id: "google/gemini-3.1-flash-lite",
    provider: "lovable-gateway",
    vendor: "google",
    wire: "chat",
    reasoningEfforts: ["low", "medium", "high"],
    supportsTemperature: true,
    supportsJson: true,
    supportsImages: true,
    maxOutputTokens: 8_192,
    contextWindowTokens: CONSERVATIVE_CONTEXT_WINDOW,
    pricePerMTok: { input: 0.1, output: 0.4 },
  },
  {
    id: "openai/gpt-6-astra",
    provider: "lovable-gateway",
    vendor: "openai",
    wire: "responses",
    reasoningEfforts: ["low", "medium", "high"],
    // Modelos de raciocínio da OpenAI não aceitam temperatura.
    supportsTemperature: false,
    supportsJson: true,
    supportsImages: true,
    maxOutputTokens: 8_192,
    contextWindowTokens: CONSERVATIVE_CONTEXT_WINDOW,
    pricePerMTok: { input: 1.25, output: 10 },
  },
  {
    id: "openai/gpt-5.6-sol",
    provider: "lovable-gateway",
    vendor: "openai",
    wire: "responses",
    reasoningEfforts: ["low", "medium", "high"],
    supportsTemperature: false,
    supportsJson: true,
    supportsImages: true,
    maxOutputTokens: 8_192,
    contextWindowTokens: CONSERVATIVE_CONTEXT_WINDOW,
    pricePerMTok: { input: 1.25, output: 10 },
  },
];

export const GUEST_AI_MODELS: ReadonlyMap<string, ModelSpec> = new Map(SPECS.map((s) => [s.id, Object.freeze(s)]));

export function modelSpec(id: string): ModelSpec | null {
  return GUEST_AI_MODELS.get(id) ?? null;
}

/** Custo estimado (USD), arredondado a 1e-8. Tokens de raciocínio já estão em `outputTokens`. */
export function estimateCostUsd(spec: ModelSpec, inputTokens: number, outputTokens: number): number {
  const raw = (inputTokens / 1_000_000) * spec.pricePerMTok.input + (outputTokens / 1_000_000) * spec.pricePerMTok.output;
  return Math.round(raw * 1e8) / 1e8;
}

/** Estimativa grosseira (≈4 caracteres por token) só quando o provedor não informa uso. */
export function estimateTokensFromChars(chars: number): number {
  return chars <= 0 ? 0 : Math.ceil(chars / 4);
}
