/**
 * Reflection Step — autoavaliação da resposta antes do envio ao hóspede.
 *
 * Avalia clareza, precisão, consistência e tom, e pode devolver uma versão
 * melhorada da redação (sem inventar informação nova). Falhas nunca bloqueiam
 * o atendimento: a resposta original segue com score neutro.
 */
import { chatJson, EMPTY_USAGE, type Usage } from "./gateway.server";
import { PROMPTS } from "./prompts";

export type Reflection = {
  clarity: number;
  accuracy: number;
  consistency: number;
  tone: number;
  score: number;
  issues: string[];
  improvedAnswer: string | null;
  needsHuman: boolean;
  skipped: boolean;
};

const NEUTRAL: Reflection = {
  clarity: 0.7,
  accuracy: 0.7,
  consistency: 0.7,
  tone: 0.7,
  score: 0.7,
  issues: [],
  improvedAnswer: null,
  needsHuman: false,
  skipped: true,
};

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback;
}

export async function reflectOnAnswer(params: {
  question: string;
  answer: string;
  evidence: string;
  language: string;
  history: Array<{ role: string; content: string }>;
}): Promise<{ reflection: Reflection; usage: Usage; model: string }> {
  if (!params.answer.trim()) {
    return { reflection: { ...NEUTRAL, score: 0, needsHuman: true, skipped: false }, usage: EMPTY_USAGE, model: "" };
  }

  const recent = params.history
    .slice(-6)
    .map((m) => `${m.role === "user" ? "Hóspede" : "IA"}: ${m.content}`)
    .join("\n");

  try {
    const { data, usage, model } = await chatJson<Partial<Reflection>>("validation", [
      { role: "system", content: PROMPTS.reflection.text },
      {
        role: "user",
        content:
          `Idioma esperado: ${params.language}\n` +
          `${recent ? `Histórico recente:\n${recent}\n\n` : ""}` +
          `Pergunta do hóspede:\n${params.question}\n\n` +
          `EVIDÊNCIAS:\n${params.evidence}\n\n` +
          `RESPOSTA PROPOSTA:\n${params.answer}`,
      },
    ]);

    if (!data) return { reflection: NEUTRAL, usage, model };

    const clarity = num(data.clarity, 0.7);
    const accuracy = num(data.accuracy, 0.7);
    const consistency = num(data.consistency, 0.7);
    const tone = num(data.tone, 0.7);
    const improved = typeof data.improvedAnswer === "string" ? data.improvedAnswer.trim() : "";

    return {
      reflection: {
        clarity,
        accuracy,
        consistency,
        tone,
        score: num(data.score, (clarity + accuracy + consistency + tone) / 4),
        issues: Array.isArray(data.issues) ? data.issues.slice(0, 8).map(String) : [],
        improvedAnswer: improved && improved !== params.answer.trim() ? improved : null,
        needsHuman: data.needsHuman === true,
        skipped: false,
      },
      usage,
      model,
    };
  } catch (err) {
    console.error("[ai] reflectOnAnswer falhou", err);
    return { reflection: NEUTRAL, usage: EMPTY_USAGE, model: "" };
  }
}
