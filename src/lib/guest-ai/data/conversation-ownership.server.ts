/**
 * F2-B · B3.3 — Loader REAL do atendimento humano da conversa (porta `loadConversationOwnership`).
 *
 * Fonte verificável: `property_chat_conversations` (projeção `CONVERSATION_OWNERSHIP_COLUMNS` +
 * `property_id`) e o dono do imóvel em `properties`. Só leitura, `ValidatedTurn` obrigatório, sinal de
 * cancelamento em toda consulta. Nada é simulado nem filtrado: o resultado DISTINGUE
 *  - `identified`  — atendimento humano ativo sobre algum assunto (nunca bloqueio global; ver AGENTS);
 *  - `none`        — ausência COMPROVADA (status conhecido e fechado);
 *  - `indeterminate` — status desconhecido ou pausa ilegível;
 *  - `read_failed` — erro/cancelamento de leitura (nunca vira "sem posse");
 *  - `tenant_mismatch` / `property_mismatch` / `identity_inconsistent` — divergências (bloqueio GLOBAL).
 * O worker bloqueia tudo que não for `identified` ou `none` e entrega à cadeia só a linha conferida.
 */
import { assertIssued } from "@/lib/guest-ai/trust";
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import { deriveHumanOwnership, type ConversationOwnershipRow } from "@/lib/guest-ai/orchestrator/case-ownership";
import { abortableDb, getGuestAiDb, throwIfAborted, type GuestAiDb } from "./client.server";
import { CONVERSATION_OWNERSHIP_COLUMNS, cols } from "./projections";

export const OWNERSHIP_LOADER_COLUMNS = [...CONVERSATION_OWNERSHIP_COLUMNS, "property_id"] as const;
export const OWNERSHIP_PROPERTY_COLUMNS = ["id", "owner_id"] as const;

export type OwnershipLoad =
  | { status: "identified" | "none"; row: ConversationOwnershipRow }
  | { status: "indeterminate" }
  | { status: "read_failed" }
  | { status: "tenant_mismatch" }
  | { status: "property_mismatch" }
  | { status: "identity_inconsistent" };

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export async function loadConversationOwnership(turn: ValidatedTurn, deps: { db?: GuestAiDb; signal?: AbortSignal; nowIso: string }): Promise<OwnershipLoad> {
  assertIssued("turn", turn, "data_requires_validated_turn");
  try {
    throwIfAborted(deps.signal);
    const db = abortableDb(deps.db ?? (await getGuestAiDb()), deps.signal);
    const conv = await db.from("property_chat_conversations").select(cols(OWNERSHIP_LOADER_COLUMNS)).eq("id", turn.conversationId).limit(2);
    if (conv.error || !Array.isArray(conv.data)) return { status: "read_failed" };
    if (conv.data.length !== 1) return { status: "identity_inconsistent" };
    const r = conv.data[0] as Record<string, unknown>;
    if (r.id !== turn.conversationId) return { status: "identity_inconsistent" };
    if (r.property_id !== turn.propertyId) return { status: "property_mismatch" };
    throwIfAborted(deps.signal);
    const prop = await db.from("properties").select(cols(OWNERSHIP_PROPERTY_COLUMNS)).eq("id", turn.propertyId).limit(2);
    if (prop.error || !Array.isArray(prop.data)) return { status: "read_failed" };
    if (prop.data.length !== 1 || (prop.data[0] as Record<string, unknown>).id !== turn.propertyId) return { status: "identity_inconsistent" };
    if ((prop.data[0] as Record<string, unknown>).owner_id !== turn.tenantId) return { status: "tenant_mismatch" };
    const row: ConversationOwnershipRow = Object.freeze({
      id: turn.conversationId,
      status: str(r.status),
      assigned_to: str(r.assigned_to),
      handoff_reason: str(r.handoff_reason),
      handoff_urgency: str(r.handoff_urgency),
      handoff_at: str(r.handoff_at),
      resolved_at: str(r.resolved_at),
      // valor bruto: `deriveHumanOwnership` trata tipo inesperado como pausa ILEGÍVEL (⇒ indeterminado)
      ai_paused: r.ai_paused as boolean | null,
      paused_until: r.paused_until as string | null,
    });
    const snap = deriveHumanOwnership(row, deps.nowIso);
    if (snap.state === "unknown") return { status: "indeterminate" };
    return { status: snap.active ? "identified" : "none", row };
  } catch {
    return { status: "read_failed" };
  }
}
