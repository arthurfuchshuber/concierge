/**
 * Validação final (Gemini Flash) — última etapa antes de enviar ao hóspede.
 * Verifica conflitos, alucinações, dados fora do contexto, idioma e políticas.
 * Se houver qualquer inconsistência, a resposta NÃO é enviada automaticamente:
 * o atendimento é escalado para um humano.
 *
 * FAIL-SAFE: se o validador falhar (indisponível/erro/resposta vazia) em um
 * contexto de risco alto — categoria sensível (acesso/reserva/financeiro) ou
 * plano marcado como risco alto — NÃO aprovamos por padrão. Aprovar "às cegas"
 * justamente quando a checagem anti-alucinação está fora do ar é o pior momento
 * possível para relaxar a guarda. Em contexto de risco normal/baixo, seguimos
 * falhando aberto (não travar o atendimento por uma instabilidade pontual).
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

function unavailableValidation(highRisk: boolean): Validation {
  return highRisk
    ? {
        approved: false,
        reason: "validador indisponível em contexto de risco alto — escalado por segurança",
        issues: ["validator_unavailable_high_risk"],
        needsHuman: true,
        confidence: 0,
      }
    : { approved: true, reason: "validador indisponível", issues: [], needsHuman: false, confidence: 0.5 };
}

export async function validateAnswer(params: {
  question: string;
  answer: string;
  evidence: string;
  language: string;
  policies?: string;
  /** Turnos anteriores — sem eles o validador não resolve perguntas de continuidade. */
  history?: Array<{ role: string; content: string }>;
  /** Falha fechado (nunca aprova às cegas) quando true. Ver nota FAIL-SAFE acima. */
  highRisk?: boolean;
}): Promise<{ validation: Validation; usage: Usage; model: string }> {
  const highRisk = params.highRisk === true;

  if (!params.answer.trim()) {
    return {
      validation: { approved: false, reason: "resposta vazia", issues: ["empty"], needsHuman: true, confidence: 0 },
      usage: EMPTY_USAGE,
      model: "",
    };
  }

  const historyText = (params.history ?? [])
    .slice(-8)
    .map((m) => `${m.role === "assistant" ? "IA" : "Hóspede"}: ${(m.content ?? "").slice(0, 600)}`)
    .join("\n");

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
          `${historyText ? `CONVERSA ATÉ AQUI (use para resolver referências como "sim", "essa", "outra"):\n${historyText}\n\n` : ""}` +
          `Pergunta do hóspede:\n${params.question}\n\nEVIDÊNCIAS:\n${params.evidence}\n\nRESPOSTA PROPOSTA:\n${params.answer}`,
      },
    ]);

    if (!data) {
      return { validation: unavailableValidation(highRisk), usage, model };
    }

    const approved = data.approved !== false;
    return {
      validation: {
        approved,
        reason: data.reason ?? "",
        issues: Array.isArray(data.issues) ? data.issues.slice(0, 8).map(String) : [],
        // Reprovar a redação NÃO é motivo para chamar um humano: só escalamos
        // quando o validador pede explicitamente, ou em contexto de risco alto.
        needsHuman: data.needsHuman === true || (!approved && highRisk),
        confidence: typeof data.confidence === "number" ? data.confidence : 0.7,
      },
      usage,
      model,
    };
  } catch (err) {
    console.error("[ai] validateAnswer falhou", err);
    return { validation: unavailableValidation(highRisk), usage: EMPTY_USAGE, model: "" };
  }
}
