/**
 * MODO COPILOTO (diretriz definitiva de 05/11/2026) — contratos puros (sem banco, rede, relógio ou LLM).
 *
 * O Copiloto gera SUGESTÕES de resposta para a equipe aprovar na tela de Atendimento. A IA nunca envia:
 * `slot.server.ts` continua devolvendo `null`, nenhum worker autônomo é ligado e o envio só acontece pela
 * rotina humana existente, acionada por um usuário autenticado. Estes vocabulários espelham a migration
 * `20261105150000_guest_ai_copilot_suggestions.sql` (o teste `copilot-pg` confere a paridade).
 */
import { GUEST_AI_RESERVE_MODEL } from "@/lib/guest-ai/orchestrator/contracts";
import { modelSpec } from "@/lib/guest-ai/llm/models";
import type { GuestSurface } from "@/lib/guest-ai/types";

export const COPILOT_VERSION = "copilot.2026-11-05.1";

/** Estados da sugestão (banco e cartão da UI). */
export const COPILOT_STATES = [
  "generating",
  "available",
  "edited",
  "sending",
  "sent",
  "send_failed",
  "discarded",
  "no_suggestion",
  "generation_failed",
  "superseded",
] as const;
export type CopilotState = (typeof COPILOT_STATES)[number];

/** Avisos mostrados no cartão (lista fechada; nenhum texto livre). */
export const COPILOT_WARNINGS = [
  "unknown_facts",
  "source_conflicts",
  "credential_request_denied",
  "unauthorized_commitment",
  "handoff_recommended",
  "emergency",
  "sender_identity_unresolved",
  "human_in_command",
  "reservation_not_linked",
  "dossier_unavailable",
  "history_unavailable",
  "formal_change_request",
] as const;
export type CopilotWarning = (typeof COPILOT_WARNINGS)[number];

export const COPILOT_OUTCOME_KINDS = [
  "reply",
  "silence",
  "human_action",
  "paused",
  "urgent_internal_alert",
  "refused",
  "technical_error",
  "blocked",
] as const;
export type CopilotOutcomeKind = (typeof COPILOT_OUTCOME_KINDS)[number];

export const COPILOT_SENDER_IDENTITY_STATES = [
  "resolved",
  "unavailable",
  "ambiguous",
  "invalid",
  "not_applicable",
  "not_evaluated",
] as const;

/**
 * Controle de custos — teto POR TURNO fixo (US$ 1,00 desde 14/11/2026; protege contra uma chamada desgovernada) e teto
 * DIÁRIO POR ANÚNCIO E POR CONTA (15/11/2026; ver `COPILOT_DEFAULT_LISTING_DAILY_COST_USD`): não existe mais teto global entre
 * contas nem caminho "sem teto".
 */
export const COPILOT_MAX_TURN_COST_USD = 1;

/**
 * PRAZOS (titular, 10/11/2026 — auditoria: ~50% dos turnos do Airbnb eram cortados em 15 s com o raciocínio
 * elástico do Flash levando 7–10 s por chamada sobre ~21–24 mil tokens): a cadeia do turno ganha até 30 s
 * (`COPILOT_STAGE_MAX_MS`), mantendo o raciocínio em `auto`. O prazo total da resposta ao hóspede (slot, inline
 * no canal) cobre leitura + 30 s de cadeia + validação. Nada bloqueia o atendimento humano.
 */
export const COPILOT_STAGE_MAX_MS = 30_000;

/**
 * TURNO LONGO (17/11/2026, decisão do titular: "não quero limitar raciocínio, aumente o tempo"). O turno autônomo
 * roda numa requisição própria disparada pelo banco (`dispatch_guest_ai_turn` → /api/public/ia/turno), que não morre
 * em ~30 s como o processamento do webhook. Com isso: raciocínio sempre em `auto`, cada chamada ao modelo pode levar
 * até 45 s, a geração inteira até 80 s, e uma nova tentativa (também `auto`) começa com pelo menos 20 s restantes.
 * A contingência (equipe assume) só entra se nada for decidido em 95 s.
 */
