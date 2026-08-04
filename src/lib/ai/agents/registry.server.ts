/**
 * Agent Registry — catálogo único dos agentes especialistas.
 *
 * Registra nome, especialidade, ferramentas permitidas, autonomia, versão de
 * prompt e regras de escalonamento. É a fonte de verdade da equipe digital:
 * nenhuma outra camada define capacidade de agente.
 */
import { DEFAULT_THRESHOLDS } from "../confidence";
import { definePrompt, stampEntries, type PromptVersionStamp } from "../prompts";
import { complaintRecoveryAgent } from "./complaint-recovery";
import { guestExperienceAgent } from "./guest-experience";
import { maintenanceAgent } from "./maintenance";
import { reservationAgent } from "./reservation";
import { revenueAgent } from "./revenue";
import type { AgentDefinition, AgentKey } from "./types";

/** Fallback: conversa social ou pedido que não pertence a nenhum especialista. */
export const generalistAgent: AgentDefinition = {
  key: "generalist",
  name: "Concierge Generalista",
  description: "Atende o que não pertence a nenhuma especialidade.",
  specialty: "conversa geral e triagem",
  allowedTools: [
    "search_knowledge_base",
    "get_property_facts",
    "get_reservation",
    "list_recommendations",
    "search_places",
    "get_weather",
    "request_human_handoff",
  ],
  autonomy: "medium",
  thresholds: DEFAULT_THRESHOLDS,
  categories: ["outro", "social"],
  memoryKinds: ["fact", "preference"],
  reasoningEffort: "low",
  maxSteps: 6,
  escalationRules: ["informação ausente nas fontes oficiais", "pedido explícito de humano"],
  prompt: definePrompt(
    "agent.generalist",
    "v1.0.0",
    `PAPEL ATUAL: CONCIERGE GENERALISTA.
Atenda com naturalidade, investigue nas fontes oficiais antes de afirmar qualquer coisa sobre a hospedagem
e encaminhe para o especialista humano sempre que o assunto exigir decisão.`,
  ),
};

export const AGENT_REGISTRY: Record<AgentKey, AgentDefinition> = {
  reservation: reservationAgent,
  maintenance: maintenanceAgent,
  guest_experience: guestExperienceAgent,
  complaint_recovery: complaintRecoveryAgent,
  revenue: revenueAgent,
  generalist: generalistAgent,
};

export const AGENT_KEYS = Object.keys(AGENT_REGISTRY) as AgentKey[];

export function getAgent(key: string | null | undefined): AgentDefinition {
  return AGENT_REGISTRY[(key ?? "") as AgentKey] ?? generalistAgent;
}

/** Filtra o catálogo global de ferramentas pela whitelist do agente. */
export function allowedToolsOf<T extends { name: string }>(agent: AgentDefinition, tools: T[]): T[] {
  return tools.filter((t) => agent.allowedTools.includes(t.name));
}

/** Bloco de regras do agente injetado no prompt final. */
export function renderAgentBriefing(agent: AgentDefinition): string {
  return (
    `${agent.prompt.text}\n\n` +
    `AUTONOMIA: ${agent.autonomy}\n` +
    `FERRAMENTAS LIBERADAS PARA VOCÊ: ${agent.allowedTools.join(", ")}\n` +
    `ESCALONAMENTO OBRIGATÓRIO NESTE PAPEL:\n` +
    agent.escalationRules.map((r) => `- ${r}`).join("\n")
  );
}

/** Carimbo de versão dos prompts do agente ativo (auditoria). */
export function stampAgentPrompt(agent: AgentDefinition): PromptVersionStamp {
  return stampEntries([agent.prompt]);
}

/** Resumo do registry para auditoria/observabilidade. */
export function registrySnapshot() {
  return AGENT_KEYS.map((key) => {
    const a = AGENT_REGISTRY[key];
    return {
      agent: a.key,
      autonomy: a.autonomy,
      allowed_tools: a.allowedTools,
      prompt_version: a.prompt.version,
    };
  });
}
