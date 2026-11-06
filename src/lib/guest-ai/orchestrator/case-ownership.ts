/**
 * F2-B · B1 — POSSE HUMANA POR ASSUNTO (puro).
 *
 * Um chamado aberto NUNCA bloqueia a IA globalmente (não existe `if (hasOpenTicket) blockAI`).
 * A relação entre a mensagem e os chamados é INTERPRETADA pelo modelo (`caseRelation`); a REGRA é
 * determinística e vem do F1 (`evaluateCaseGate`):
 *  - related   ⇒ o assunto é da equipe: a resposta não pode assumir compromisso sobre ele;
 *  - ambiguous ⇒ esclarecer antes de assumir que é o mesmo assunto;
 *  - independent / new ⇒ atendimento normal.
 *
 * VÁRIOS CHAMADOS ABERTOS: o contrato atual da decisão traz UMA relação para o turno (não uma por
 * chamado). Comportamento, deliberadamente conservador:
 *  - "related" com 1 chamado ⇒ atribuído a ele (`attribution: "single"`, `caseId` preenchido);
 *  - "related" com 2+ chamados ⇒ a regra vale (sem compromissos), mas NÃO se sabe qual chamado
 *    (`attribution: "unattributed"`, `caseId: null`) — o F1 apontaria o primeiro, o que seria um palpite;
 *  - "ambiguous" ⇒ esclarecer, qualquer que seja o número de chamados;
 *  - "independent"/"new" ⇒ independente de TODOS os chamados: atendimento normal.
 * A associação granular por chamado exige o contrato mínimo da B2 (ver AGENTS.md / relatório).
 */
import { evaluateCaseGate, type CaseGate } from "@/lib/guest-ai/policy/engine";
import type { CaseRelation, OpenCase } from "@/lib/guest-ai/types";
import type { ModelCaseRelation } from "./contracts";

export interface CaseOwnership {
  gate: CaseGate;
  /** Havia chamado aberto e o modelo não classificou a relação com ele. */
  relationMissing: boolean;
  openCaseCount: number;
  /** A quem a posse humana do assunto foi atribuída. */
  attribution: "none" | "single" | "unattributed";
}

export function resolveCaseOwnership(openCases: readonly OpenCase[], modelRelation: ModelCaseRelation): CaseOwnership {
  const openCaseCount = openCases.length;
  if (openCaseCount === 0) {
    // Sem chamado aberto, qualquer relação declarada é irrelevante: atendimento normal.
    return { gate: evaluateCaseGate([], "new"), relationMissing: false, openCaseCount, attribution: "none" };
  }
  const relationMissing = modelRelation === "no_open_case";
  // Há chamado e o modelo ignorou: tratado como ambíguo (esclarecer), e sinalizado.
  const relation: CaseRelation = relationMissing ? "ambiguous" : (modelRelation as CaseRelation);
  const gate = evaluateCaseGate([...openCases], relation);
  if (!gate.humanOwnsTopic) return { gate, relationMissing, openCaseCount, attribution: "none" };
  if (openCaseCount === 1) return { gate, relationMissing, openCaseCount, attribution: "single" };
  // 2+ chamados: a regra (sem compromissos) vale, mas o chamado específico é desconhecido.
  return { gate: { ...gate, caseId: null }, relationMissing, openCaseCount, attribution: "unattributed" };
}

// ─────────────────────────── B2.4 — atendimento humano por ASSUNTO ───────────────────────────

/**
 * Linha de `property_chat_conversations` (projeção `CONVERSATION_OWNERSHIP_COLUMNS`). Conversa,
 * chamado e assunto NÃO são equivalentes: não existe tabela de chamados, então o único "chamado" é
 * o encaminhamento registrado na conversa, e o seu ASSUNTO é o motivo do encaminhamento
 * (`handoff_reason`), quando houver. Outros assuntos da mesma conversa seguem elegíveis.
 */
export interface ConversationOwnershipRow {
  id: string;
  status: string | null;
  assigned_to: string | null;
  handoff_reason: string | null;
  handoff_urgency: string | null;
  handoff_at: string | null;
  resolved_at: string | null;
  ai_paused: boolean | null;
  paused_until: string | null;
}

