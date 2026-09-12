/**
 * Supervisor Agent — decide qual especialista assume a solicitação.
 * Nunca fala com o hóspede: apenas roteia.
 */
import { chatJson, EMPTY_USAGE, type Usage } from "../gateway.server";
import { PROMPTS } from "../prompts";
import { AGENT_KEYS, getAgent } from "./registry.server";
import type { AgentKey, AgentRouting } from "./types";

const COMPLAINT = /(reclama|insatisf|absurd|péssim|pessim|horr[íi]vel|inaceit|decep|revolt|processo|procon|nota 1|avalia[çc][ãa]o negativa|reembols|desconto|indeniza)/i;
const MAINTENANCE = /(quebr|n[ãa]o funciona|nao funciona|vazamento|entupi|sem [áa]gua|sem luz|sem energia|falta de|ar.?condicionado|chuveiro|geladeira|wi-?fi n[ãa]o|internet caiu|barulho|fechadura|port[ãa]o|manuten)/i;
const RESERVATION = /(reserva|check.?in|check.?out|entrada|sa[íi]da|prorrog|estender|antecipar|cancel|c[óo]digo da reserva|hor[áa]rio de|quantas noites)/i;
const REVENUE = /(contratar|servi[çc]o extra|upgrade|late ?check|early ?check|passeio pago|traslado|transfer|limpeza extra|quanto custa|valor de)/i;

/** Heurística determinística — rede de segurança quando o modelo falha. */
export function heuristicRoute(message: string, category?: string): AgentKey {
  const text = message ?? "";
  if (COMPLAINT.test(text)) return "complaint_recovery";
  if (MAINTENANCE.test(text)) return "maintenance";
  if (REVENUE.test(text)) return "revenue";
  if (RESERVATION.test(text)) return "reservation";
  if (category === "operacional") return "maintenance";
  if (category === "reserva" || category === "acesso") return "reservation";
  if (category === "cidade" || category === "recomendacao") return "guest_experience";
  if (category === "financeiro") return "revenue";
  return "generalist";
}

export async function routeToAgent(params: {
  message: string;
  category?: string;
  urgency?: string;
  history?: Array<{ role: string; content: string }>;
  contextHint?: string;
}): Promise<{ routing: AgentRouting; usage: Usage; model: string }> {
  const fallbackKey = heuristicRoute(params.message, params.category);
  const fallback: AgentRouting = {
    agent: fallbackKey,
    reason: "roteamento heurístico",
    confidence: 0.5,
    escalateUpfront: false,
    fallback: true,
  };

  try {
    const recent = (params.history ?? [])
      .slice(-4)
      .map((m) => `${m.role === "user" ? "Hóspede" : "IA"}: ${m.content}`)
      .join("\n");

    const { data, usage, model } = await chatJson<Partial<AgentRouting>>("intent", [
      { role: "system", content: PROMPTS.supervisor.text },
      {
        role: "user",
        content:
          `${recent ? `Contexto recente:\n${recent}\n\n` : ""}` +
          `Categoria detectada: ${params.category ?? "desconhecida"} | urgência: ${params.urgency ?? "normal"}\n` +
          `${params.contextHint ? `Contexto interno:\n${params.contextHint.slice(0, 1200)}\n\n` : ""}` +
          `Mensagem: ${params.message}`,
      },
    ]);

    if (!data?.agent || !AGENT_KEYS.includes(data.agent as AgentKey)) {
      return { routing: fallback, usage, model };
    }

    let agent = data.agent as AgentKey;
    // Guarda-corpo: insatisfação explícita sempre vai para recuperação.
    if (COMPLAINT.test(params.message ?? "")) agent = "complaint_recovery";

    return {
      routing: {
        agent,
        reason: String(data.reason ?? "").slice(0, 240) || "roteado pelo supervisor",
        confidence: Math.max(0, Math.min(1, Number(data.confidence ?? 0.7))),
        escalateUpfront: Boolean(data.escalateUpfront),
        fallback: false,
      },
      usage,
      model,
    };
  } catch (err) {
    console.error("[supervisor] roteamento falhou", err);
    return { routing: fallback, usage: EMPTY_USAGE, model: "" };
  }
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
