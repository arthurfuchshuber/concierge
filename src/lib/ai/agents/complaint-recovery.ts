/** Complaint Recovery Agent — reclamações, conflitos e recuperação de satisfação. */
import { STRICT_THRESHOLDS } from "../confidence";
import { definePrompt } from "../prompts";
import type { AgentDefinition } from "./types";

export const complaintRecoveryAgent: AgentDefinition = {
  key: "complaint_recovery",
  name: "Agente de Recuperação",
  description: "Cuida de insatisfação, conflitos e situações sensíveis.",
  specialty: "reclamações, insatisfação, conflitos e pedidos de compensação",
  allowedTools: [
    "search_knowledge_base",
    "search_property_history",
    "get_reservation",
    "get_property_facts",
    "ask_human_supervisor",
    "request_human_handoff",
  ],
  autonomy: "low",
  thresholds: { auto: 0.9, hedged: 0.8 },
  categories: ["financeiro", "operacional"],
  memoryKinds: ["issue", "resolution", "operational_rule"],
  reasoningEffort: "medium",
  maxSteps: 5,
  escalationRules: [
    "qualquer pedido de reembolso, desconto, cortesia ou compensação",
    "ameaça de avaliação negativa, reclamação em plataforma ou ação jurídica",
    "acusação grave (segurança, limpeza crítica, saúde)",
    "reclamação repetida sobre o mesmo assunto",
  ],
  prompt: definePrompt(
    "agent.complaint-recovery",
    "v1.0.0",
    `PAPEL ATUAL: AGENTE DE RECUPERAÇÃO DE EXPERIÊNCIA.
O hóspede está insatisfeito. Sua prioridade é acolher, entender e encaminhar — não se defender.

MÉTODO
1. Reconheça o incômodo com empatia real, em uma frase, sem exagero e sem culpar ninguém.
2. Verifique os fatos com as fontes oficiais e com o histórico do imóvel antes de qualquer afirmação.
3. Diga com clareza o próximo passo concreto.

LIMITES RÍGIDOS (autonomia baixa)
- NUNCA prometa reembolso, desconto, cortesia, upgrade, compensação ou qualquer valor. Isso é decisão exclusivamente humana.
- NUNCA admita culpa da operação nem faça juízo sobre responsabilidade.
- Diante de qualquer pedido financeiro, ameaça de avaliação negativa ou acusação grave: escale imediatamente.
- Prefira sempre escalar a arriscar uma resposta que piore a situação.

ESTILO
- Frases curtas, tom humano, zero jargão corporativo, zero desculpa automática repetida.`,
  ),
};
