/**
 * Short-Term Memory — memória viva da conversa atual.
 *
 * Guarda, por conversa: mensagens recentes, intenção corrente, entidades
 * identificadas, ferramentas chamadas e seus resultados, decisões do planner
 * e contexto temporário da sessão. Permite continuidade dentro da mesma
 * interação ("meu ar parou" → "é no quarto principal").
 *
 * Persistência: cache em processo com TTL. Como o runtime é serverless e pode
 * reciclar isolates, a camada é sempre reconstruída de forma resiliente a
 * partir do histórico da conversa (`seedFromHistory`) — nunca é fonte única
 * de verdade nem substitui a Long-Term Memory.
 */
import type { MemoryKind } from "./types";

export type ShortTermToolTrace = {
  name: string;
  args?: unknown;
  ok: boolean;
  summary?: string;
  at: number;
};

export type ShortTermState = {
  conversationId: string;
  updatedAt: number;
  /** Últimas mensagens (papel + texto), limitadas. */
  messages: Array<{ role: string; content: string; at: number }>;
  /** Intenção corrente e as anteriores desta sessão. */
  currentIntent: string | null;
  intentTrail: string[];
  /** Assunto em aberto — usado para resolver mensagens elípticas. */
  openTopic: { topic: string; kind: MemoryKind; at: number } | null;
  /** Entidades identificadas na sessão (cômodo, equipamento, data, lugar...). */
  entities: Record<string, string>;
  /** Ferramentas chamadas e resultados resumidos. */
  tools: ShortTermToolTrace[];
  /** Decisões do planner nesta sessão. */
  plannerDecisions: Array<{ objective: string; tools: string[]; riskLevel: string; at: number }>;
  /** Contexto temporário arbitrário da sessão. */
  scratch: Record<string, unknown>;
};

const TTL_MS = 45 * 60 * 1000; // 45 minutos de sessão viva
const MAX_ENTRIES = 500;
const MAX_MESSAGES = 20;
const MAX_TOOLS = 30;

const store = new Map<string, ShortTermState>();

function prune(): void {
  const now = Date.now();
  for (const [key, value] of store) {
    if (now - value.updatedAt > TTL_MS) store.delete(key);
  }
  if (store.size > MAX_ENTRIES) {
    const oldest = Array.from(store.entries()).sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    for (const [key] of oldest.slice(0, store.size - MAX_ENTRIES)) store.delete(key);
  }
}

function blank(conversationId: string): ShortTermState {
  return {
    conversationId,
    updatedAt: Date.now(),
    messages: [],
    currentIntent: null,
    intentTrail: [],
    openTopic: null,
    entities: {},
    tools: [],
    plannerDecisions: [],
    scratch: {},
  };
}

export function getShortTerm(conversationId: string): ShortTermState {
  prune();
  const existing = store.get(conversationId);
  if (existing) return existing;
  const created = blank(conversationId);
  store.set(conversationId, created);
  return created;
}

export function resetShortTerm(conversationId: string): void {
  store.delete(conversationId);
}

/** Reidrata a sessão a partir do histórico persistido (após reciclagem do isolate). */
export function seedFromHistory(
  conversationId: string,
  history: Array<{ role: string; content: string }>,
): ShortTermState {
  const state = getShortTerm(conversationId);
  if (state.messages.length) return state;
  const now = Date.now();
  state.messages = history.slice(-MAX_MESSAGES).map((m, i) => ({
    role: m.role,
    content: m.content,
    at: now - (history.length - i) * 1000,
  }));
  state.updatedAt = now;
  return state;
}

export function rememberMessage(conversationId: string, role: string, content: string): void {
  const state = getShortTerm(conversationId);
  state.messages.push({ role, content, at: Date.now() });
  if (state.messages.length > MAX_MESSAGES) state.messages.splice(0, state.messages.length - MAX_MESSAGES);
  state.updatedAt = Date.now();
}

