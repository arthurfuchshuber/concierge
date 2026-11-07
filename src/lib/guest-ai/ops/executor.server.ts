/**
 * GATE G2 · EXECUTOR das ações operacionais (servidor; nunca lança).
 *
 * Roda depois da geração do Copiloto (D-G2-4: mesma chamada ao modelo, custo novo zero), com a decisão JÁ
 * validada pela cadeia. Lê o estado (somente leitura, `data/ops-state.server.ts`), aplica a política
 * determinística (`ops/policy.ts`) e, conforme `GUEST_AI_OPS_MODE`:
 *  - `live` (ou `on`) — G2c: recusa ⇒ `guest_ai_ops_record` (`refused`); ação aprovada ⇒ `guest_ai_ops_claim`
 *    (reserva idempotente por mensagem + ação: reentrega nunca aplica duas vezes) → escrita no card pela porta
 *    `apply` (fora do módulo, rotinas oficiais do painel) → `guest_ai_ops_finish` (`applied` com a foto depois,
 *    ou `refused` com o motivo da recusa do painel);
 *    Late checkout concedido por atendente humano no chat (`ops/late-checkout.ts`) segue o mesmo caminho, com
 *    a escrita feita por `internal_set_late_checkout` em nome do atendente (o banco confere a permissão);
 *  - `shadow` — só registra (`would_apply`/`refused`), sem escrever em card;
 *  - qualquer outro valor — nada.
 * A resposta ao hóspede continua sendo só a sugestão do Copiloto (D-G2-1); `slot.server.ts` devolve `null`.
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

/** Pedido de escrita entregue à porta `apply` (implementação: `src/lib/guest-ai-ops-apply.server.ts`). */
export type OpsApplyPortRequest =
  | { action: "checkin_done" | "checkout_done"; propertyId: string; reservationId: string }
  | {
      action: "early_departure";
      propertyId: string;
      reservationId: string;
      today: string;
      checkoutDate: string;
    }
  | {
      action: "eta_checkin" | "eta_checkout";
      propertyId: string;
      reservationId: string;
      time: string;
    }
  | {
      /** Late checkout concedido pela equipe: autoria = remetente da mensagem (conferido na porta e no banco). */
      action: "late_checkout";
      propertyId: string;
      reservationId: string;
      conversationId: string;
      staffMessageId: string;
      time: string;
    };
export type OpsApplyPortResult =
  | { ok: true; cardAfter: Record<string, unknown> }
  | {
      ok: false;
      code:
        | "panel_refused"
        | "apply_failed"
        | "staff_prediction_race"
        | "staff_author_unknown"
        | "staff_not_authorized"
        | "late_checkout_rejected";
    };
export type OpsApplyPort = (req: OpsApplyPortRequest) => Promise<OpsApplyPortResult>;

/** Modo efetivo: `live`/`on` ⇒ ação real; `shadow` ⇒ observação; qualquer outro valor ⇒ `off`. */
export function opsMode(env: Env = process.env): OpsMode {
  const v = env[OPS_MODE_ENV];
  if (v === "live" || v === "on") return "live";
  if (v === "shadow") return "shadow";
  return "off";
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
  apply?: OpsApplyPort;
}

export type OpsRunSummary = {
  evaluations: OpsEvaluation[];
  recorded: number;
  applied: number;
  refused: number;
  skipped: number;
  failed: number;
};
export type OpsRunResult =
  | { status: "off" | "no_signal" | "property_not_in_pilot" }
  | ({ status: "done"; mode: "shadow" | "live" } & OpsRunSummary)
  | { status: "error" };

function historyEntries(h: HistoryResult | null): OpsHistoryEntry[] {
  if (!h || h.status !== "available") return [];
  return h.entries.map((e) => ({
    ref: e.ref,
    messageId: e.messageId,
    speaker: e.speaker,
    text: e.text,
    at: e.at,
  }));
}

const ok = (r: { data: unknown; error: unknown }, ...accepted: string[]) => {
  const result = (r.data as { result?: unknown } | null)?.result;
  return !r.error && typeof result === "string" && accepted.includes(result) ? result : null;
};

async function defaultApply(req: OpsApplyPortRequest): Promise<OpsApplyPortResult> {
  const { applyOpsAction } = await import("@/lib/guest-ai-ops-apply.server");
  return await applyOpsAction(req);
}

