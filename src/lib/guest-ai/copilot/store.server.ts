/**
 * COPILOTO — adaptador das RPCs de GERAÇÃO (porta fechada `COPILOT_RPC_FUNCTIONS` de `data/client.server.ts`;
 * EXECUTE só service_role). Nenhuma escrita direta em tabela. Resultados são lidos pelo vocabulário fechado
 * da migration; qualquer resposta fora do esperado vira `error` (fail-closed).
 */
import type { GuestAiCopilotRpc } from "@/lib/guest-ai/data/client.server";
import type { CopilotOutcomeKind, CopilotState, CopilotWarning } from "./contracts";

export interface CopilotClaimInput {
  tenantId: string;
  propertyId: string;
  conversationId: string;
  triggerMessageId: string;
  surface: string;
  /** `null` ⇒ sem teto diário. */
  dailyCostLimitUsd: number;
  turnCostCeilingUsd: number;
}

export type CopilotClaimResult =
  | { kind: "claimed"; suggestionId: string; attempt: number; reclaimed: boolean }
  | { kind: "exists"; suggestionId: string; state: CopilotState }
  | { kind: "daily_budget_exceeded"; suggestionId: string }
  | { kind: "invalid"; reason: string }
  | { kind: "error" };

export interface CopilotResultInput {
  suggestionId: string;
  attempt: number;
  state: "available" | "no_suggestion" | "generation_failed";
  text: string | null;
  internalQuestion: string | null;
  intents: readonly string[];
  strategy: string | null;
  handoffNeeded: boolean;
  handoffUrgency: string | null;
  outcomeKind: CopilotOutcomeKind | null;
  outcomeCode: string | null;
  warnings: readonly CopilotWarning[];
  context: {
    stayPhase: string | null;
    reservationLinked: boolean | null;
    historyMessages: number | null;
    dossierEntries: number | null;
    credentialPolicy: "allow" | "deny" | null;
    senderIdentity: string | null;
    humanInCommand: boolean | null;
  };
  gateway: {
    modelId: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    costUsd: number;
    latencyMs: number | null;
    error: string | null;
  };
}

export type CopilotStoreResult =
  | { kind: "stored" }
  | { kind: "stale" }
  | { kind: "missing" }
  | { kind: "invalid"; reason: string }
  | { kind: "error" };

export interface CopilotStore {
  claim(input: CopilotClaimInput): Promise<CopilotClaimResult>;
  /** Estado atual (conferido imediatamente antes de chamar o Gateway). `missing` quando a linha sumiu. */
  state(suggestionId: string): Promise<{ state: CopilotState | "missing"; attempt: number } | null>;
  store(input: CopilotResultInput): Promise<CopilotStoreResult>;
}

type J = Record<string, unknown>;
const obj = (v: unknown): J | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as J) : null;
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const int = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v)
    ? v
    : typeof v === "string" && /^\d+$/.test(v)
      ? Number(v)
      : null;

export function createCopilotStore(rpc: GuestAiCopilotRpc): CopilotStore {
  return {
    async claim(i) {
      const res = await rpc.call("copilot_claim_generation", {
        p_tenant_id: i.tenantId,
        p_property_id: i.propertyId,
        p_conversation_id: i.conversationId,
        p_trigger_message_id: i.triggerMessageId,
        p_surface: i.surface,
        p_daily_cost_limit_usd: i.dailyCostLimitUsd,
        p_turn_cost_ceiling_usd: i.turnCostCeilingUsd,
      });
      const d = obj(res.data);
      if (res.error || !d) return { kind: "error" };
      const id = str(d["suggestion_id"]);
      switch (d["result"]) {
        case "claimed":
          return id && int(d["generation_attempts"]) !== null
            ? {
                kind: "claimed",
                suggestionId: id,
                attempt: int(d["generation_attempts"])!,
                reclaimed: d["reclaimed"] === true,
              }
            : { kind: "error" };
        case "exists":
          return id && str(d["state"])
            ? { kind: "exists", suggestionId: id, state: str(d["state"]) as CopilotState }
            : { kind: "error" };
        case "daily_budget_exceeded":
          return id ? { kind: "daily_budget_exceeded", suggestionId: id } : { kind: "error" };
        case "invalid":
          return { kind: "invalid", reason: str(d["reason"]) ?? "unknown" };
        default:
          return { kind: "error" };
      }
    },
    async state(suggestionId) {
      const res = await rpc.call("copilot_generation_state", { p_suggestion_id: suggestionId });
      const d = obj(res.data);
      if (res.error || !d) return null;
      const s = str(d["state"]);
      const a = int(d["generation_attempts"]);
      return s && a !== null ? { state: s as CopilotState | "missing", attempt: a } : null;
    },
    async store(i) {
      const res = await rpc.call("copilot_store_result", {
        p_suggestion_id: i.suggestionId,
        p_attempt: i.attempt,
        p_state: i.state,
        p_text: i.text,
        p_internal_question: i.internalQuestion,
        p_intents: [...i.intents],
        p_strategy: i.strategy,
        p_handoff_needed: i.handoffNeeded,
        p_handoff_urgency: i.handoffUrgency,
        p_outcome_kind: i.outcomeKind,
        p_outcome_code: i.outcomeCode,
        p_warnings: [...i.warnings],
        p_context_stay_phase: i.context.stayPhase,
        p_context_reservation_linked: i.context.reservationLinked,
        p_context_history_messages: i.context.historyMessages,
        p_context_dossier_entries: i.context.dossierEntries,
        p_context_credential_policy: i.context.credentialPolicy,
        p_context_sender_identity: i.context.senderIdentity,
        p_context_human_in_command: i.context.humanInCommand,
        p_model_id: i.gateway.modelId,
        p_input_tokens: i.gateway.inputTokens,
        p_output_tokens: i.gateway.outputTokens,
        p_cost_usd: i.gateway.costUsd,
        p_latency_ms: i.gateway.latencyMs,
        p_gateway_error: i.gateway.error,
      });
      const d = obj(res.data);
      if (res.error || !d) return { kind: "error" };
      switch (d["result"]) {
        case "stored":
          return { kind: "stored" };
        case "stale":
          return { kind: "stale" };
        case "missing":
          return { kind: "missing" };
        case "invalid":
          return { kind: "invalid", reason: str(d["reason"]) ?? "unknown" };
        default:
          return { kind: "error" };
      }
    },
  };
}
