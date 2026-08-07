/**
 * Registro central de modelos da arquitetura de IA do ConciergeIA.
 *
 * Toda escolha de modelo passa por aqui — nenhum arquivo de feature deve
 * escrever o identificador do modelo diretamente. Trocar um modelo no futuro
 * é editar somente este arquivo.
 */

export const AI_MODELS = {
  /** Agente principal: raciocínio, planejamento, tool calling, resposta. */
  agent: "openai/gpt-5.6-sol",
  /** Classificação de intenção / idioma / urgência (baixa latência, baixo custo). */
  intent: "google/gemini-3.1-flash-lite",
  /** Tradução bidirecional em tempo real. */
  translate: "google/gemini-3.1-flash-lite",
  /** Análise de sentimento e risco. */
  sentiment: "google/gemini-3.1-flash-lite",
  /** Resumo automático de conversas. */
  summary: "google/gemini-2.5-flash",
  /** Memória inteligente por hóspede. */
  memory: "google/gemini-2.5-flash",
  /** Validação final antes de enviar ao hóspede. */
  validation: "google/gemini-2.5-flash",
  /** City Pulse: clima, eventos, notícias, informações locais. */
  cityPulse: "google/gemini-2.5-flash",
  /** Extração inteligente de documentos (RG, passaporte, CNH, comprovantes). */
  documents: "google/gemini-2.5-flash",
  /** Interpretação de contratos (ClickSign). */
  contracts: "openai/gpt-5.6-sol",
  /** Geração de conteúdo (descrições, mensagens, anúncios, e-mails). */
  content: "google/gemini-2.5-flash",
  /** Concierge interno (operadores). */
  internal: "google/gemini-2.5-flash",
  /** Organização e justificativa de recomendações turísticas. */
  recommendations: "google/gemini-2.5-flash",
  /** Embeddings do Hybrid RAG. */
  embeddings: "google/gemini-embedding-2",
} as const;

export type AiTask = keyof typeof AI_MODELS;

export function modelFor(task: AiTask): string {
  return AI_MODELS[task];
}

/** Modelos OpenAI são servidos pela Responses API do gateway. */
export function isResponsesModel(model: string): boolean {
  return model.startsWith("openai/");
}

/** Custo estimado em USD por 1M de tokens (aproximado, apenas para observabilidade). */
const COST_PER_MTOK: Record<string, { input: number; output: number }> = {
  "openai/gpt-5.6-sol": { input: 1.25, output: 10 },
  "google/gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "google/gemini-3.1-flash-lite": { input: 0.1, output: 0.4 },
  "google/gemini-embedding-2": { input: 0.15, output: 0 },
};

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const table = COST_PER_MTOK[model] ?? { input: 0.3, output: 2.5 };
  return (inputTokens / 1_000_000) * table.input + (outputTokens / 1_000_000) * table.output;
}