export async function runOps(input: OpsRunInput, deps: OpsRunDeps = {}): Promise<OpsRunResult> {
  try {
    const env = deps.env ?? process.env;
    const mode = opsMode(env);
    if (mode === "off") return { status: "off" };
    const d = input.decision;
    const history = historyEntries(input.history);
    // sinal do modelo, ou mensagem da equipe no histórico (possível late checkout concedido)
    if (
      !d.hospitalityMilestone &&
      !(d.guestEtas ?? []).length &&
      !history.some((e) => e.speaker === "team")
    )
      return { status: "no_signal" };
    if (!opsPropertyAllowed(input.turn.propertyId, env)) return { status: "property_not_in_pilot" };

    const now = (deps.now ?? (() => new Date()))();
    const state = await (deps.loadState ?? ((t) => fetchOpsState(t)))(input.turn);
    const evaluations = evaluateOpsSignals({
      decision: d,
      history,
      phase: input.phase,
      timezone: input.timezone,
      now,
      reservation: state.reservation,
      conversation: state.conversation,
      cards: state.cards,
      property: state.property,
      defaultHandoffReason: NO_AI_HANDOFF_REASON,
    });
    if (evaluations.length === 0) return { status: "no_signal" };
    const rpc = deps.rpc ?? (await getGuestAiOpsRpc());
    const apply = deps.apply ?? defaultApply;
    const scope = {
      p_tenant_id: input.turn.tenantId,
      p_property_id: input.turn.propertyId,
      p_conversation_id: input.turn.conversationId,
      p_trigger_message_id: input.turn.messageId,
      p_reservation_id: state.reservation?.id ?? null,
      p_suggestion_id: input.suggestionId,
    };
    const summary: OpsRunSummary = {
      evaluations,
      recorded: 0,
      applied: 0,
      refused: 0,
      skipped: 0,
      failed: 0,
    };

    for (const ev of evaluations) {
      const signal = {
        p_action: ev.action,
        p_evidence_message_id: ev.evidenceMessageId,
        p_proposed_date: ev.proposedDate,
        p_proposed_time: ev.proposedTime,
        p_madrugada: ev.madrugada,
        p_card_before: ev.cardBefore ? { exists: true, ...ev.cardBefore } : { exists: false },
      };
      // observação, ou recusa da política em qualquer modo: só registro
      if (mode === "shadow" || ev.outcome === "refused") {
        const r = await rpc.call("guest_ai_ops_record", {
          ...scope,
          ...signal,
          p_mode: mode,
          p_outcome: ev.outcome,
          p_code: ev.code,
        });
        if (ok(r, "recorded", "exists")) {
          summary.recorded += 1;
          if (ev.outcome === "refused") summary.refused += 1;
        } else summary.failed += 1;
        continue;
      }

      // live + aprovada: reserva ANTES de escrever (nunca duas vezes para a mesma mensagem + ação)
      const reservationId = state.reservation?.id;
      if (!reservationId) {
        summary.failed += 1;
        continue;
      }
      const claim = await rpc.call("guest_ai_ops_claim", {
        p_tenant_id: scope.p_tenant_id,
        p_property_id: scope.p_property_id,
        p_conversation_id: scope.p_conversation_id,
        p_trigger_message_id: scope.p_trigger_message_id,
        p_reservation_id: reservationId,
        p_suggestion_id: scope.p_suggestion_id,
        ...signal,
      });
      const claimed = ok(claim, "claimed", "exists");
      if (claimed === "exists") {
        summary.skipped += 1;
        continue;
      }
      const id = (claim.data as { id?: unknown } | null)?.id;
      if (!claimed || typeof id !== "string") {
        summary.failed += 1;
        continue;
      }
      const req: OpsApplyPortRequest =
        ev.action === "eta_checkin" || ev.action === "eta_checkout"
          ? {
              action: ev.action,
              propertyId: input.turn.propertyId,
              reservationId,
              time: ev.proposedTime!,
            }
          : ev.action === "late_checkout"
            ? {
                action: "late_checkout",
                propertyId: input.turn.propertyId,
                reservationId,
                conversationId: input.turn.conversationId,
                staffMessageId: ev.evidenceMessageId!,
                time: ev.proposedTime!,
              }
            : ev.action === "early_departure"
              ? {
                  action: "early_departure",
                  propertyId: input.turn.propertyId,
                  reservationId,
                  today: ev.proposedDate!,
                  checkoutDate: state.reservation!.checkoutDate!,
                }
              : {
                  action: ev.action as "checkin_done" | "checkout_done",
                  propertyId: input.turn.propertyId,
                  reservationId,
                };
      let res: OpsApplyPortResult;
      try {
        res = await apply(req);
      } catch {
        res = { ok: false, code: "apply_failed" };
      }
      const fin = await rpc.call("guest_ai_ops_finish", {
        p_id: id,
        p_outcome: res.ok ? "applied" : "refused",
        p_code: res.ok ? null : res.code,
        p_card_after: res.ok ? res.cardAfter : null,
      });
      if (res.ok) summary.applied += 1;
      else summary.refused += 1;
      if (!ok(fin, "finished")) summary.failed += 1;
    }
    if (summary.failed) console.warn("[guest-ai:ops] auditoria incompleta", summary.failed);
    return { status: "done", mode, ...summary };
  } catch {
    console.error("[guest-ai:ops] falha interna");
    return { status: "error" };
  }
}
