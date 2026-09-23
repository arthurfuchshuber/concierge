/**
 * Agent Registry — UM ÚNICO concierge (19/09/2026).
 *
 * POR QUE ISTO DEIXOU DE SER UM CATÁLOGO DE ESPECIALISTAS
 *
 * Havia seis agentes (Reserva, Manutenção, Experiência, Recuperação, Receita e
 * Generalista) e, antes deles, três camadas baratas decidindo no lugar do
 * modelo bom: classificador de intenção, supervisor e planejador. O efeito
 * medido não foi especialização, foi burrice:
 *
 *  · cada especialista só enxergava uma lista curta de ferramentas, então toda
 *    pergunta mal roteada chegava ao modelo já sem a ferramenta que resolveria;
 *  · o especialista de Reserva pensava em esforço "low" — respondia de
 *    bate-pronto por decreto do papel, não da pergunta;
 *  · o roteador rotulava a mensagem antes do modelo ler a conversa, e um
 *    "Ola, boa tarde" virou "pós-estadia" com pedido de avaliação.
 *
 * O assistente interno do painel nunca teve nada disso — recebe a pergunta, tem
 * todas as ferramentas na mão, pensa e responde — e é justamente o que ficou
 * bom. Agora o concierge do hóspede funciona igual.
 *
 * O que era regra boa dos especialistas (tom de recuperação em reclamação,
 * método de manutenção, disciplina de não ofertar serviço sem evidência) virou
 * INSTRUÇÃO no prompt abaixo, não gaiola de ferramenta.
 */
import { DEFAULT_THRESHOLDS } from "../confidence";
import { definePrompt, stampEntries, type PromptVersionStamp } from "../prompts";
import type { AgentDefinition, AgentKey } from "./types";

/** Catálogo completo: o concierge enxerga TODAS as ferramentas. */
export const ALL_TOOLS = [
  "search_knowledge_base",
  "get_property_facts",
  "get_reservation",
  "list_recommendations",
  "search_places",
  "search_web",
  "get_weather",
  "get_city_news",
  "get_itinerary",
  "add_itinerary_item",
  "remove_itinerary_item",
  "set_reservation_mode",
  "check_availability",
  "find_available_stays",
  "search_property_history",
  "create_maintenance_ticket",
  "check_service_availability",
  "ask_human_supervisor",
  "request_human_handoff",
];

/** O concierge — agente único do atendimento ao hóspede. */
export const conciergeAgent: AgentDefinition = {
  key: "generalist",
  name: "Concierge",
  description: "Agente único de atendimento ao hóspede, com autonomia total de investigação.",
  specialty: "hospedagem por temporada, de ponta a ponta",
  allowedTools: ALL_TOOLS,
  autonomy: "high",
  thresholds: DEFAULT_THRESHOLDS,
  categories: [
    "acesso",
    "residencia",
    "reserva",
    "cidade",
    "recomendacao",
    "operacional",
    "financeiro",
    "social",
    "outro",
  ],
  memoryKinds: ["fact", "preference"],
  reasoningEffort: "max",
  maxSteps: 12,
  escalationRules: [
    "pedido explícito de falar com um humano",
    "emergência, risco à segurança ou incidente de acesso",
    "decisão que envolve dinheiro, reembolso, desconto ou alteração contratual da reserva",
    "informação que não existe em nenhuma fonte oficial consultada",
  ],
  prompt: definePrompt(
    "agent.concierge",
    "v2.1.0",
    `PAPEL: CONCIERGE DESTA HOSPEDAGEM. Você é um só — não existe "encaminhar para outro agente".

COMO PENSAR ANTES DE FALAR
1. Leia a conversa inteira e entenda o que ESTA mensagem pede, agora. Nunca deduza um
   acontecimento, um elogio ou uma reclamação que o hóspede não escreveu.
2. Investigue com as ferramentas ANTES de afirmar qualquer coisa sobre o imóvel, a reserva,
   horários, preços, serviços ou a cidade. Pode acionar várias na mesma rodada.
3. Só responda o que estiver sustentado por fonte oficial, ferramenta ou pela própria conversa.
   Sem evidência, diga com honestidade que vai confirmar — nunca preencha com suposição.

ENTENDER ANTES DE SUGERIR (obrigatório)
· Pedido aberto ou de gosto pessoal (onde comer, o que fazer, passeio, bar, roteiro, compras,
  transporte): NÃO despeje sugestões de cara. Faça 1 ou 2 perguntas curtas e objetivas para
  entender o que a pessoa quer — por exemplo tipo de comida/experiência, se é a pé ou de carro,
  quantas pessoas, faixa de preço, horário/dia. Perguntas curtas, numa frase, sem questionário.
· Só depois da resposta, sugira — e sugira poucas opções (2 a 3), já filtradas pelo que ela disse.
· Se ela já disse o que quer na própria mensagem ("restaurante japonês a pé hoje à noite"),
  não pergunte de novo: responda direto.
· Pergunta objetiva de fato (wi-fi, horário de check-out, endereço, senha): nunca faça pergunta
  de volta — responda na hora.

CONDUTA POR SITUAÇÃO (mesmo agente, tom diferente)
· Reclamação ou insatisfação: acolha primeiro, sem justificar; registre o problema; nunca
  prometa reembolso, desconto ou indenização — isso é decisão humana.
· Problema no imóvel: consulte o histórico operacional e a base antes de instruir; registre o
  chamado; deixe claro que o registro não é o conserto.
· Reserva, datas e acesso: confira sempre nos dados reais da reserva; nunca improvise horário,
  endereço, senha ou código.
· Serviço extra: só existe se a verificação confirmar. Sem confirmação, não ofereça nem estime preço.
· Cidade e recomendações: só cite lugares vindos das ferramentas, com o que elas retornaram.
· Conversa social: seja breve e natural. Saudação é saudação — não é gancho para oferta,
  pedido de avaliação ou instrução de check-out.

AUTONOMIA: resolva o que estiver documentado. Chamar um humano é sobre quem DECIDE, não sobre
quem fala: você continua respondendo o que já apurou.`,
  ),
};

/** Mantido para compatibilidade com quem importava o generalista. */
export const generalistAgent = conciergeAgent;

export const AGENT_REGISTRY: Record<string, AgentDefinition> = {
  generalist: conciergeAgent,
};

export const AGENT_KEYS = Object.keys(AGENT_REGISTRY) as AgentKey[];

export function getAgent(_key?: string | null): AgentDefinition {
  return conciergeAgent;
}

/** Filtra o catálogo global de ferramentas pela whitelist do agente. */
export function allowedToolsOf<T extends { name: string }>(
  agent: AgentDefinition,
  tools: T[],
): T[] {
  return tools.filter((t) => agent.allowedTools.includes(t.name));
}

/** Bloco de regras do agente injetado no prompt final. */
export function renderAgentBriefing(agent: AgentDefinition): string {
  return (
    `${agent.prompt.text}\n\n` +
    `FERRAMENTAS LIBERADAS PARA VOCÊ: ${agent.allowedTools.join(", ")}\n` +
    `ESCALONAMENTO OBRIGATÓRIO:\n` +
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
