/**
 * Planner Agent — etapa anterior ao Tool Calling.
 *
 * Decide o plano mínimo de investigação: quais ferramentas realmente precisam
 * ser usadas, se podem rodar em paralelo e se o caso já nasce para humano.
 * Roda em modelo rápido e barato; falhas nunca bloqueiam o atendimento
 * (o agente principal continua com autonomia total de tool calling).
 */
import { EMPTY_USAGE, type Usage } from "./gateway.server";
import type { Intent } from "./intent.server";

export const KNOWN_TOOLS = [
  "search_knowledge_base",
  "get_property_facts",
  "get_reservation",
  "list_recommendations",
  "search_places",
  "get_weather",
  "request_human_handoff",
] as const;

export type PlannedTool = { name: string; reason: string; query?: string };

export type ExecutionPlan = {
  objective: string;
  tools: PlannedTool[];
  parallel: boolean;
  needsHuman: boolean;
  riskLevel: "low" | "normal" | "high";
  notes: string;
  /** true quando o plano veio de heurística (planner indisponível). */
  fallback: boolean;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function heuristicPlan(intent: Intent): ExecutionPlan {
  const tools: PlannedTool[] = [];
  const add = (name: string, reason: string, query?: string) => tools.push({ name, reason, query });

  switch (intent.category) {
    case "acesso":
    case "residencia":
      add("search_knowledge_base", "dúvida sobre a residência", intent.searchQuery);
      add("get_property_facts", "conferir dados oficiais do imóvel");
      break;
    case "reserva":
      add("get_reservation", "dados da reserva do hóspede");
      add("get_property_facts", "horários oficiais do imóvel");
      break;
    case "cidade":
    case "recomendacao":
      add("list_recommendations", "recomendações curadas");
      add("search_places", "complementar com lugares reais", intent.searchQuery);
      break;
    case "operacional":
      // O agente de manutenção documenta o próprio método como: histórico → base de
      // conhecimento → só então instruir ou escalar. O fallback pulava direto pro
      // humano, contrariando esse método sempre que o planner principal falhasse.
      add("search_knowledge_base", "verificar instrução documentada antes de escalar", intent.searchQuery);
      add("request_human_handoff", "possível problema operacional");
      break;
    case "social":
      break;
    default:
      add("search_knowledge_base", "verificar base oficial", intent.searchQuery);
  }

  return {
    objective: intent.intent || "atender o hóspede",
    tools,
    parallel: tools.length > 1,
    needsHuman: intent.needsHuman,
    riskLevel: intent.urgency,
    notes: "plano heurístico (planner indisponível)",
    fallback: true,
  };
}

/**
 * DESATIVADO em 19/09/2026 — não chama modelo.
 *
 * O planejador rodava em modelo barato e entregava ao concierge um roteiro de
 * ferramentas montado por quem pensa menos do que ele. Um modelo de raciocínio
 * planeja melhor sozinho. Mantido determinístico só para o restante do
 * pipeline (limiares de risco, auditoria) continuar recebendo o mesmo formato.
 */
export async function planExecution(params: {
  message: string;
  intent: Intent;
  history: Array<{ role: string; content: string }>;
  explorationMode?: boolean;
  contextHint?: string | null;
}): Promise<{ plan: ExecutionPlan; usage: Usage; model: string }> {
  return {
    plan: {
      objective: params.intent.intent || "atender o hóspede",
      tools: [],
      parallel: false,
      needsHuman: false,
      riskLevel: params.intent.urgency === "high" ? "high" : "normal",
      notes: "",
      fallback: false,
    },
    usage: EMPTY_USAGE,
    model: "",
  };
}

/** Renderiza o plano para o agente principal seguir (sem tirar sua autonomia). */
export function renderPlan(plan: ExecutionPlan): string {
  const signal = plan.needsHuman
    ? `\nSINAL DE ESCALONAMENTO: o planejador já identificou que este caso provavelmente exige um humano (risco=${plan.riskLevel}). Investigue e responda com o que puder, mas chame request_human_handoff antes de encerrar.`
    : "";
  if (!plan.tools.length) {
    return `Objetivo: ${plan.objective || "atender o hóspede"}\nNenhuma ferramenta prevista — resposta direta, sem inventar fatos.${signal}`;
  }
  const lines = plan.tools.map(
    (t, i) => `${i + 1}. ${t.name}${t.query ? ` (consulta: "${t.query}")` : ""} — ${t.reason}`,
  );
  return (
    `Objetivo: ${plan.objective}\n` +
    `Ferramentas previstas${plan.parallel ? " (acione-as na MESMA rodada — execução paralela)" : ""}:\n` +
    lines.join("\n") +
    (plan.notes ? `\nObservações: ${plan.notes}` : "") +
    `\nVocê pode acionar outras ferramentas se a investigação exigir.${signal}`
  );
}
