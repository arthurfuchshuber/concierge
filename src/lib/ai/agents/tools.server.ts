/**
 * Ferramentas exclusivas dos agentes especialistas.
 * O registry decide quais delas cada agente pode enxergar.
 */
import type { AgentTool } from "../gateway.server";
import type { ToolContext } from "../tools.server";
import { recordOperationalRequest } from "../memory/operational.server";
import { askHumanSupervisor } from "../human-loop/escalations.server";
import { confidenceOf } from "../sources";
import type { AgentKey } from "./types";

function schema(properties: Record<string, unknown>, required: string[]) {
  return { type: "object", properties, required, additionalProperties: false };
}

export type AgentToolContext = ToolContext & {
  agent: AgentKey;
  guestKey?: string | null;
  /** Registrado quando o agente decide perguntar a um humano. */
  onEscalation: (info: { id: string | null; question: string }) => void;
};

export function buildAgentTools(ctx: AgentToolContext): AgentTool[] {
  const tools: AgentTool[] = [];

  tools.push({
    name: "search_property_history",
    description:
      "Consulta o histórico operacional REAL deste imóvel: chamados anteriores, como foram resolvidos, " +
      "tempo de resolução e recorrência. Use SEMPRE antes de responder sobre um problema.",
    parameters: schema(
      { assunto: { type: "string", description: "Ex.: 'ar-condicionado', 'chuveiro', 'wi-fi'." } },
      ["assunto"],
    ),
    execute: async (args) => {
      const term = String(args.assunto ?? "").slice(0, 120);
      const { data } = await ctx.supabase
        .from("ai_operational_memory")
        .select("category, request, resolution, resolution_minutes, recurrence_count, status, created_at, provider_name")
        .eq("property_id", ctx.propertyId)
        .ilike("request", `%${term}%`)
        .order("created_at", { ascending: false })
        .limit(8);

      const rows = (data ?? []) as Array<Record<string, unknown>>;
      if (rows.length) {
        ctx.collectSource({
          source: "operational_memory",
          title: `Histórico: ${term}`,
          confidence: confidenceOf("operational_memory"),
          content: rows
            .map((r) => `${r.request} → ${r.resolution ?? "sem solução registrada"} (${r.status})`)
            .join(" | "),
        });
      }
      return { encontrados: rows.length, historico: rows };
    },
  });

  tools.push({
    name: "create_maintenance_ticket",
    description:
      "Registra formalmente um chamado de manutenção/operação para a equipe do anfitrião. " +
      "Use quando houver problema real relatado. NÃO significa que alguém já foi acionado fisicamente.",
    parameters: schema(
      {
        categoria: { type: "string", description: "manutencao | limpeza | acesso | outro" },
        descricao: { type: "string", description: "Descrição objetiva do problema relatado." },
        urgencia: { type: "string", description: "low | normal | high" },
      },
      ["categoria", "descricao", "urgencia"],
    ),
    execute: async (args) => {
      const urgency = String(args.urgencia ?? "normal");
      const id = await recordOperationalRequest({
        supabase: ctx.supabase,
        ownerId: ctx.ownerId,
        propertyId: ctx.propertyId,
        conversationId: ctx.conversationId,
        guestKey: ctx.guestKey ?? null,
        guestName: ctx.guestName,
        category: String(args.categoria ?? "manutencao"),
        request: String(args.descricao ?? "").slice(0, 800),
        metadata: { agent: ctx.agent, urgency },
      });
      if (urgency === "high") {
        ctx.requestHandoff(`Chamado urgente registrado: ${String(args.descricao ?? "").slice(0, 200)}`, "high");
      }
      return { registrado: !!id, ticket_id: id, aviso: "Chamado registrado para a equipe. Nenhuma ação física foi executada pela IA." };
    },
  });

  tools.push({
    name: "check_service_availability",
    description:
      "Verifica se um serviço extra (late checkout, limpeza extra, traslado, passeio, upgrade) é realmente " +
      "oferecido pelo anfitrião. NUNCA ofereça nada sem esta verificação retornar disponivel=true.",
    parameters: schema(
      { servico: { type: "string", description: "Nome do serviço consultado." } },
      ["servico"],
    ),
    execute: async (args) => {
      const term = String(args.servico ?? "").slice(0, 120);
      const { data } = await ctx.supabase.rpc("search_ai_kb_chunks_text", {
        _query: term,
        _owner_id: ctx.ownerId,
        _property_id: ctx.propertyId,
        match_count: 5,
      });
      const rows = (data ?? []) as Array<Record<string, unknown>>;
      if (rows.length) {
        ctx.collectSource({
          source: "knowledge_base",
          title: `Serviço: ${term}`,
          confidence: confidenceOf("knowledge_base"),
          content: rows.map((r) => String(r.content ?? "")).join(" | ").slice(0, 1200),
        });
      }
      return {
        disponivel: rows.length > 0,
        evidencias: rows.map((r) => ({ titulo: r.title, conteudo: r.content })),
        regra: "Sem evidência oficial, o serviço não existe: não ofereça e não estime preço.",
      };
    },
  });

  tools.push({
    name: "ask_human_supervisor",
    description:
      "Pergunta a um humano da equipe quando você NÃO tem a informação, quando é exceção às regras, " +
      "decisão financeira, risco de segurança ou qualquer coisa fora da sua autonomia. " +
      "Use em vez de adivinhar. Depois disso, avise o hóspede que está confirmando com a equipe.",
    parameters: schema(
      {
        pergunta: { type: "string", description: "Pergunta objetiva e decidível para o humano." },
        motivo: { type: "string", description: "Por que você não pode decidir sozinho." },
        gatilho: {
          type: "string",
          description: "unknown_information | low_confidence | policy_exception | financial_decision | safety_risk | guest_request",
        },
      },
      ["pergunta", "motivo", "gatilho"],
    ),
    execute: async (args) => {
      const question = String(args.pergunta ?? "").slice(0, 1200);
      const trigger = String(args.gatilho ?? "unknown_information");
      const id = await askHumanSupervisor({
        supabase: ctx.supabase,
        ownerId: ctx.ownerId,
        propertyId: ctx.propertyId,
        conversationId: ctx.conversationId,
        guestKey: ctx.guestKey ?? null,
        guestName: ctx.guestName,
        agent: ctx.agent,
        trigger: trigger as never,
        reason: String(args.motivo ?? "").slice(0, 800),
        question,
        contextSnapshot: { agent: ctx.agent, property_id: ctx.propertyId },
      });
      ctx.onEscalation({ id, question });
      ctx.requestHandoff(`[${ctx.agent}] ${question}`, trigger === "safety_risk" ? "high" : "normal");
      return {
        registrado: !!id,
        instrucao:
          "Pergunta enviada à equipe. Responda ao hóspede com honestidade que está confirmando com o anfitrião. " +
          "NÃO invente a resposta e NÃO prometa prazo.",
      };
    },
  });

  return tools;
}
