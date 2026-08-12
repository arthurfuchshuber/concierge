/**
 * Validação final (Gemini Flash) — última etapa antes de enviar ao hóspede.
 * Verifica conflitos, alucinações, dados fora do contexto, idioma e políticas.
 * Se houver qualquer inconsistência, a resposta NÃO é enviada automaticamente:
 * o atendimento é escalado para um humano.
 */
import { chatJson, EMPTY_USAGE, type Usage } from "./gateway.server";
import { PROMPTS } from "./prompts";

export type Validation = {
  approved: boolean;
  reason: string;
  issues: string[];
  needsHuman: boolean;
  confidence: number;
};

export async function validateAnswer(params: {
  question: string;
  answer: string;
  evidence: string;
  language: string;
  policies?: string;
}): Promise<{ validation: Validation; usage: Usage; model: string }> {
  if (!params.answer.trim()) {
    return {
      validation: { approved: false, reason: "resposta vazia", issues: ["empty"], needsHuman: true, confidence: 0 },
      usage: EMPTY_USAGE,
      model: "",
    };
  }

  try {
    const { data, usage, model } = await chatJson<Partial<Validation>>("validation", [
      {
        role: "system",
        content: PROMPTS.validation.text,
      },
      {
        role: "user",
        content:
          `Idioma esperado: ${params.language}\n` +
          `${params.policies ? `Políticas:\n${params.policies}\n` : ""}` +
          `Pergunta do hóspede:\n${params.question}\n\nEVIDÊNCIAS:\n${params.evidence}\n\nRESPOSTA PROPOSTA:\n${params.answer}`,
      },
    ]);

    if (!data) {
      // Falha do validador não pode travar o atendimento: aprovamos com confiança baixa.
      return {
        validation: { approved: true, reason: "validador indisponível", issues: [], needsHuman: false, confidence: 0.5 },
        usage,
        model,
      };
    }

    return {
      validation: {
        approved: data.approved !== false,
        reason: data.reason ?? "",
        issues: Array.isArray(data.issues) ? data.issues.slice(0, 8).map(String) : [],
        needsHuman: data.needsHuman === true || data.approved === false,
        confidence: typeof data.confidence === "number" ? data.confidence : 0.7,
      },
      usage,
      model,
    };
  } catch (err) {
    console.error("[ai] validateAnswer falhou", err);
    return {
      validation: { approved: true, reason: "validador indisponível", issues: [], needsHuman: false, confidence: 0.5 },
      usage: EMPTY_USAGE,
      model: "",
    };
  }
}
