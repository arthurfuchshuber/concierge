/**
 * Sugestão de botões de resposta rápida a partir da resposta final da IA.
 * Modelo barato — nunca altera o texto enviado ao hóspede.
 *
 * Regra do produto: sempre que a IA termina fazendo uma pergunta, o hóspede
 * precisa poder responder num toque ("Quero", "Agora não", "Atualizar
 * sugestões"). O campo de digitar continua sempre disponível — o botão é
 * atalho, nunca substituto.
 */
import { chatJson, EMPTY_USAGE, type Usage } from "./gateway.server";

/** Rede de segurança: se o modelo não devolver nada, o hóspede ainda tem atalho. */
function fallbackOptions(language: string | undefined, category?: string): string[] {
  const en = (language || "pt").toLowerCase().startsWith("en");
  const es = (language || "pt").toLowerCase().startsWith("es");
  const isRec = category === "recomendacao" || category === "cidade";
  if (en) return isRec ? ["Yes, please", "Other options", "Not now"] : ["Yes, please", "Not now"];
  if (es) return isRec ? ["Sí, quiero", "Otras opciones", "Ahora no"] : ["Sí, quiero", "Ahora no"];
  return isRec ? ["Quero", "Atualizar sugestões", "Agora não"] : ["Quero", "Agora não"];
}

export async function suggestQuickReplies(params: {
  answer: string;
  language?: string;
  category?: string;
}): Promise<{ options: string[]; usage: Usage; model: string }> {
  const answer = (params.answer || "").trim();
  if (!answer) return { options: [], usage: EMPTY_USAGE, model: "" };
  const hasQuestion = /\?/.test(answer);

  try {
    const { data, usage, model } = await chatJson<{ options?: unknown }>("intent", [
      {
        role: "system",
        content:
          "Você sugere botões de resposta rápida para o hóspede responder à última mensagem da IA. " +
          'Responda APENAS JSON válido: {"options": ["...", "..."]}. ' +
          "Regras: 2 a 3 opções, cada uma com até 24 caracteres, no idioma da conversa, " +
          "sem emojis e sem repetir o texto da IA. " +
          "SEMPRE devolva opções quando a mensagem da IA terminar com uma pergunta ao hóspede: " +
          "a primeira opção aceita a oferta da pergunta (ex.: 'Quero', 'Pode buscar'), " +
          "e inclua uma opção de recusar ou pedir outra coisa (ex.: 'Agora não', 'Atualizar sugestões'). " +
          "Quando o assunto for recomendação/passeio/restaurante, uma das opções deve pedir novas " +
          "sugestões ('Atualizar sugestões' ou equivalente no idioma). " +
          "Só devolva lista vazia se a mensagem NÃO fizer nenhuma pergunta ao hóspede.",
      },
      {
        role: "user",
        content:
          `Idioma: ${params.language || "pt"} | assunto: ${params.category || "geral"}\n\n` +
          `Mensagem da IA:\n${answer.slice(0, 1200)}`,
      },
    ]);

    const options = Array.isArray(data?.options)
      ? (data.options as unknown[])
          .filter((o): o is string => typeof o === "string")
          .map((o) => o.trim())
          .filter((o) => o.length > 0 && o.length <= 40)
          .slice(0, 3)
      : [];

    if (!options.length && hasQuestion) {
      return { options: fallbackOptions(params.language, params.category), usage, model };
    }
    return { options, usage, model };
  } catch {
    return {
      options: hasQuestion ? fallbackOptions(params.language, params.category) : [],
      usage: EMPTY_USAGE,
      model: "",
    };
  }
}
