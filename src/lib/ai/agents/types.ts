/**
 * Contratos da Multi-Agent Architecture do ConciergeIA.
 *
 * Cada agente especialista é uma configuração declarativa: prompt próprio,
 * ferramentas permitidas, nível de autonomia, limiares de confiança e regras
 * de escalonamento. Nenhum agente pode usar ferramenta fora da sua lista.
 */
import type { ConfidenceThresholds } from "../confidence";
import type { MemoryKind } from "../memory/types";
import type { PromptEntry } from "../prompts";

export type AgentKey =
  | "reservation"
  | "maintenance"
  | "guest_experience"
  | "complaint_recovery"
  | "revenue"
  | "generalist";

/**
 * Nível de autonomia:
 *  - low    → praticamente nada é decidido sozinho (promessas, dinheiro, contrato).
 *  - medium → resolve o operacional conhecido, escala exceções.
 *  - high   → responde sozinho enquanto houver fonte oficial.
 */
export type Autonomy = "low" | "medium" | "high";

export type AgentDefinition = {
  key: AgentKey;
  name: string;
  description: string;
  specialty: string;
  /** Ferramentas liberadas para este agente (whitelist rígida). */
  allowedTools: string[];
  autonomy: Autonomy;
  prompt: PromptEntry;
  /** Limiares próprios de confiança (auto | hedged | handoff). */
  thresholds: ConfidenceThresholds;
  /** Categorias de intenção normalmente atendidas por este agente. */
  categories: string[];
  /** Regras de escalonamento obrigatório, em linguagem natural (vão ao prompt). */
  escalationRules: string[];
  /** Tipos de memória que este agente pode propor ao Learning Loop. */
  memoryKinds: MemoryKind[];
  reasoningEffort: "low" | "medium" | "high";
  /** Passos máximos de tool calling. */
  maxSteps: number;
};

/** Decisão do Agent Orchestrator (supervisor). */
export type OrchestratorDecision = {
  agent: AgentKey;
  reason: string;
  confidence: number;
  /** Escalonamento já recomendado antes mesmo da execução. */
  escalateUpfront: boolean;
  /** true quando a seleção veio da heurística (modelo indisponível). */
  fallback: boolean;
};
