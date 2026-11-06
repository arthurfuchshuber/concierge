/**
 * F2-A — CONTRATOS do LLM Gateway do ConciergeIA Guest (agnósticos de fornecedor).
 *
 * Este módulo é SÓ transporte e telemetria: não monta prompt, não lê banco, não conhece
 * credenciais, não envia mensagens a canal nenhum. Quem chama (o Orchestrator, em fase
 * futura) entrega mensagens já prontas e recebe um resultado tipado que NUNCA lança:
 * falha = `{ ok: false }` e o chamador segue o fallback humano (fail-closed).
 *
 * Independente de `src/lib/llm/` (gateway das funcionalidades convencionais do SaaS).
 */

/** Papéis aceitos. Não há papel "tool": F2-A não executa nem registra ferramentas. */
export type LlmRole = "system" | "user" | "assistant";

/** Parte de texto de uma mensagem multimodal. */
export interface LlmContentPartText {
  type: "text";
  text: string;
}

/**
 * Parte de imagem (formato compatível com OpenAI / Lovable AI Gateway). SÓ Data URL em base64 de
 * JPEG, PNG ou WebP: URL externa é recusada (nada de o provedor buscar endereço arbitrário nem de
 * link assinado do storage sair para fora).
 */
export interface LlmContentPartImage {
  type: "image_url";
  image_url: { url: string };
}

export type LlmContentPart = LlmContentPartText | LlmContentPartImage;

/** Texto puro (caso comum) ou partes multimodais (texto + imagens; imagens só em mensagem `user`). */
export type LlmMessageContent = string | readonly LlmContentPart[];

export interface LlmMessage {
  role: LlmRole;
  content: LlmMessageContent;
}

/** Prefixos aceitos para imagem (Data URL base64). */
export const LLM_IMAGE_DATA_URL_PREFIXES = [
  "data:image/jpeg;base64,",
  "data:image/png;base64,",
  "data:image/webp;base64,",
] as const;

