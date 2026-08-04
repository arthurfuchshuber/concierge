/**
 * Política de gravação de memória.
 *
 * Nem toda mensagem vira memória. Uma classificação decide o que merece
 * persistir:
 *
 *  SIM: preferência explícita do hóspede, problema operacional, solução
 *       aplicada, informação relevante do imóvel, decisão operacional.
 *  NÃO: conversa casual, dúvida pontual sem valor futuro, informação efêmera,
 *       dado sensível desnecessário (documento, cartão, senha, endereço
 *       completo de terceiros).
 *
 * A classificação usa um modelo rápido, com heurística de segurança por cima:
 * nada sensível é gravado, mesmo que o modelo sugira.
 */
import { chatJson, EMPTY_USAGE, type Usage } from "../gateway.server";
import type { MemoryCandidate, MemoryKind, MemoryScope } from "./types";

const ALLOWED_KINDS: MemoryKind[] = [
  "preference",
  "issue",
  "resolution",
  "property_fact",
  "operational_decision",
  "fact",
  "operational_rule",
  "property_instruction",
  "provider_knowledge",
  "guest_preference",
  "company_policy",
  "temporary_exception",
];

const ALLOWED_SCOPES: MemoryScope[] = ["guest", "property", "owner", "provider", "team", "global"];

/** Padrões de dados sensíveis que nunca podem virar memória. */
const SENSITIVE_PATTERNS: RegExp[] = [
  /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/, // CPF
  /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/, // CNPJ
  /\b(?:\d[ -]?){13,19}\b/, // cartão
  /\b(senha|password|pin|c[óo]digo de acesso|token|cvv)\b/i,
  /\b[A-Z]{2}\d{6,9}\b/, // passaporte
  /\b\d{5}-?\d{3}\b/, // CEP
];

export function containsSensitive(text: string): boolean {
  return SENSITIVE_PATTERNS.some((re) => re.test(text));
}

const CASUAL = /^(oi|ol[áa]|bom dia|boa tarde|boa noite|obrigad[oa]|valeu|ok|tudo bem|hi|hello|thanks|thank you)\b/i;

/** Filtro barato antes de gastar modelo: conversa social não gera memória. */
export function worthEvaluating(message: string, category?: string | null): boolean {
  const text = message.trim();
  if (text.length < 12) return false;
  if (CASUAL.test(text) && text.length < 40) return false;
  if (category === "social") return false;
  return true;
}

function sanitize(candidate: Record<string, unknown>): MemoryCandidate | null {
  const content = String(candidate.content ?? "").trim();
  if (content.length < 10 || content.length > 1200) return null;
  if (containsSensitive(content)) return null;

  const kind = ALLOWED_KINDS.includes(candidate.kind as MemoryKind) ? (candidate.kind as MemoryKind) : "fact";
  const scope = ALLOWED_SCOPES.includes(candidate.scope as MemoryScope)
    ? (candidate.scope as MemoryScope)
    : "guest";

  const importance = Number(candidate.importance);
  const confidence = Number(candidate.confidence);

  return {
    scope,
    kind,
    category: (candidate.category as string) ?? null,
    title: candidate.title ? String(candidate.title).slice(0, 160) : null,
    content,
    importance: Number.isFinite(importance) ? Math.min(1, Math.max(0, importance)) : 0.5,
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.7,
    source: "conversation",
    ttlDays: candidate.ttlDays == null ? null : Number(candidate.ttlDays) || null,
  };
}

/**
 * Extrai candidatas a memória de uma interação. Nunca lança — em caso de
 * falha, simplesmente não grava nada.
 */
export async function classifyForMemory(params: {
  message: string;
  answer: string;
  category?: string | null;
  intent?: string | null;
  language?: string;
}): Promise<{ candidates: MemoryCandidate[]; usage: Usage; model: string | null }> {
  if (!worthEvaluating(params.message, params.category)) {
    return { candidates: [], usage: EMPTY_USAGE, model: null };
  }

  try {
    const { data, usage, model } = await chatJson<{ memories?: Array<Record<string, unknown>> }>("memory", [
      {
        role: "system",
        content:
          "Você é o CURADOR DE MEMÓRIA de um agente de hospedagem. Analise a interação e extraia SOMENTE o que " +
          "terá utilidade futura real.\n" +
          "GRAVAR: preferência explícita do hóspede; problema operacional relatado; solução aplicada; " +
          "informação relevante e durável sobre o imóvel; decisão operacional tomada.\n" +
          "NÃO GRAVAR: conversa casual, agradecimento, dúvida pontual já respondida, informação efêmera " +
          "(clima, horário de hoje), qualquer dado sensível (documento, cartão, senha, código de acesso).\n" +
          "Prefira zero memórias a memórias inúteis. Máximo 3. Escreva cada memória como um fato objetivo, " +
          "curto e autoexplicativo, em português, sem citar a conversa.\n" +
          'Responda APENAS JSON: {"memories":[{"scope":"guest|property","kind":"preference|issue|resolution|property_fact|operational_decision|fact","category":"manutencao|limpeza|acesso|reserva|cidade|financeiro|outro","title":"...","content":"...","importance":0..1,"confidence":0..1}]}',
      },
      {
        role: "user",
        content:
          `Intenção: ${params.intent ?? "-"} | Categoria: ${params.category ?? "-"}\n` +
          `Hóspede: ${params.message}\n` +
          `Agente: ${params.answer}`,
      },
    ]);

    const raw = Array.isArray(data?.memories) ? data!.memories! : [];
    const candidates = raw
      .map((c) => sanitize(c))
      .filter((c): c is MemoryCandidate => !!c)
      .slice(0, 3);

    return { candidates, usage, model };
  } catch (err) {
    console.error("[memory-policy] classificação falhou", err);
    return { candidates: [], usage: EMPTY_USAGE, model: null };
  }
}
