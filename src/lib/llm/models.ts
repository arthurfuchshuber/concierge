/**
 * Registro central de modelos do Lovable AI Gateway usados pelo ConciergeIA.
 *
 * Cobre as funcionalidades CONVENCIONAIS do SaaS (tradução de mensagens no
 * Atendimento, City Pulse do guia, dica do dia, leitura de documentos do
 * hóspede, extração de contratos, curadoria de recomendações, embeddings do
 * conhecimento do sistema) e o Assistente do Painel (`internal`).
 *
 * NÃO é a arquitetura de IA de atendimento ao hóspede: aquela implementação
 * foi removida em 01/11/2026 e será reconstruída do zero. Toda escolha de
 * modelo continua passando por aqui.
 */

export const AI_MODELS = {
  /** Tradução bidirecional de mensagens (Atendimento, chat do guia). */
  translate: "google/gemini-3.1-flash-lite",
  /** City Pulse: clima, eventos, notícias, informações locais. */
  cityPulse: "google/gemini-3.8-flash",
  /** Extração inteligente de documentos (RG, passaporte, CNH, comprovantes). */
  documents: "google/gemini-3.8-flash",
  /** Interpretação de contratos (ClickSign). */
  contracts: "openai/gpt-6-astra",
  /** Geração de conteúdo (dica do dia, descrições). */
  content: "google/gemini-3.8-flash",
  /**
   * Assistente do Painel — o concierge interno dos operadores.
   *
   * Precisa ser um modelo OpenAI: é o único caminho de tool calling nesta
   * arquitetura (`runAgent` fala com a Responses API), e o assistente depende
   * de ferramentas tanto para ler a operação quanto para montar uma ação.
   */
  internal: "openai/gpt-6-astra",
  /** Organização e justificativa de recomendações turísticas. */
  recommendations: "google/gemini-3.8-flash",
  /** Embeddings do conhecimento do sistema (`ai_system_docs`, Assistente do Painel). */
  embeddings: "google/gemini-embedding-2",
} as const;

export type AiTask = keyof typeof AI_MODELS;

export function modelFor(task: AiTask): string {
  return AI_MODELS[task];
}

/**
 * MODELOS RESERVA (31/10/2026): se o modelo principal estiver fora do ar (5xx, rede, modelo indisponível),
 * a mesma tarefa é refeita uma vez no reserva. Modelos OpenAI → outro OpenAI (continua com tool calling);
 * Gemini → versão mais leve. Embeddings não têm reserva (trocar de modelo mudaria o espaço de busca).
 * 429 (limite) e 402 (créditos) NÃO caem no reserva: trocar de modelo não resolve e mascararia o problema.
 */
export const FALLBACK_MODELS: Record<string, string> = {
  "openai/gpt-6-astra": "openai/gpt-5.6-sol",
  "google/gemini-3.8-flash": "google/gemini-3.1-flash-lite",
  "google/gemini-3.1-flash-lite": "google/gemini-3.8-flash",
};

export function fallbackModel(model: string): string | null {
  return FALLBACK_MODELS[model] ?? null;
}

/** Só falhas do lado do provedor justificam trocar de modelo. */
export function shouldFallback(status: number | undefined): boolean {
  if (status === undefined) return true; // erro de rede / sem resposta
  return status >= 500 || status === 404 || status === 400;
}

/** Modelos OpenAI são servidos pela Responses API do gateway. */
export function isResponsesModel(model: string): boolean {
  return model.startsWith("openai/");
}

/** Custo estimado em USD por 1M de tokens (aproximado, apenas para observabilidade). */
const COST_PER_MTOK: Record<string, { input: number; output: number }> = {
  "openai/gpt-6-astra": { input: 1.25, output: 10 },
  "openai/gpt-5.6-sol": { input: 1.25, output: 10 },
  "google/gemini-3.8-flash": { input: 0.3, output: 2.5 },
  "google/gemini-3.1-flash-lite": { input: 0.1, output: 0.4 },
  "google/gemini-embedding-2": { input: 0.15, output: 0 },
};

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const table = COST_PER_MTOK[model] ?? { input: 0.3, output: 2.5 };
  return (inputTokens / 1_000_000) * table.input + (outputTokens / 1_000_000) * table.output;
}