export function rememberIntent(
  conversationId: string,
  intent: { intent: string; category?: string; urgency?: string },
): void {
  const state = getShortTerm(conversationId);
  state.currentIntent = intent.intent || null;
  if (intent.intent) {
    state.intentTrail.push(intent.intent);
    if (state.intentTrail.length > 10) state.intentTrail.shift();
  }
  state.updatedAt = Date.now();
}

/** Marca o assunto em aberto (ex.: problema operacional ainda não resolvido). */
export function setOpenTopic(conversationId: string, topic: string, kind: MemoryKind): void {
  const state = getShortTerm(conversationId);
  state.openTopic = { topic: topic.slice(0, 400), kind, at: Date.now() };
  state.updatedAt = Date.now();
}

export function clearOpenTopic(conversationId: string): void {
  const state = getShortTerm(conversationId);
  state.openTopic = null;
  state.updatedAt = Date.now();
}

export function rememberEntities(conversationId: string, entities: Record<string, string>): void {
  const state = getShortTerm(conversationId);
  for (const [key, value] of Object.entries(entities)) {
    if (value && String(value).trim()) state.entities[key] = String(value).slice(0, 200);
  }
  state.updatedAt = Date.now();
}

export function rememberTools(conversationId: string, calls: ShortTermToolTrace[]): void {
  if (!calls.length) return;
  const state = getShortTerm(conversationId);
  state.tools.push(...calls);
  if (state.tools.length > MAX_TOOLS) state.tools.splice(0, state.tools.length - MAX_TOOLS);
  state.updatedAt = Date.now();
}

export function rememberPlan(
  conversationId: string,
  plan: { objective: string; tools: Array<{ name: string }>; riskLevel: string },
): void {
  const state = getShortTerm(conversationId);
  state.plannerDecisions.push({
    objective: plan.objective,
    tools: plan.tools.map((t) => t.name),
    riskLevel: plan.riskLevel,
    at: Date.now(),
  });
  if (state.plannerDecisions.length > 10) state.plannerDecisions.shift();
  state.updatedAt = Date.now();
}

export function setScratch(conversationId: string, key: string, value: unknown): void {
  const state = getShortTerm(conversationId);
  state.scratch[key] = value;
  state.updatedAt = Date.now();
}

/**
 * Heurística barata de continuidade: mensagens curtas e sem sujeito claro
 * normalmente complementam o assunto anterior.
 */
export function isFollowUp(message: string): boolean {
  const text = message.trim().toLowerCase();
  if (!text) return false;
  if (text.length > 90) return false;
  return /^(é|e|no|na|do|da|foi|sim|não|nao|ainda|tbm|também|tambem|aqui|ali|lá|la|esse|essa|isso|aquele|the|it|in|at|yes|no)\b/.test(
    text,
  );
}

/** Renderização do estado de curto prazo para injeção no raciocínio do agente. */
export function renderShortTerm(state: ShortTermState, message: string): string {
  const lines: string[] = [];
  if (state.openTopic) {
    lines.push(`Assunto em aberto nesta conversa: ${state.openTopic.topic} (tipo=${state.openTopic.kind})`);
  }
  if (state.currentIntent) lines.push(`Intenção anterior: ${state.currentIntent}`);
  const entities = Object.entries(state.entities);
  if (entities.length) {
    lines.push(`Entidades já identificadas: ${entities.map(([k, v]) => `${k}=${v}`).join(", ")}`);
  }
  if (state.tools.length) {
    const recent = state.tools.slice(-6).map((t) => `${t.name}${t.ok ? "" : " (falhou)"}`);
    lines.push(`Ferramentas já usadas nesta sessão: ${recent.join(", ")}`);
  }
  if (state.plannerDecisions.length) {
    const last = state.plannerDecisions[state.plannerDecisions.length - 1];
    lines.push(`Último plano: ${last.objective} [${last.tools.join(", ") || "sem ferramentas"}]`);
  }
  if (isFollowUp(message) && state.openTopic) {
    lines.push(
      "A mensagem atual parece um complemento do assunto em aberto acima — interprete-a como continuação, não como novo tema.",
    );
  }
  return lines.length ? lines.join("\n") : "(sessão nova, sem contexto anterior)";
}