export const LONG_TURN = {
  deadlineMs: 80_000,
  stageMaxMs: 45_000,
  callMaxMs: 45_000,
  retryMinMs: 20_000,
  fallbackMs: 95_000,
} as const;
export const COPILOT_DEADLINE_MS = 40_000;
/**
 * Bastidores (disparo do Copiloto em segundo plano, `waitUntil` do Worker: ~30 s depois da resposta) seguem com
 * o prazo antigo, para nunca serem cortados pela plataforma no meio de uma gravação.
 */
export const COPILOT_BACKSTAGE_DEADLINE_MS = 25_000;
/**
 * Respiro antes de gerar (Pilar 4 do refinamento de hospitalidade, 06/11/2026): mensagens em rajada ("Oi" /
 * "Tudo bem?" / "Qual a senha do wifi?") viram UMA resposta. Cada mensagem espera esta janela em segundo plano;
 * se outra do hóspede chegar nesse meio-tempo, só a mais nova gera (ela vê o conjunto). Dentro de 5–8 s.
 */
export const COPILOT_BURST_QUIET_MS = 6_000;
/**
 * RACIOCÍNIO 100% ELÁSTICO (ajuste fino do PR #11, 07/11/2026): não existe tabela de esforço por assunto.
 * O Copiloto chama o modelo em `auto` — o parâmetro de esforço não é enviado e o próprio modelo dosa a
 * profundidade do pensamento em cada situação. O guarda-corpo financeiro é EXTERNO ao modelo:
 *  - teto de custo por turno (`COPILOT_MAX_TURN_COST_USD`, US$ 1,00), conferido no pior caso ANTES da rede;
 *  - teto de saída (`COPILOT_MAX_OUTPUT_TOKENS`; os tokens de raciocínio contam como saída), com recuo para
 *    `COPILOT_MIN_OUTPUT_TOKENS` quando o teto cheio não cabe no teto de custo do turno;
 *  - teto diário por anúncio/conta (`copilotListingDailyCostUsd`).
 */
export const COPILOT_REASONING_EFFORT = "auto" as const;
/** Teto de saída da chamada (= `LIMITS.maxOutputTokens`): espaço para o modelo raciocinar quando precisar. */
export const COPILOT_MAX_OUTPUT_TOKENS = 4_096;
/** Recuo do teto de saída quando o teto cheio estouraria o teto de custo do turno (prompt muito grande). */
export const COPILOT_MIN_OUTPUT_TOKENS = 1_536;

/**
 * Modelo do Copiloto: `GUEST_AI_COPILOT_MODEL` se estiver no registro; senão o Gemini Flash (10/11/2026).
 *
 * Auditoria de custo: com o Dossiê completo (~20-25 mil tokens de entrada), o GPT-6 Astra levava 11-16 s,
 * estourava o prazo (stage_timeout / http 499) e a leitura da entrada era faturada mesmo sem resposta. O Flash
 * respondeu em ~1,9 s por ~170× menos. O Astra segue no catálogo (e pode voltar pela variável), mas o Copiloto
 * de alto volume roda no Flash por padrão.
 */
export function copilotModelId(env: Record<string, string | undefined> = process.env): string {
  const requested = env["GUEST_AI_COPILOT_MODEL"];
  return requested && modelSpec(requested) ? requested : GUEST_AI_RESERVE_MODEL;
}

/**
 * Teto diário POR ANÚNCIO (15/11/2026; substitui o teto global único). O teto da CONTA é a soma dos tetos dos anúncios
 * dela com a IA ligada (calculada no banco, `copilot_claim_generation`); um anúncio pode passar do próprio teto
 * enquanto a conta tiver folga, até `COPILOT_LISTING_BURST_FACTOR`× o teto dele. Contas nunca dividem orçamento.
 * Exceção por anúncio: `property_listing_raw_data.ai_daily_cost_limit_usd`.
 */
