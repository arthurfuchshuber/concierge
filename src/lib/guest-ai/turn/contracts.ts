/**
 * MODO IA (diretriz definitiva de 05/11/2026) — contratos puros (sem banco, rede, relógio ou LLM).
 *
 * A IA gera SUGESTÕES de resposta para a equipe aprovar na tela de Atendimento. A IA nunca envia:
 * `slot.server.ts` continua devolvendo `null`, nenhum worker autônomo é ligado e o envio só acontece pela
 * rotina humana existente, acionada por um usuário autenticado. Estes vocabulários espelham a migration
 * `20261117200000_guest_ai_turns.sql`.
 */
import { GUEST_AI_RESERVE_MODEL } from "@/lib/guest-ai/orchestrator/contracts";
import { modelSpec } from "@/lib/guest-ai/llm/models";
import type { GuestSurface } from "@/lib/guest-ai/types";

export const TURN_VERSION = "turn.2026-11-17.1";

/** Estados do turno (banco). */
export const TURN_STATES = ["generating", "available", "no_suggestion", "generation_failed", "superseded"] as const;
export type TurnState = (typeof TURN_STATES)[number];

/** Avisos mostrados no cartão (lista fechada; nenhum texto livre). */
export const TURN_WARNINGS = [
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
export type TurnWarning = (typeof TURN_WARNINGS)[number];

export const TURN_OUTCOME_KINDS = [
  "reply",
  "silence",
  "human_action",
  "paused",
  "urgent_internal_alert",
  "refused",
  "technical_error",
  "blocked",
] as const;
export type TurnOutcomeKind = (typeof TURN_OUTCOME_KINDS)[number];

export const TURN_SENDER_IDENTITY_STATES = [
  "resolved",
  "unavailable",
  "ambiguous",
  "invalid",
  "not_applicable",
  "not_evaluated",
] as const;

/**
 * Controle de custos — teto POR TURNO fixo (US$ 1,00 desde 14/11/2026; protege contra uma chamada desgovernada) e teto
 * DIÁRIO POR ANÚNCIO E POR CONTA (15/11/2026; ver `TURN_DEFAULT_LISTING_DAILY_COST_USD`): não existe mais teto global entre
 * contas nem caminho "sem teto".
 */
export const TURN_MAX_COST_USD = 1;

/**
 * PRAZOS (titular, 10/11/2026 — auditoria: ~50% dos turnos do Airbnb eram cortados em 15 s com o raciocínio
 * elástico do Flash levando 7–10 s por chamada sobre ~21–24 mil tokens): a cadeia do turno ganha até 30 s
 * (`TURN_STAGE_MAX_MS`), mantendo o raciocínio em `auto`. O prazo total da resposta ao hóspede (slot, inline
 * no canal) cobre leitura + 30 s de cadeia + validação. Nada bloqueia o atendimento humano.
 */
export const TURN_STAGE_MAX_MS = 30_000;

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
/**
 * Respiro antes de gerar (Pilar 4 do refinamento de hospitalidade, 06/11/2026): mensagens em rajada ("Oi" /
 * "Tudo bem?" / "Qual a senha do wifi?") viram UMA resposta. Cada mensagem espera esta janela em segundo plano;
 * se outra do hóspede chegar nesse meio-tempo, só a mais nova gera (ela vê o conjunto). Dentro de 5–8 s.
 */
export const TURN_BURST_QUIET_MS = 6_000;
/**
 * RACIOCÍNIO 100% ELÁSTICO (ajuste fino do PR #11, 07/11/2026): não existe tabela de esforço por assunto.
 * A IA chama o modelo em `auto` — o parâmetro de esforço não é enviado e o próprio modelo dosa a
 * profundidade do pensamento em cada situação. O guarda-corpo financeiro é EXTERNO ao modelo:
 *  - teto de custo por turno (`TURN_MAX_COST_USD`, US$ 1,00), conferido no pior caso ANTES da rede;
 *  - teto de saída (`TURN_MAX_OUTPUT_TOKENS`; os tokens de raciocínio contam como saída), com recuo para
 *    `TURN_MIN_OUTPUT_TOKENS` quando o teto cheio não cabe no teto de custo do turno;
 *  - teto diário por anúncio/conta (`turnListingDailyCostUsd`).
 */
export const TURN_REASONING_EFFORT = "auto" as const;
/** Teto de saída da chamada (= `LIMITS.maxOutputTokens`): espaço para o modelo raciocinar quando precisar. */
export const TURN_MAX_OUTPUT_TOKENS = 4_096;
/** Recuo do teto de saída quando o teto cheio estouraria o teto de custo do turno (prompt muito grande). */
export const TURN_MIN_OUTPUT_TOKENS = 1_536;

/**
 * Modelo da IA: `GUEST_AI_MODEL` se estiver no registro; senão o Gemini Flash (10/11/2026).
 *
 * Auditoria de custo: com o Dossiê completo (~20-25 mil tokens de entrada), o GPT-6 Astra levava 11-16 s,
 * estourava o prazo (stage_timeout / http 499) e a leitura da entrada era faturada mesmo sem resposta. O Flash
 * respondeu em ~1,9 s por ~170× menos. O Astra segue no catálogo (e pode voltar pela variável), mas a IA
 * de alto volume roda no Flash por padrão.
 */
export function turnModelId(env: Record<string, string | undefined> = process.env): string {
  const requested = env["GUEST_AI_MODEL"];
  return requested && modelSpec(requested) ? requested : GUEST_AI_RESERVE_MODEL;
}

/**
 * Teto diário POR ANÚNCIO (15/11/2026; substitui o teto global único). O teto da CONTA é a soma dos tetos dos anúncios
 * dela com a IA ligada (calculada no banco, `guest_ai_claim_turn`); um anúncio pode passar do próprio teto
 * enquanto a conta tiver folga, até `TURN_LISTING_BURST_FACTOR`× o teto dele. Contas nunca dividem orçamento.
 * Exceção por anúncio: `property_listing_raw_data.ai_daily_cost_limit_usd`.
 */
export const TURN_DEFAULT_LISTING_DAILY_COST_USD = 1;
/** Limite superior aceito na variável (proteção contra erro de digitação, ex. "100" em vez de "1.00"). */
export const TURN_LISTING_DAILY_COST_MAX_USD = 50;
/** Máximo que UM anúncio pode gastar por dia, em múltiplos do próprio teto (fixo na função do banco). */
export const TURN_LISTING_BURST_FACTOR = 3;

/**
 * Teto padrão POR ANÚNCIO: `GUEST_AI_LISTING_DAILY_COST_USD` positivo (≤ US$ 50); senão US$ 1,00. Nunca `null`.
 */
export function turnListingDailyCostUsd(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env["GUEST_AI_LISTING_DAILY_COST_USD"];
  const v = raw === undefined || raw.trim() === "" ? Number.NaN : Number(raw);
  if (!Number.isFinite(v) || v <= 0) return TURN_DEFAULT_LISTING_DAILY_COST_USD;
  return Math.min(v, TURN_LISTING_DAILY_COST_MAX_USD);
}

/** Pedido de geração: só identificadores (o backend re-deriva e valida tudo — F0). */
export interface TurnGenerationRequest {
  surface: GuestSurface;
  conversationId: string;
  messageId: string;
  /** Dono já provado pelo canal (assinatura/anúncio); se vier, tem de conferir com o dono real do imóvel. */
  expectedOwnerId?: string | null;
}

