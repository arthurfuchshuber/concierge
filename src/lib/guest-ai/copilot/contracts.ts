/**
 * MODO COPILOTO (diretriz definitiva de 05/11/2026) — contratos puros (sem banco, rede, relógio ou LLM).
 *
 * O Copiloto gera SUGESTÕES de resposta para a equipe aprovar na tela de Atendimento. A IA nunca envia:
 * `slot.server.ts` continua devolvendo `null`, nenhum worker autônomo é ligado e o envio só acontece pela
 * rotina humana existente, acionada por um usuário autenticado. Estes vocabulários espelham a migration
 * `20261105150000_guest_ai_copilot_suggestions.sql` (o teste `copilot-pg` confere a paridade).
 */
import { GUEST_AI_DEFAULT_MODEL } from "@/lib/guest-ai/orchestrator/contracts";
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
 * Controle de custos — os MESMOS tetos aprovados para a Guest AI (teto diário US$ 1,00 e custo por turno
 * ≤ US$ 0,15; ver `shadow-exec/contracts.ts`, que o Copiloto não importa por isolamento). A migration recusa
 * valores acima destes tetos; a variável de ambiente só pode APERTAR o teto diário.
 */
export const COPILOT_DAILY_COST_CEILING_USD = 1;
export const COPILOT_MAX_TURN_COST_USD = 0.15;

/** Prazo total da geração (contexto + Gateway ≤ 15 s + validação). Nada bloqueia o atendimento humano. */
export const COPILOT_DEADLINE_MS = 25_000;
/** Teto de saída do modelo (a resposta ao hóspede é curta; o teto protege o custo por turno). */
export const COPILOT_MAX_OUTPUT_TOKENS = 1_536;
export const COPILOT_REASONING_EFFORT = "low" as const;

/**
 * TRÊS CONTROLES INDEPENDENTES (não existe chave única que ligue tudo). Cada um só vale com o literal `on`;
 * ausente, vazio ou qualquer outro valor ⇒ desligado. Lidos SEMPRE no servidor, a cada chamada:
 *  - `GUEST_AI_COPILOT_UI`: o cartão existe e o atendente pode ver/editar/descartar sugestões já gravadas;
 *  - `GUEST_AI_COPILOT_GENERATION`: o servidor pode reivindicar e gerar sugestões (chamada ao Gateway);
 *  - `GUEST_AI_COPILOT_SEND`: o servidor aceita enviar uma sugestão aprovada pela rotina humana.
 * Geração e envio NÃO dependem da UI ligada e vice-versa: cada porta confere a sua própria chave. A interface
 * só recebe o estado para se adaptar; nenhuma decisão de bloqueio é tomada no navegador.
 */
export const COPILOT_FLAG_ENV = {
  ui: "GUEST_AI_COPILOT_UI",
  generation: "GUEST_AI_COPILOT_GENERATION",
  send: "GUEST_AI_COPILOT_SEND",
} as const;
export type CopilotFlag = keyof typeof COPILOT_FLAG_ENV;
export interface CopilotFlags {
  ui: boolean;
  generation: boolean;
  send: boolean;
}

export function copilotFlags(env: Record<string, string | undefined> = process.env): CopilotFlags {
  return {
    ui: env[COPILOT_FLAG_ENV.ui] === "on",
    generation: env[COPILOT_FLAG_ENV.generation] === "on",
    send: env[COPILOT_FLAG_ENV.send] === "on",
  };
}

export const copilotFlagOn = (
  flag: CopilotFlag,
  env: Record<string, string | undefined> = process.env,
): boolean => copilotFlags(env)[flag];

/**
 * ALLOWLIST DE IMÓVEIS da geração (backend, fail-closed). Mesmo com `GUEST_AI_COPILOT_GENERATION=on`, só gera
 * para imóveis listados em `GUEST_AI_COPILOT_GENERATION_PROPERTY_IDS` (ids separados por vírgula). Vazia ou
 * ausente ⇒ NENHUM imóvel. A conferência usa o imóvel RE-DERIVADO do banco para o turno validado — nunca um
 * id enviado pelo navegador ou pelo canal. Não existe geração global.
 */
export const COPILOT_GENERATION_PROPERTIES_ENV = "GUEST_AI_COPILOT_GENERATION_PROPERTY_IDS";
const PROPERTY_TOKEN = /^[A-Za-z0-9-]{1,64}$/;
export function copilotGenerationProperties(
  env: Record<string, string | undefined> = process.env,
): ReadonlySet<string> {
  const raw = env[COPILOT_GENERATION_PROPERTIES_ENV] ?? "";
  return new Set(
    raw
      .split(",")
      .map((t) => t.trim())
      .filter((t) => PROPERTY_TOKEN.test(t)),
  );
}

/** Erro fechado de porta desligada (a server function devolve sem efeito; nada é lido, reivindicado ou enviado). */
export class CopilotFlagOffError extends Error {
  constructor(readonly flag: CopilotFlag) {
    super(`copilot_${flag}_off`);
    this.name = "CopilotFlagOffError";
  }
}

/** Modelo do Copiloto: `GUEST_AI_COPILOT_MODEL` se estiver no registro; senão o padrão da Guest AI. */
export function copilotModelId(env: Record<string, string | undefined> = process.env): string {
  const requested = env["GUEST_AI_COPILOT_MODEL"];
  return requested && modelSpec(requested) ? requested : GUEST_AI_DEFAULT_MODEL;
}

/** Teto diário efetivo: `GUEST_AI_COPILOT_DAILY_COST_USD` (0 < v ≤ 1,00); inválido ou ausente ⇒ teto aprovado. */
export function copilotDailyLimitUsd(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env["GUEST_AI_COPILOT_DAILY_COST_USD"];
  const v = raw === undefined ? Number.NaN : Number(raw);
  if (!Number.isFinite(v) || v <= 0 || v > COPILOT_DAILY_COST_CEILING_USD)
    return COPILOT_DAILY_COST_CEILING_USD;
  return v;
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
