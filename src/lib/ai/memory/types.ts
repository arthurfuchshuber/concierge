/**
 * Tipos compartilhados da Memory Architecture do ConciergeIA.
 *
 * Camadas:
 *  - Short-Term Memory: contexto vivo da conversa atual (sessão).
 *  - Long-Term Memory : fatos persistentes entre conversas (ai_memories).
 *  - Operational Memory: histórico operacional real (ai_operational_memory).
 */

/** Escopo da memória — preparado para evolução (proprietário, prestador, equipe). */
export type MemoryScope = "guest" | "property" | "owner" | "provider" | "team" | "global";

/** Natureza da memória — define política de gravação e uso. */
export type MemoryKind =
  | "preference"
  | "issue"
  | "resolution"
  | "property_fact"
  | "operational_decision"
  | "fact";

export type MemoryRecord = {
  id: string;
  scope: MemoryScope;
  subjectKey: string | null;
  kind: MemoryKind;
  category: string | null;
  title: string | null;
  content: string;
  source: string;
  importance: number;
  confidence: number;
  lastSeenAt: string;
  propertyId: string | null;
};

/** Memória recuperada e pontuada pelo Memory Retrieval System. */
export type ScoredMemory = MemoryRecord & {
  /** 1 = contexto da reserva atual … 5 = memória genérica. */
  tier: 1 | 2 | 3 | 4 | 5;
  /** Similaridade semântica ou textual (0..1). */
  relevance: number;
  /** Peso do decaimento temporal (0..1). */
  decay: number;
  /** Pontuação final combinada. */
  score: number;
  retrieval: "vector" | "text";
};

export type OperationalRecord = {
  id: string;
  category: string;
  request: string;
  providerName: string | null;
  resolution: string | null;
  resolutionMinutes: number | null;
  recurrenceCount: number;
  satisfaction: string | null;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
};

/** Candidata a virar memória de longo prazo (saída da política de gravação). */
export type MemoryCandidate = {
  scope: MemoryScope;
  kind: MemoryKind;
  category?: string | null;
  title?: string | null;
  content: string;
  importance?: number;
  confidence?: number;
  source?: string;
  /** Dias até expirar (memórias efêmeras). */
  ttlDays?: number | null;
  metadata?: Record<string, unknown>;
};