export const HUMAN_OWNERSHIP_STATES = ["none", "awaiting_human", "assigned", "resolved", "reopened", "unknown"] as const;
export type HumanOwnershipState = (typeof HUMAN_OWNERSHIP_STATES)[number];

export interface HumanOwnershipSnapshot {
  state: HumanOwnershipState;
  /** Há atendimento humano ativo sobre ALGUM assunto (nunca significa bloqueio da conversa inteira). */
  active: boolean;
  /** Há responsável atribuído (id nunca exposto ao modelo). */
  assigned: boolean;
  urgency: "low" | "normal" | "high" | null;
  since: string | null;
  /** Assunto protegido: motivo do encaminhamento (texto da equipe) ou desconhecido. */
  topic: { status: "known"; text: string } | { status: "unknown" };
  /** Pausa EXPLÍCITA da IA pela equipe (decisão humana, não inferida de chamado aberto). */
  aiPausedByTeam: boolean;
  evidence: "conversation_status";
}

const OPEN = ["needs_human", "assigned"];
const URGENCY: Readonly<Record<string, "low" | "normal" | "high">> = Object.freeze({ low: "low", baixa: "low", normal: "normal", media: "normal", "média": "normal", medium: "normal", high: "high", alta: "high", urgent: "high", urgente: "high" });
const KNOWN_STATUSES = ["ai", "needs_human", "assigned", "resolved", "closed", "open", "active"];

/** Deriva o estado do atendimento humano (puro; o instante chega por parâmetro). */
export function deriveHumanOwnership(row: ConversationOwnershipRow | null, now: string): HumanOwnershipSnapshot {
  const nowMs = Date.parse(now);
  const empty: HumanOwnershipSnapshot = { state: "none", active: false, assigned: false, urgency: null, since: null, topic: { status: "unknown" }, aiPausedByTeam: false, evidence: "conversation_status" };
  if (!row || typeof row !== "object") return { ...empty, state: "unknown" };
  const status = typeof row.status === "string" ? row.status : null;
  const until = typeof row.paused_until === "string" ? Date.parse(row.paused_until) : Number.NaN;
  // B2.5 — estado de pausa ILEGÍVEL (prazo não interpretável, flag não booleana, relógio inválido com
  // prazo presente) é desconhecido ⇒ a cadeia recusa; nunca é lido como "sem pausa".
  const pauseUnreadable =
    (row.ai_paused !== null && row.ai_paused !== undefined && typeof row.ai_paused !== "boolean") ||
    (row.paused_until !== null && row.paused_until !== undefined && (!Number.isFinite(until) || !Number.isFinite(nowMs)));
  if (pauseUnreadable) return { ...empty, state: "unknown", aiPausedByTeam: true };
  const aiPausedByTeam = row.ai_paused === true || (Number.isFinite(until) && Number.isFinite(nowMs) && until > nowMs);
  const reason = typeof row.handoff_reason === "string" && row.handoff_reason.trim() ? row.handoff_reason.trim() : null;
  const urgency = typeof row.handoff_urgency === "string" ? URGENCY[row.handoff_urgency.trim().toLowerCase()] ?? null : null;
  const assigned = typeof row.assigned_to === "string" && row.assigned_to.length > 0;
  if (status === null || !KNOWN_STATUSES.includes(status)) return { ...empty, state: "unknown", aiPausedByTeam };
  if (!OPEN.includes(status)) {
    return { ...empty, state: row.resolved_at ? "resolved" : "none", aiPausedByTeam };
  }
  const handoffMs = typeof row.handoff_at === "string" ? Date.parse(row.handoff_at) : Number.NaN;
  const resolvedMs = typeof row.resolved_at === "string" ? Date.parse(row.resolved_at) : Number.NaN;
  const reopened = Number.isFinite(resolvedMs) && Number.isFinite(handoffMs) && handoffMs > resolvedMs;
  const state: HumanOwnershipState = reopened ? "reopened" : status === "assigned" || assigned ? "assigned" : "awaiting_human";
  return {
    state,
    active: true,
    assigned,
    urgency,
    since: typeof row.handoff_at === "string" ? row.handoff_at : null,
    topic: reason ? { status: "known", text: reason } : { status: "unknown" },
    aiPausedByTeam,
    evidence: "conversation_status",
  };
}
