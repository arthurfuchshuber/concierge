/**
 * Continuous Learning Loop — contratos.
 *
 * Cada conversa encerrada percorre:
 *   Analyzer → Knowledge Extraction → Validation → Learning Candidate →
 *   Approval → Memory Update → Agent Metrics → Impact Measurement.
 *
 * NADA entra na memória de longo prazo sem aprovação humana explícita.
 */

/** Resultado da análise de uma conversa encerrada. */
export type ConversationOutcome = "SUCCESS" | "PARTIAL" | "FAILURE" | "LEARNING_OPPORTUNITY";

export type ConversationAnalysis = {
  conversationId: string;
  tenantId: string;
  ownerId: string;
  propertyId: string | null;
  outcome: ConversationOutcome;
  /** 0..1 — qualidade percebida da resolução. */
  qualityScore: number;
  mainIntent: string | null;
  agent: string | null;
  toolsUsed: string[];
  sourcesUsed: string[];
  avgConfidence: number | null;
  humanIntervened: boolean;
  escalations: number;
  satisfaction: "positive" | "neutral" | "negative" | null;
  /** Frases sem resposta / lacunas percebidas. */
  unansweredTopics: string[];
  reasoning: string;
  messageCount: number;
};

/** Tipos de aprendizado suportados pelo loop. */
export type LearningType =
  | "property_rule"
  | "company_rule"
  | "global_rule"
  | "agent_behavior"
  | "prompt_improvement"
  | "tool_improvement"
  | "knowledge_gap";

export const LEARNING_TYPES: LearningType[] = [
  "property_rule",
  "company_rule",
  "global_rule",
  "agent_behavior",
  "prompt_improvement",
  "tool_improvement",
  "knowledge_gap",
];

/** Escopo sugerido para o conhecimento extraído. */
export type SuggestedScope =
  | "reservation"
  | "property"
  | "owner_portfolio"
  | "company_global"
  | "temporary_exception";

export const SUGGESTED_SCOPES: SuggestedScope[] = [
  "reservation",
  "property",
  "owner_portfolio",
  "company_global",
  "temporary_exception",
];

export type LearningCandidateDraft = {
  learningType: LearningType;
  title: string | null;
  extractedInformation: string;
  category: string | null;
  memoryKind: string;
  suggestedScope: SuggestedScope;
  confidence: number;
  ttlDays: number | null;
  rationale: string | null;
  /** Evidência bruta (trecho da conversa) — nunca com dado sensível. */
  evidence?: string | null;
};

/** Veredito do Knowledge Validation Agent. */
export type ValidationVerdict = {
  approved: boolean;
  /** Escopo corrigido pelo validador (pode rebaixar de global para exceção). */
  scope: SuggestedScope;
  memoryKind: string;
  confidence: number;
  ttlDays: number | null;
  risk: "low" | "medium" | "high";
  conflicts: string[];
  reasons: string[];
};

export type LearningStatus = "pending" | "approved" | "rejected" | "applied";
