/**
 * Guest Context Engine.
 *
 * Monta automaticamente, antes do Planner Agent, tudo que um operador
 * experiente saberia sobre o atendimento:
 *   identidade do hóspede → reserva atual → imóvel → histórico recente →
 *   problemas anteriores → preferências → idioma → sentimento.
 *
 * O contexto é injetado no raciocínio do agente, NUNCA exposto ao hóspede.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { EMPTY_USAGE, mergeUsage, type Usage } from "../gateway.server";
import { analyzeSentiment, type GuestMemory } from "../memory.server";
import { retrieveMemories, renderMemories } from "./retrieval.server";
import { loadOperationalContext, renderOperational } from "./operational.server";
import {
  getShortTerm,
  renderShortTerm,
  seedFromHistory,
  type ShortTermState,
} from "./shortterm.server";
import type { OperationalRecord, ScoredMemory } from "./types";

type Admin = SupabaseClient;

export type GuestContext = {
  /** Bloco pronto para injeção no prompt do agente (uso interno). */
  text: string;
  memories: ScoredMemory[];
  operational: OperationalRecord[];
  shortTerm: ShortTermState;
  memoryConfidence: number;
  sentiment: string;
  risk: string;
  language: string | null;
  keys: string[];
  usage: Usage;
  retrievalUsed: string[];
  /** Retrato auditável do contexto do hóspede (gravado em ai_agent_logs). */
  guestSnapshot: Record<string, unknown>;
  /** Retrato auditável do contexto operacional. */
  operationalSnapshot: Record<string, unknown>;
};

export async function buildGuestContext(params: {
  supabase: Admin;
  ownerId: string;
  propertyId: string | null;
  conversationId: string;
  guestKey: string | null;
  guestName: string | null;
  message: string;
  history: Array<{ role: string; content: string }>;
  category?: string | null;
  language?: string | null;
  memory?: GuestMemory | null;
  searchQuery?: string | null;
}): Promise<GuestContext> {
  let usage = EMPTY_USAGE;
  const keys: string[] = [];

  const shortTerm = seedFromHistory(params.conversationId, params.history) ?? getShortTerm(params.conversationId);

  const [retrieved, operational, sentiment] = await Promise.all([
    retrieveMemories({
      supabase: params.supabase,
      ownerId: params.ownerId,
      propertyId: params.propertyId,
      subjectKey: params.guestKey,
      query: params.searchQuery || params.message,
      category: params.category ?? null,
    }),
    loadOperationalContext({
      supabase: params.supabase,
      ownerId: params.ownerId,
      propertyId: params.propertyId,
      guestKey: params.guestKey,
      category: params.category ?? null,
    }),
    analyzeSentiment(params.message),
  ]);

  usage = mergeUsage(usage, retrieved.usage);
  usage = mergeUsage(usage, sentiment.usage);

  const lines: string[] = [];

  lines.push(
    `## Sessão atual (memória de curto prazo)\n${renderShortTerm(shortTerm, params.message)}`,
  );
  keys.push("short_term_memory");

  if (retrieved.memories.length) {
    keys.push("long_term_memory");
    lines.push(
      "\n## Memórias de longo prazo (uso interno — NÃO são verdade absoluta)\n" +
        "Cada memória vem com origem, data e confiança. Em qualquer conflito com dados oficiais " +
        "(reserva, banco de dados, guia, FAQ), a fonte oficial SEMPRE prevalece. Nunca cite a memória " +
        "como fato verificado nem revele ao hóspede que existe um histórico registrado.\n" +
        renderMemories(retrieved.memories),
    );
  }

  if (operational.records.length) {
    keys.push("operational_memory");
    lines.push(
      "\n## Histórico operacional deste imóvel (uso interno)\n" +
        renderOperational(operational.records) +
        (operational.openCount
          ? `\nChamados ainda em aberto: ${operational.openCount}. Considere isso antes de tratar o assunto como novo.`
          : "") +
        (operational.recurring.length
          ? `\nCategorias recorrentes: ${operational.recurring.join(", ")}.`
          : ""),
    );
  }

  keys.push("sentiment");
  lines.push(
    `\n## Leitura emocional da mensagem atual\nSentimento: ${sentiment.sentiment} | Risco de avaliação negativa: ${sentiment.risk}` +
      (sentiment.risk === "alto"
        ? "\nAtenção: priorize acolhimento, resolução objetiva e considere escalar para humano."
        : ""),
  );

  const language = params.language ?? params.memory?.language ?? null;

  const guestSnapshot: Record<string, unknown> = {
    guestKey: params.guestKey,
    guestName: params.guestName,
    language,
    sentiment: sentiment.sentiment,
    risk: sentiment.risk,
    preferences: params.memory?.preferences ?? {},
    memorySummary: params.memory?.summary ?? null,
    openTopic: shortTerm.openTopic?.topic ?? null,
    entities: shortTerm.entities,
    intentTrail: shortTerm.intentTrail,
  };

  const operationalSnapshot: Record<string, unknown> = {
    openCount: operational.openCount,
    recurring: operational.recurring,
    records: operational.records.slice(0, 5).map((r) => ({
      category: r.category,
      request: r.request.slice(0, 160),
      status: r.status,
      resolution: r.resolution?.slice(0, 160) ?? null,
      recurrence: r.recurrenceCount,
      createdAt: r.createdAt,
    })),
  };

  return {
    text: lines.join("\n"),
    memories: retrieved.memories,
    operational: operational.records,
    shortTerm,
    memoryConfidence: retrieved.confidence,
    sentiment: sentiment.sentiment,
    risk: sentiment.risk,
    language,
    keys,
    usage,
    retrievalUsed: retrieved.retrievalUsed,
    guestSnapshot,
    operationalSnapshot,
  };
}