export const COPILOT_DEFAULT_LISTING_DAILY_COST_USD = 1;
/** Limite superior aceito na variável (proteção contra erro de digitação, ex. "100" em vez de "1.00"). */
export const COPILOT_LISTING_DAILY_COST_MAX_USD = 50;
/** Máximo que UM anúncio pode gastar por dia, em múltiplos do próprio teto (fixo na função do banco). */
export const COPILOT_LISTING_BURST_FACTOR = 3;

/**
 * Teto padrão POR ANÚNCIO: `GUEST_AI_COPILOT_LISTING_DAILY_COST_USD` positivo (≤ US$ 50); senão US$ 1,00. Nunca `null`.
 */
export function copilotListingDailyCostUsd(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env["GUEST_AI_COPILOT_LISTING_DAILY_COST_USD"];
  const v = raw === undefined || raw.trim() === "" ? Number.NaN : Number(raw);
  if (!Number.isFinite(v) || v <= 0) return COPILOT_DEFAULT_LISTING_DAILY_COST_USD;
  return Math.min(v, COPILOT_LISTING_DAILY_COST_MAX_USD);
}

/** Pedido de geração: só identificadores (o backend re-deriva e valida tudo — F0). */
export interface CopilotGenerationRequest {
  surface: GuestSurface;
  conversationId: string;
  messageId: string;
  /** Dono já provado pelo canal (assinatura/anúncio); se vier, tem de conferir com o dono real do imóvel. */
  expectedOwnerId?: string | null;
}

/** Linha da tabela como a UI e as server functions a leem (campos usados pelo cartão). */
export interface CopilotSuggestionRow {
  id: string;
  tenant_id: string;
  property_id: string;
  conversation_id: string;
  trigger_message_id: string;
  surface: GuestSurface;
  state: CopilotState;
  suggested_text: string | null;
  edited_text: string | null;
  internal_question: string | null;
  intents: string[];
  strategy: string | null;
  handoff_needed: boolean;
  handoff_urgency: string | null;
  outcome_kind: CopilotOutcomeKind | null;
  outcome_code: string | null;
  warnings: CopilotWarning[];
  context_stay_phase: string | null;
  context_reservation_linked: boolean | null;
  context_history_messages: number | null;
  context_dossier_entries: number | null;
  context_credential_policy: "allow" | "deny" | null;
  context_sender_identity: string | null;
  context_human_in_command: boolean | null;
  model_id: string | null;
  gateway_error: string | null;
  generation_attempts: number;
  generation_started_at: string;
  generation_finished_at: string | null;
  edited_at: string | null;
  edited_by: string | null;
  send_attempts: number;
  send_claimed_at: string | null;
  sent_at: string | null;
  sent_by: string | null;
  sent_message_id: string | null;
  sent_channel: string | null;
  send_error: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

/** Colunas lidas pela UI (projeção explícita — nunca `*`). */
export const COPILOT_ROW_COLUMNS = [
  "id",
  "tenant_id",
  "property_id",
  "conversation_id",
  "trigger_message_id",
  "surface",
  "state",
  "suggested_text",
  "edited_text",
  "internal_question",
  "intents",
  "strategy",
  "handoff_needed",
  "handoff_urgency",
  "outcome_kind",
  "outcome_code",
  "warnings",
  "context_stay_phase",
  "context_reservation_linked",
  "context_history_messages",
  "context_dossier_entries",
  "context_credential_policy",
  "context_sender_identity",
  "context_human_in_command",
  "model_id",
  "gateway_error",
  "generation_attempts",
  "generation_started_at",
  "generation_finished_at",
  "edited_at",
  "edited_by",
  "send_attempts",
  "send_claimed_at",
  "sent_at",
  "sent_by",
  "sent_message_id",
  "sent_channel",
  "send_error",
  "created_at",
  "updated_at",
  "expires_at",
] as const;

/** Texto final de uma sugestão (editado quando houver). */
export const copilotFinalText = (
  r: Pick<CopilotSuggestionRow, "suggested_text" | "edited_text">,
): string | null => r.edited_text ?? r.suggested_text;

/** Estados em que o cartão ainda oferece ações ao atendente. */
export const isCopilotActionable = (s: CopilotState): boolean =>
  s === "available" || s === "edited" || s === "send_failed";
