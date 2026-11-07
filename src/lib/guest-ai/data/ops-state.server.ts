/**
 * GATE G2 · ESTADO para a política das ações operacionais (somente leitura, projeções próprias).
 *
 * Tudo derivado do turno validado: imóvel, conta e reserva vêm do `ValidatedTurn`; a reserva só vale se
 * existir E for do mesmo imóvel (sem vínculo por data ou nome). Lê: a conversa (travas da equipe), a
 * reserva vinculada, os cards de chegada/saída dessa reserva e os limites oficiais de horário do imóvel.
 * Falha de leitura ⇒ `null` no campo (a política recusa com `state_unavailable`). Nada é escrito aqui.
 */
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import { assertIssued } from "@/lib/guest-ai/trust";
import type {
  OpsCardState,
  OpsConversationState,
  OpsPropertyTimes,
  OpsReservationState,
} from "@/lib/guest-ai/ops/contracts";
import { abortableDb, getGuestAiDb, throwIfAborted, type GuestAiDb } from "./client.server";
import {
  CONVERSATION_OWNERSHIP_COLUMNS,
  OPS_CARD_COLUMNS,
  OPS_PROPERTY_TIME_COLUMNS,
  RESERVATION_COLUMNS,
  cols,
} from "./projections";

export interface OpsState {
  conversation: OpsConversationState | null;
  reservation: OpsReservationState | null;
  cards: { checkin: OpsCardState | null; checkout: OpsCardState | null } | null;
  property: OpsPropertyTimes | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

function card(row: Record<string, unknown> | undefined): OpsCardState | null {
  if (!row) return null;
  return {
    status: str(row["status"]),
    doneAt: str(row["done_at"]),
    arrivalTimeOverride: str(row["arrival_time_override"]),
    arrivalTimeSource: str(row["arrival_time_source"]),
    mutedUntil: str(row["muted_until"]),
    lateCheckoutTime: str(row["late_checkout_time"]),
    lateCheckoutApprovedAt: str(row["late_checkout_approved_at"]),
  };
}

export async function fetchOpsState(
  turn: ValidatedTurn,
  deps: { db?: GuestAiDb; signal?: AbortSignal } = {},
): Promise<OpsState> {
  assertIssued("turn", turn, "data_requires_validated_turn");
  throwIfAborted(deps.signal);
  const db = abortableDb(deps.db ?? (await getGuestAiDb()), deps.signal);
  const out: OpsState = { conversation: null, reservation: null, cards: null, property: null };

  const conv = await db
    .from("property_chat_conversations")
    .select(cols(CONVERSATION_OWNERSHIP_COLUMNS))
    .eq("id", turn.conversationId)
    .eq("property_id", turn.propertyId)
    .maybeSingle();
  if (!conv.error && conv.data) {
    const c = conv.data as Record<string, unknown>;
    out.conversation = {
      status: str(c["status"]),
      assignedTo: str(c["assigned_to"]),
      handoffReason: str(c["handoff_reason"]),
      handoffUrgency: str(c["handoff_urgency"]),
      aiPaused: typeof c["ai_paused"] === "boolean" ? (c["ai_paused"] as boolean) : null,
      pausedUntil: str(c["paused_until"]),
    };
  }

  const prop = await db
    .from("properties")
    .select(cols(OPS_PROPERTY_TIME_COLUMNS))
    .eq("id", turn.propertyId)
    .maybeSingle();
  if (
    !prop.error &&
    prop.data &&
    (prop.data as Record<string, unknown>)["owner_id"] === turn.tenantId
  ) {
    const p = prop.data as Record<string, unknown>;
    out.property = {
      checkinTime: str(p["checkin_time"]),
      checkinTimeMax: str(p["checkin_time_max"]),
      checkoutTime: str(p["checkout_time"]),
      checkoutTimeMin: str(p["checkout_time_min"]),
    };
  }

  if (!turn.reservationId) return out;
  const res = await db
    .from("property_reservations")
    .select(cols(RESERVATION_COLUMNS))
    .eq("id", turn.reservationId)
    .eq("property_id", turn.propertyId)
    .maybeSingle();
  if (res.error) return out;
  if (!res.data) return out;
  const r = res.data as Record<string, unknown>;
  out.reservation = {
    id: String(r["id"]),
    status: str(r["status"]),
    checkinDate: str(r["checkin_date"]),
    checkoutDate: str(r["checkout_date"]),
  };

  const cards = await db
    .from("guest_arrival_status")
    .select(cols(OPS_CARD_COLUMNS))
    .eq("reservation_id", turn.reservationId)
    .eq("property_id", turn.propertyId);
  if (!cards.error && Array.isArray(cards.data)) {
    const rows = cards.data as Array<Record<string, unknown>>;
    out.cards = {
      checkin: card(rows.find((x) => x["kind"] === "checkin")),
      checkout: card(rows.find((x) => x["kind"] === "checkout")),
    };
  }
  return out;
}
