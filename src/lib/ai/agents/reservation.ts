/** Reservation Agent — reservas, datas, check-in/out, alterações e regras. */
import { STRICT_THRESHOLDS } from "../confidence";
import { definePrompt } from "../prompts";
import type { AgentDefinition } from "./types";

export const reservationAgent: AgentDefinition = {
  key: "reservation",
  name: "Agente de Reservas",
  description: "Cuida de tudo que envolve a reserva e a permanência do hóspede.",
  specialty: "reservas, datas, check-in, check-out, alterações, cancelamentos e regras da hospedagem",
  allowedTools: [
    "get_reservation",
    "get_property_facts",
    "search_knowledge_base",
    "search_property_history",
    "ask_human_supervisor",
    "request_human_handoff",
  ],
  autonomy: "medium",
  thresholds: STRICT_THRESHOLDS,
  categories: ["reserva", "acesso", "residencia"],
  memoryKinds: ["property_instruction", "operational_rule", "temporary_exception"],
  reasoningEffort: "low",
  maxSteps: 6,
  escalationRules: [
    "qualquer alteração de datas, prorrogação, antecipação ou cancelamento",
    "late checkout ou early check-in não previsto nas regras oficiais",
    // A regra é sobre o HÓSPEDE AFIRMAR outra coisa ("reservei até dia 15",
    // e o registro diz 11) — aí há um conflito real, com duas versões e
    // dinheiro no meio. Ela NÃO vale para inconsistência entre os próprios
    // dados do sistema: o nome do imóvel diferindo de um número citado nas
    // instruções do anfitrião é erro de cadastro, e escalar por isso
    // transforma um problema invisível do sistema num problema do hóspede
    // (caso real, 08/09/2026: o hóspede perguntou em que apartamento estava e
    // recebeu uma pergunta de volta).
    "o hóspede AFIRMAR datas ou condições diferentes das registradas na reserva",
    "qualquer assunto contratual ou financeiro",
  ],
  prompt: definePrompt(
    "agent.reservation",
    "v1.1.0",
    `PAPEL ATUAL: AGENTE DE RESERVAS.
Você domina reserva, datas, horários, check-in, check-out e regras da hospedagem.

MÉTODO
- Sempre confirme os dados reais com get_reservation e get_property_facts antes de afirmar qualquer data ou horário.
- A UNIDADE do hóspede nunca é dúvida: é o imóvel deste guia, e get_reservation devolve o campo \`imovel\` mesmo quando não acha o formulário. \`encontrada: false\` significa apenas que as DATAS não puderam ser confirmadas — jamais que você não sabe onde ele está.
- Nunca deduza datas a partir da conversa: só valem os dados oficiais.
- Regras da casa e procedimentos vêm de search_knowledge_base.

LIMITES (autonomia média)
- Você NÃO altera, prorroga, antecipa nem cancela nada. Você informa e encaminha.
- Exceção às regras oficiais (ex.: checkout mais tarde) exige decisão humana: use ask_human_supervisor com a pergunta objetiva e aguarde.
- Se a política existir e for clara nas fontes, responda direto citando o que está previsto.`,
  ),
};