/** Texto de uma mensagem: o próprio texto, ou as partes de texto concatenadas (imagens ignoradas). */
export function llmMessageText(content: LlmMessageContent): string {
  if (typeof content === "string") return content;
  return content
    .filter((p): p is LlmContentPartText => !!p && p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n");
}

/** Quantas partes de imagem a mensagem carrega. */
export function llmImageCount(content: LlmMessageContent): number {
  return typeof content === "string" ? 0 : content.filter((p) => p && p.type === "image_url").length;
}

/** Esforço de raciocínio. `none` = não pedir raciocínio (o parâmetro não é enviado). */
export type ReasoningEffort = "none" | "low" | "medium" | "high";

export type LlmResponseFormat = "text" | "json";

/** Para que serve a chamada — vai para telemetria; não altera o comportamento do transporte. */
export type LlmPurpose = "guest_reply" | "guest_classification" | "evaluation" | "test";

export interface LlmRequest {
  purpose: LlmPurpose;
  /** Identificador do modelo no registro (`llm/models.ts`). Modelo fora do registro é recusado. */
  model: string;
  messages: readonly LlmMessage[];
  /** Teto de tokens de saída. Limitado por `LIMITS.maxOutputTokens` e pelo teto do modelo. */
  maxOutputTokens: number;
  reasoningEffort?: ReasoningEffort;
  responseFormat?: LlmResponseFormat;
  /** 0–2. Omitido = padrão do provedor. Ignorado em modelos que não aceitam temperatura. */
  temperature?: number;
  /** Prazo total da chamada (inclui nova tentativa). Padrão e máximo: 15 000 ms. */
  timeoutMs?: number;
  /** Cancelamento externo (ex.: a conversa foi assumida por humano). */
  signal?: AbortSignal;
  /**
   * Valores que JAMAIS podem sair para o provedor (ex.: senha da porta, se algum dia o
   * chamador os tiver em memória). Se qualquer um aparecer em qualquer mensagem, a chamada
   * é recusada ANTES da rede (`sensitive_content_blocked`). Nunca são registrados em log.
   */
  forbiddenValues?: readonly string[];
  /** Correlação opaca para logs (ex.: id do turno). Não deve conter dado pessoal. */
  traceId?: string;
}

/** Limites rígidos do gateway (independentes do modelo). */
export const LIMITS = {
  maxTimeoutMs: 15_000,
  minTimeoutMs: 1_000,
  maxMessages: 60,
  maxTotalChars: 200_000,
  maxOutputTokens: 4_096,
  maxTraceIdLength: 80,
  /** Imagens por requisição (somadas todas as mensagens). */
  maxImageParts: 3,
  /** Soma dos tamanhos (caracteres) de todas as Data URLs de imagem da requisição (~7,5 MB de imagem). */
  maxImageDataUrlChars: 10_000_000,
} as const;

/**
 * Tokens de entrada ESTIMADOS por imagem, só quando o provedor não informa uso (observabilidade).
 * O orçamento de custo do chamador usa um limite superior próprio, calculado pelas dimensões reais.
 */
export const ESTIMATED_TOKENS_PER_IMAGE = 1_290;

export interface LlmUsage {
  inputTokens: number;
  /** Tokens de saída cobrados (inclui os de raciocínio, quando o provedor os informa à parte). */
  outputTokens: number;
  /** Parte de `outputTokens` gasta em raciocínio (0 quando o provedor não informa). */
  reasoningTokens: number;
  totalTokens: number;
  /** `provider` = contagem do provedor; `estimated` = provedor não informou (estimativa por caracteres). */
  source: "provider" | "estimated" | "none";
}

export const ZERO_USAGE: LlmUsage = Object.freeze({ inputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0, source: "none" });

export type LlmFinishReason = "stop" | "length" | "content_filter" | "other";

export interface LlmTelemetry {
  provider: string;
  model: string;
  purpose: LlmPurpose;
  latencyMs: number;
  attempts: number;
  usage: LlmUsage;
  /** Custo estimado em USD (tabela do registro de modelos; observabilidade, não cobrança). */
  costUsd: number;
  /** Id de requisição devolvido pelo provedor, se houver. */
  providerRequestId: string | null;
  traceId: string | null;
}

export interface LlmSuccess {
  ok: true;
  text: string;
  /** Presente quando `responseFormat: "json"` (já validado com JSON.parse). */
  json?: unknown;
  finishReason: "stop";
  telemetry: LlmTelemetry;
}

/** Os 17 códigos de erro do Gateway (lista em tempo de execução: permite verificar compatibilidade exaustiva). */
export const LLM_ERROR_CODES = [
  "invalid_request", // contrato violado (modelo fora do registro, limites, esforço não suportado…)
  "sensitive_content_blocked", // valor proibido detectado nas mensagens; nada saiu para a rede
  "config_missing", // chave do provedor ausente
  "timeout", // prazo de 15 s estourado
  "aborted", // cancelado pelo chamador
  "rate_limited", // 429
  "billing", // 402
  "auth", // 401/403
  "model_unavailable", // 404
  "bad_request", // 400/422 do provedor
  "provider_unavailable", // 5xx
  "network", // falha de rede sem resposta HTTP
  "invalid_response", // corpo ilegível, JSON pedido e não entregue, formato inesperado
  "empty_response", // resposta sem texto
  "truncated_response", // cortada por limite de tokens ou fluxo interrompido
  "content_filtered", // bloqueada pelo filtro do provedor
  "internal_error", // falha inesperada no próprio gateway (capturada; nunca propaga exceção)
] as const;
export type LlmErrorCode = (typeof LLM_ERROR_CODES)[number];

export interface LlmFailure {
  ok: false;
  error: {
    code: LlmErrorCode;
    /** Vale tentar de novo mais tarde (decisão do chamador; o gateway já fez o que podia). */
    retryable: boolean;
    httpStatus: number | null;
  };
  telemetry: LlmTelemetry;
}

export type LlmResult = LlmSuccess | LlmFailure;
