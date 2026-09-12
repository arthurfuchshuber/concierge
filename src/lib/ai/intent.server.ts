/**
 * Etapa 1 do pipeline: classificação da intenção.
 * Modelo rápido e barato — nunca gera resposta ao hóspede.
 */
import { chatJson, EMPTY_USAGE, type Usage } from "./gateway.server";

export type Intent = {
  intent: string;
  category:
    | "acesso"
    | "residencia"
    | "reserva"
    | "cidade"
    | "recomendacao"
    | "operacional"
    | "financeiro"
    | "social"
    | "outro";
  language: string;
  sentiment: "positivo" | "neutro" | "negativo";
  urgency: "low" | "normal" | "high";
  priority: number;
  needsHuman: boolean;
  searchQuery: string;
};

const FALLBACK: Intent = {
  intent: "indefinido",
  category: "outro",
  language: "pt",
  sentiment: "neutro",
  urgency: "normal",
  priority: 3,
  needsHuman: false,
  searchQuery: "",
};

export async function classifyIntent(
  message: string,
  history: Array<{ role: string; content: string }> = [],
): Promise<{ intent: Intent; usage: Usage; model: string }> {
  const recent = history
    .slice(-4)
    .map((m) => `${m.role === "user" ? "Hóspede" : "IA"}: ${m.content}`)
    .join("\n");

  try {
    const { data, usage, model } = await chatJson<Partial<Intent>>("intent", [
      {
        role: "system",
        content:
          "Você classifica mensagens de hóspedes de hospedagem por temporada. " +
          "Responda APENAS JSON válido com as chaves: intent (frase curta), category " +
          '(acesso|residencia|reserva|cidade|recomendacao|operacional|financeiro|social|outro), ' +
          "language (código ISO 639-1), sentiment (positivo|neutro|negativo), urgency (low|normal|high), " +
          "priority (1 a 5, 5 = máxima), needsHuman (boolean: true quando é emergência, problema físico no " +
          "imóvel, reclamação grave ou pedido explícito de humano), searchQuery (consulta curta e objetiva " +
          "para buscar na base de conhecimento).",
      },
      { role: "user", content: `${recent ? `Contexto recente:\n${recent}\n\n` : ""}Mensagem: ${message}` },
    ]);

    if (!data) return { intent: { ...FALLBACK, searchQuery: message }, usage, model };
    return {
      intent: {
        ...FALLBACK,
        ...data,
        searchQuery: (data.searchQuery || message).slice(0, 300),
      } as Intent,
      usage,
      model,
    };
  } catch (err) {
    console.error("[ai] classifyIntent falhou", err);
    return { intent: { ...FALLBACK, searchQuery: message }, usage: EMPTY_USAGE, model: "" };
  }
}
