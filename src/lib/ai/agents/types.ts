/**
 * Contratos da arquitetura multi-agente.
 *
 * Cada agente especialista é uma definição declarativa: prompt versionado,
 * ferramentas permitidas, nível de autonomia, thresholds de confiança e
 * regras de escalonamento. Nenhum agente pode ultrapassar sua whitelist.
 */
import type { ConfidenceThresholds } from "../confidence";
import type { PromptEntry } from "../prompts";
import type { MemoryKind } from "../memory/types";

export type AgentKey =
  | "reservation"
  | "maintenance"
  | "guest_experience"
  | "complaint_recovery"
  | "revenue"
  | "generalist";

/**
 * Autonomia:
 *  - low   : só informa; qualquer decisão vai para humano.
 *  - medium: resolve o documentado; exceções vão para humano.
 *  - high  : resolve sozinho dentro da especialidade.
 */
export type Autonomy = "low" | "medium" | "high";

export type AgentDefinition = {
  key: AgentKey;
  name: string;
  description: string;
  specialty: string;
  allowedTools: string[];
  autonomy: Autonomy;
  prompt: PromptEntry;
  thresholds: ConfidenceThresholds;
  /** Categorias de intenção que este agente costuma atender. */
  categories: string[];
  escalationRules: string[];
  memoryKinds: MemoryKind[];
  reasoningEffort: "low" | "medium" | "high";
  maxSteps: number;
};

/** Decisão do supervisor (roteamento). */
export type AgentRouting = {
  agent: AgentKey;
  reason: string;
  confidence: number;
  escalateUpfront: boolean;
  /** true quando a escolha veio de heurística e não do modelo. */
  fallback: boolean;
};
