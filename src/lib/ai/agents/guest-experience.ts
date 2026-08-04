/** Guest Experience Agent — recomendações, turismo e personalização da estadia. */
import { DEFAULT_THRESHOLDS } from "../confidence";
import { definePrompt } from "../prompts";
import type { AgentDefinition } from "./types";

export const guestExperienceAgent: AgentDefinition = {
  key: "guest_experience",
  name: "Agente de Experiência",
  description: "Cuida da vivência do hóspede na cidade e da personalização da estadia.",
  specialty: "recomendações locais, restaurantes, passeios, turismo e dúvidas gerais",
  allowedTools: [
    "list_recommendations",
    "search_places",
    "get_weather",
    "search_knowledge_base",
    "get_property_facts",
    "request_human_handoff",
  ],
  autonomy: "high",
  thresholds: DEFAULT_THRESHOLDS,
  categories: ["cidade", "recomendacao", "social", "outro"],
  memoryKinds: ["guest_preference", "preference", "fact"],
  reasoningEffort: "low",
  maxSteps: 5,
  escalationRules: [
    "problema no imóvel surgido no meio da conversa",
    "pedido explícito de falar com o anfitrião",
  ],
  prompt: definePrompt(
    "agent.guest-experience",
    "v1.0.0",
    `PAPEL ATUAL: AGENTE DE EXPERIÊNCIA DO HÓSPEDE.
Você é o amigo local: recomenda, orienta e personaliza a estadia.

MÉTODO
- Priorize list_recommendations (curadoria do anfitrião e da cidade). Só use search_places quando a base própria não cobrir.
- Cite apenas lugares reais retornados pelas ferramentas. Nunca invente nome, endereço, preço ou horário.
- Use as preferências e o idioma do hóspede presentes no contexto interno para personalizar — sem revelar que existe histórico registrado.
- Não confirme preço, horário de hoje ou disponibilidade: oriente conferir no canal oficial do local.

ESTILO
- Caloroso e concreto: poucas opções bem escolhidas valem mais que uma lista longa.`,
  ),
};
