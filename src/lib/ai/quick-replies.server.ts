/**
 * Sugestão de botões de resposta rápida a partir da resposta final da IA.
 * Modelo barato — nunca altera o texto enviado ao hóspede.
 */
import { chatJson, EMPTY_USAGE, type Usage } from "./gateway.server";

export async function suggestQuickReplies(params: {
  answer: string;
  language?: string;
}): Promise<{ options: string[]; usage: Usage; model: string }> {
  const answer = (params.answer || "").trim();
  if (!answer) return { options: [], usage: EMPTY_USAGE, model: "" };

  try {
    const { data, usage, model } = await chatJson<{ options?: unknown }>("intent", [
      {
        role: "system",
        content:
          "Você sugere botões de resposta rápida para o hóspede responder à última mensagem da IA. " +
          'Responda APENAS JSON válido: {"options": ["...", "..."]}. ' +
          "Regras: no máximo 3 opções, cada uma com até 24 caracteres, no idioma da conversa, " +
          "sem emojis e sem repetir o texto da IA. Se a mensagem NÃO fizer uma pergunta clara com " +
          "alternativas objetivas, devolva uma lista vazia.",
      },
      {
        role: "user",
        content: `Idioma: ${params.language || "pt"}\n\nMensagem da IA:\n${answer.slice(0, 1200)}`,
      },
    ]);

    const options = Array.isArray(data?.options)
      ? (data.options as unknown[])
          .filter((o): o is string => typeof o === "string")
          .map((o) => o.trim())
          .filter((o) => o.length > 0 && o.length <= 40)
          .slice(0, 3)
      : [];

    return { options, usage, model };
  } catch {
    return { options: [], usage: EMPTY_USAGE, model: "" };
  }
}
