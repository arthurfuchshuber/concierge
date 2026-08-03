/**
 * Planner Agent — etapa anterior ao Tool Calling.
 *
 * Decide o plano mínimo de investigação: quais ferramentas realmente precisam
 * ser usadas, se podem rodar em paralelo e se o caso já nasce para humano.
 * Roda em modelo rápido e barato; falhas nunca bloqueiam o atendimento
 * (o agente principal continua com autonomia total de tool calling).
 */
import { chatJson, EMPTY_USAGE, type Usage } from "./gateway.server";
import { PROMPTS } from "./prompts";
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

export async function planExecution(params: {
  message: string;
  intent: Intent;
  history: Array<{ role: string; content: string }>;
  explorationMode?: boolean;
}): Promise<{ plan: ExecutionPlan; usage: Usage; model: string }> {
  const recent = params.history
    .slice(-4)
    .map((m) => `${m.role === "user" ? "Hóspede" : "IA"}: ${m.content}`)
    .join("\n");

  try {
    const { data, usage, model } = await chatJson<Partial<ExecutionPlan>>("intent", [
      { role: "system", content: PROMPTS.planner.text },
      {
        role: "user",
        content:
          `${params.explorationMode ? "Modo exploração ativo (conversa sobre a cidade).\n" : ""}` +
          `Intenção detectada: ${params.intent.intent} (categoria=${params.intent.category}, ` +
          `urgência=${params.intent.urgency}, idioma=${params.intent.language})\n` +
          `${recent ? `Contexto recente:\n${recent}\n` : ""}` +
          `Mensagem do hóspede:\n${params.message}`,
      },
    ]);

    if (!data) return { plan: heuristicPlan(params.intent), usage, model };

    const rawTools = Array.isArray(data.tools) ? (data.tools as PlannedTool[]) : [];
    const tools = rawTools
      .map((t) => ({
        name: String(t?.name ?? ""),
        reason: String(t?.reason ?? ""),
        query: t?.query ? String(t.query) : undefined,
      }))
      .filter((t) => (KNOWN_TOOLS as readonly string[]).includes(t.name))
      .slice(0, 6);

    return {
      plan: {
        objective: String(data.objective ?? params.intent.intent ?? ""),
        tools,
        parallel: data.parallel !== false && tools.length > 1,
        needsHuman: data.needsHuman === true || params.intent.needsHuman,
        riskLevel: data.riskLevel === "high" || data.riskLevel === "low" ? data.riskLevel : "normal",
        notes: String(data.notes ?? ""),
        fallback: false,
      },
      usage,
      model,
    };
  } catch (err) {
    console.error("[ai] planExecution falhou", err);
    return { plan: heuristicPlan(params.intent), usage: EMPTY_USAGE, model: "" };
  }
}

/** Renderiza o plano para o agente principal seguir (sem tirar sua autonomia). */
export function renderPlan(plan: ExecutionPlan): string {
  if (!plan.tools.length) {
    return `Objetivo: ${plan.objective || "atender o hóspede"}\nNenhuma ferramenta prevista — resposta direta, sem inventar fatos.`;
  }
  const lines = plan.tools.map(
    (t, i) => `${i + 1}. ${t.name}${t.query ? ` (consulta: "${t.query}")` : ""} — ${t.reason}`,
  );
  return (
    `Objetivo: ${plan.objective}\n` +
    `Ferramentas previstas${plan.parallel ? " (acione-as na MESMA rodada — execução paralela)" : ""}:\n` +
    lines.join("\n") +
    (plan.notes ? `\nObservações: ${plan.notes}` : "") +
    `\nVocê pode acionar outras ferramentas se a investigação exigir.`
  );
}
