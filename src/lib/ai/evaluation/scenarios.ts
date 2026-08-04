/**
 * Test Scenario Library — biblioteca de cenários de avaliação por agente.
 *
 * Cada cenário declara o comportamento esperado (agente, ferramentas, fontes).
 * A engine compara a execução real contra estas expectativas.
 */
import type { AgentKey } from "../agents/types";

export type TestScenario = {
  name: string;
  suite: string;
  input: string;
  expectedAgent: AgentKey;
  expectedBehavior: string;
  expectedTools: string[];
  expectedSources: string[];
  /** Escalonamento humano é o resultado correto para este cenário. */
  expectHandoff?: boolean;
  language?: string;
};

export const TEST_SCENARIOS: TestScenario[] = [
  // ---------------- Reservation Agent ----------------
  {
    name: "checkin_horario",
    suite: "reservation",
    input: "Que horas posso fazer o check-in?",
    expectedAgent: "reservation",
    expectedBehavior: "Informa o horário oficial de check-in a partir da reserva/imóvel, sem inventar.",
    expectedTools: ["get_reservation", "get_property_facts"],
    expectedSources: ["reservation", "property", "guide"],
  },
  {
    name: "checkout_procedimento",
    suite: "reservation",
    input: "Como funciona o checkout? Preciso deixar as chaves em algum lugar?",
    expectedAgent: "reservation",
    expectedBehavior: "Descreve o procedimento de saída documentado pelo anfitrião.",
    expectedTools: ["search_knowledge_base", "get_property_facts"],
    expectedSources: ["checkout", "guide", "manual"],
  },
  {
    name: "alteracao_datas",
    suite: "reservation",
    input: "Consigo estender minha estadia por mais duas noites?",
    expectedAgent: "reservation",
    expectedBehavior: "Não altera reserva por conta própria; consulta disponibilidade e escala para humano.",
    expectedTools: ["get_reservation"],
    expectedSources: ["reservation"],
    expectHandoff: true,
  },
  {
    name: "cancelamento",
    suite: "reservation",
    input: "Preciso cancelar minha reserva, como faço para receber reembolso?",
    expectedAgent: "reservation",
    expectedBehavior: "Explica a política registrada e encaminha decisão financeira ao humano.",
    expectedTools: ["search_knowledge_base"],
    expectedSources: ["rules", "guide"],
    expectHandoff: true,
  },

  // ---------------- Maintenance Agent ----------------
  {
    name: "falha_equipamento",
    suite: "maintenance",
    input: "O ar-condicionado do quarto parou de gelar.",
    expectedAgent: "maintenance",
    expectedBehavior: "Não diagnostica remotamente; abre chamado e aciona humano.",
    expectedTools: ["create_maintenance_ticket", "request_human_handoff"],
    expectedSources: ["operational_memory", "property"],
    expectHandoff: true,
  },
  {
    name: "abertura_chamado",
    suite: "maintenance",
    input: "Tem um vazamento embaixo da pia da cozinha, está molhando o chão.",
    expectedAgent: "maintenance",
    expectedBehavior: "Trata como urgência operacional, registra chamado e escala imediatamente.",
    expectedTools: ["create_maintenance_ticket", "request_human_handoff"],
    expectedSources: ["operational_memory"],
    expectHandoff: true,
  },
  {
    name: "historico_problema",
    suite: "maintenance",
    input: "Esse chuveiro já tinha dado problema antes?",
    expectedAgent: "maintenance",
    expectedBehavior: "Consulta o histórico operacional do imóvel antes de responder.",
    expectedTools: ["search_property_history"],
    expectedSources: ["operational_memory"],
  },

  // ---------------- Guest Experience Agent ----------------
  {
    name: "recomendacao_restaurante",
    suite: "guest_experience",
    input: "Onde tem um bom restaurante de frutos do mar perto daqui?",
    expectedAgent: "guest_experience",
    expectedBehavior: "Recomenda a partir da curadoria do anfitrião e de lugares reais próximos.",
    expectedTools: ["list_recommendations", "search_places"],
    expectedSources: ["recommendation", "maps", "city_reference"],
  },
  {
    name: "experiencia_local",
    suite: "guest_experience",
    input: "O que dá para fazer com as crianças amanhã se chover?",
    expectedAgent: "guest_experience",
    expectedBehavior: "Cruza clima e recomendações; sugere alternativas cobertas.",
    expectedTools: ["get_weather", "list_recommendations"],
    expectedSources: ["weather", "recommendation"],
  },
  {
    name: "duvida_local",
    suite: "guest_experience",
    input: "A praia mais próxima dá para ir a pé?",
    expectedAgent: "guest_experience",
    expectedBehavior: "Usa distância real das recomendações, sem estimar de cabeça.",
    expectedTools: ["list_recommendations", "search_places"],
    expectedSources: ["recommendation", "maps"],
  },

  // ---------------- Complaint Recovery Agent ----------------
  {
    name: "reclamacao_limpeza",
    suite: "complaint_recovery",
    input: "Cheguei e o apartamento estava sujo. Isso é inaceitável.",
    expectedAgent: "complaint_recovery",
    expectedBehavior: "Acolhe, não promete compensação e escala para humano.",
    expectedTools: ["request_human_handoff"],
    expectedSources: ["operational_memory"],
    expectHandoff: true,
  },
  {
    name: "insatisfacao_geral",
    suite: "complaint_recovery",
    input: "Estou muito decepcionado com essa hospedagem.",
    expectedAgent: "complaint_recovery",
    expectedBehavior: "Reconhece a insatisfação, registra e aciona recuperação humana.",
    expectedTools: ["request_human_handoff"],
    expectedSources: ["operational_memory"],
    expectHandoff: true,
  },
  {
    name: "pedido_sensivel",
    suite: "complaint_recovery",
    input: "Quero um desconto por causa dos problemas que tive.",
    expectedAgent: "complaint_recovery",
    expectedBehavior: "Nunca decide valores; encaminha ao anfitrião.",
    expectedTools: ["request_human_handoff"],
    expectedSources: [],
    expectHandoff: true,
  },

  // ---------------- Revenue Agent ----------------
  {
    name: "upsell_late_checkout",
    suite: "revenue",
    input: "Tem como sair mais tarde no dia da saída?",
    expectedAgent: "revenue",
    expectedBehavior: "Verifica disponibilidade do serviço e condições registradas antes de oferecer.",
    expectedTools: ["check_service_availability", "get_reservation"],
    expectedSources: ["reservation", "rules"],
  },
  {
    name: "servico_extra",
    suite: "revenue",
    input: "Vocês oferecem limpeza extra durante a estadia?",
    expectedAgent: "revenue",
    expectedBehavior: "Só oferece serviço que existe no catálogo do anfitrião.",
    expectedTools: ["check_service_availability", "search_knowledge_base"],
    expectedSources: ["host_knowledge", "guide"],
  },
];

export function scenariosBySuite(suite?: string): TestScenario[] {
  if (!suite || suite === "all") return TEST_SCENARIOS;
  return TEST_SCENARIOS.filter((s) => s.suite === suite);
}
