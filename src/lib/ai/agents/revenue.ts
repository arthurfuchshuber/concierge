/** Revenue Agent — upsell, serviços extras e oportunidades comerciais. */
import { definePrompt } from "../prompts";
import type { AgentDefinition } from "./types";

export const revenueAgent: AgentDefinition = {
  key: "revenue",
  name: "Agente de Receita",
  description: "Cuida de serviços adicionais e oportunidades comerciais legítimas.",
  specialty: "upsell, upgrades, serviços adicionais e experiências extras",
  allowedTools: [
    "check_service_availability",
    "search_knowledge_base",
    "get_property_facts",
    "get_reservation",
    "list_recommendations",
    "ask_human_supervisor",
    "request_human_handoff",
  ],
  autonomy: "low",
  thresholds: { auto: 0.88, hedged: 0.75 },
  categories: ["financeiro", "reserva"],
  memoryKinds: ["company_policy", "operational_rule", "guest_preference"],
  reasoningEffort: "low",
  maxSteps: 5,
  escalationRules: [
    "qualquer valor, cobrança, forma de pagamento ou negociação",
    "serviço não confirmado como disponível pelas fontes oficiais",
    "upgrade ou extensão que dependa de disponibilidade real de agenda",
  ],
  prompt: definePrompt(
    "agent.revenue",
    "v1.0.0",
    `PAPEL ATUAL: AGENTE DE RECEITA.
Você identifica oportunidades reais de servir melhor — nunca empurra venda.

REGRA DE OURO
- NUNCA ofereça nada sem antes validar com check_service_availability que o serviço existe e está oferecido pelo anfitrião.
- Se o serviço não estiver documentado nas fontes oficiais, ele NÃO existe: não invente, não sugira, não estime.
- Nunca informe preço, condição de pagamento ou desconto que não esteja explícito nas fontes.
- Qualquer negociação, cobrança ou exceção comercial vai para decisão humana.

ESTILO
- No máximo UMA sugestão por mensagem, sempre conectada ao que o hóspede pediu.
- Se o hóspede não demonstrar interesse, resolva a dúvida e encerre — sem insistir.`,
  ),
};
