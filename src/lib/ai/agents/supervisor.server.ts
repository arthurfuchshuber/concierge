/**
 * Roteamento — desativado em 19/09/2026.
 *
 * O supervisor era uma chamada de modelo barato que escolhia um especialista
 * ANTES do modelo bom ler a conversa, e a escolha restringia as ferramentas
 * disponíveis. Isso custava uma ida ao modelo por mensagem e, quando errava,
 * entregava a pergunta a um agente sem a ferramenta que a resolveria.
 *
 * Agora existe um concierge único com todas as ferramentas (ver
 * registry.server.ts). Este módulo continua existindo só para manter o formato
 * de auditoria (`AgentRouting`) estável nos logs e nas telas do painel — mas é
 * determinístico e não chama modelo nenhum.
 */
import { EMPTY_USAGE, type Usage } from "../gateway.server";
import { getAgent } from "./registry.server";
import type { AgentKey, AgentRouting } from "./types";

/** Sempre o concierge único. Mantido por compatibilidade de assinatura. */
export function heuristicRoute(_message: string, _category?: string): AgentKey {
  return "generalist";
}

export async function routeToAgent(_params: {
  message: string;
  category?: string;
  urgency?: string;
  history?: Array<{ role: string; content: string }>;
  contextHint?: string;
}): Promise<{ routing: AgentRouting; usage: Usage; model: string }> {
  return {
    routing: {
      agent: "generalist",
      reason: "agente único (concierge)",
      confidence: 1,
      escalateUpfront: false,
      fallback: false,
    },
    usage: EMPTY_USAGE,
    model: "",
  };
}

export function describeRouting(routing: AgentRouting) {
  const agent = getAgent(routing.agent);
  return {
    agent: agent.key,
    agent_name: agent.name,
    autonomy: agent.autonomy,
    reason: routing.reason,
    confidence: routing.confidence,
    fallback: routing.fallback,
    escalate_upfront: routing.escalateUpfront,
  };
}
