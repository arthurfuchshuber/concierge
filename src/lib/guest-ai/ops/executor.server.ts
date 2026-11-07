/**
 * GATE G2a · EXECUTOR das ações operacionais — MODO DE OBSERVAÇÃO (servidor; nunca lança).
 *
 * Roda depois da geração do Copiloto (D-G2-4: mesma chamada ao modelo, custo novo zero), com a decisão
 * JÁ validada pela cadeia. Lê o estado (somente leitura, `data/ops-state.server.ts`), aplica a política
 * determinística (`ops/policy.ts`) e REGISTRA cada avaliação em `guest_ai_ops_actions` pela RPC
 * `guest_ai_ops_record` (service_role, idempotente por mensagem + ação).
 *
 * Nesta etapa NADA é escrito nos cards: não há chamada a `runAdvanceArrival` nem gravação de previsão.
 * `GUEST_AI_OPS_MODE` aceita só `shadow`; qualquer outro valor (inclusive `on`) é `off`. A resposta ao
 * hóspede continua sendo só a sugestão do Copiloto (D-G2-1); `slot.server.ts` segue devolvendo `null`.
 * Logs só com códigos fechados — nunca texto do hóspede ou do modelo.
 */
import type { HistoryResult } from "@/lib/guest-ai/history";
import type { ModelDecision } from "@/lib/guest-ai/orchestrator/contracts";
import { NO_AI_HANDOFF_REASON } from "@/lib/guest-ai/slot.server";
import type { StayPhase, ValidatedTurn } from "@/lib/guest-ai/types";
import { getGuestAiOpsRpc, type GuestAiOpsRpc } from "@/lib/guest-ai/data/client.server";
import { fetchOpsState, type OpsState } from "@/lib/guest-ai/data/ops-state.server";
import { OPS_MODE_ENV, OPS_PROPERTIES_ENV, type OpsEvaluation, type OpsMode } from "./contracts";
import { evaluateOpsSignals, type OpsHistoryEntry } from "./policy";

type Env = Record<string, string | undefined>;

/** Modo efetivo: só o literal `shadow` liga a observação. `on` não existe na G2a ⇒ `off`. */
export function opsMode(env: Env = process.env): OpsMode {
  return env[OPS_MODE_ENV] === "shadow" ? "shadow" : "off";
}

/** Piloto opcional por imóvel (lista separada por vírgula); vazia/ausente ⇒ todos. */
export function opsPropertyAllowed(propertyId: string, env: Env = process.env): boolean {
  const raw = (env[OPS_PROPERTIES_ENV] ?? "").trim();
  if (!raw) return true;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(propertyId);
}

export interface OpsRunInput {
  turn: ValidatedTurn;
  decision: ModelDecision;
  history: HistoryResult | null;
  phase: StayPhase;
  timezone: string | null;
  suggestionId: string | null;
}

export interface OpsRunDeps {
  env?: Env;
  now?: () => Date;
  loadState?: (turn: ValidatedTurn) => Promise<OpsState>;
  rpc?: GuestAiOpsRpc;
}

export type OpsRunResult =
  | { status: "off" | "no_signal" | "property_not_in_pilot" }
  | { status: "recorded"; evaluations: OpsEvaluation[]; recorded: number; failed: number }
  | { status: "error" };

function historyEntries(h: HistoryResult | null): OpsHistoryEntry[] {
  if (!h || h.status !== "available") return [];
  return h.entries.map((e) => ({
    ref: e.ref,
    messageId: e.messageId,
    speaker: e.speaker,
    text: e.text,
  }));
}

export async function runOpsShadow(
  input: OpsRunInput,
  deps: OpsRunDeps = {},
): Promise<OpsRunResult> {
  try {
    const env = deps.env ?? process.env;
    if (opsMode(env) !== "shadow") return { status: "off" };
    const d = input.decision;
    if (!d.hospitalityMilestone && !(d.guestEtas ?? []).length) return { status: "no_signal" };
    if (!opsPropertyAllowed(input.turn.propertyId, env)) return { status: "property_not_in_pilot" };

    const state = await (deps.loadState ?? ((t) => fetchOpsState(t)))(input.turn);
    const evaluations = evaluateOpsSignals({
      decision: d,
      history: historyEntries(input.history),
      phase: input.phase,
      timezone: input.timezone,
      now: (deps.now ?? (() => new Date()))(),
      reservation: state.reservation,
      conversation: state.conversation,
      cards: state.cards,
      property: state.property,
      defaultHandoffReason: NO_AI_HANDOFF_REASON,
    });
    const rpc = deps.rpc ?? (await getGuestAiOpsRpc());
    let recorded = 0;
    let failed = 0;
    for (const ev of evaluations) {
      const r = await rpc.call("guest_ai_ops_record", {
        p_tenant_id: input.turn.tenantId,
        p_property_id: input.turn.propertyId,
        p_conversation_id: input.turn.conversationId,
        p_trigger_message_id: input.turn.messageId,
        p_reservation_id: state.reservation?.id ?? null,
        p_suggestion_id: input.suggestionId,
        p_action: ev.action,
        p_mode: "shadow",
        p_outcome: ev.outcome,
        p_code: ev.code,
        p_evidence_message_id: ev.evidenceMessageId,
        p_proposed_date: ev.proposedDate,
        p_proposed_time: ev.proposedTime,
        p_madrugada: ev.madrugada,
        p_card_before: ev.cardBefore ? { exists: true, ...ev.cardBefore } : { exists: false },
      });
      const result = (r.data as { result?: unknown } | null)?.result;
      if (!r.error && (result === "recorded" || result === "exists")) recorded += 1;
      else failed += 1;
    }
    if (failed) console.warn("[guest-ai:ops] registro incompleto", failed);
    return { status: "recorded", evaluations, recorded, failed };
  } catch {
    console.error("[guest-ai:ops] falha interna (sem efeito em card)");
    return { status: "error" };
  }
}
