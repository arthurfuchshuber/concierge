import { z } from "zod";

export type HandoffGuestDetail = {
  name: string | null;
  phone: string | null;
  phoneCountry: string | null;
  checkinDate: string | null;
  reservationCode: string | null;
};

export type HandoffConversationSummary = {
  id: string;
  property_id: string | null;
  guest_session_id: string | null;
  guest_name: string | null;
  status: string;
  ai_paused: boolean | null;
  assigned_to: string | null;
  handoff_reason: string | null;
  handoff_urgency: string | null;
  handoff_at: string | null;
  last_message_at: string;
  created_at: string | null;
  resolved_at: string | null;
  properties: { id: string | null; name: string | null; owner_id: string | null; slug: string | null } | null;
};

export type HandoffListResult = {
  conversations: HandoffConversationSummary[];
  details: Record<string, HandoffGuestDetail>;
  error?: string;
};

type RawHandoffRow = {
  id?: unknown;
  property_id?: unknown;
  guest_session_id?: unknown;
  guest_name?: unknown;
  status?: unknown;
  ai_paused?: unknown;
  assigned_to?: unknown;
  handoff_reason?: unknown;
  handoff_urgency?: unknown;
  handoff_at?: unknown;
  last_message_at?: unknown;
  created_at?: unknown;
  resolved_at?: unknown;
  properties?: unknown;
};

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function requiredString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeProperty(value: unknown): HandoffConversationSummary["properties"] {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || typeof raw !== "object") return null;
  const prop = raw as { id?: unknown; name?: unknown; owner_id?: unknown; slug?: unknown };
  return {
    id: nullableString(prop.id),
    name: nullableString(prop.name),
    owner_id: nullableString(prop.owner_id),
    slug: nullableString(prop.slug),
  };
}

export function emptyHandoffListResult(error?: string): HandoffListResult {
  return error ? { conversations: [], details: {}, error } : { conversations: [], details: {} };
}

export function normalizeHandoffConversationRows(rows: RawHandoffRow[] | null | undefined): HandoffConversationSummary[] {
  return (rows ?? []).map((row) => ({
    id: requiredString(row.id),
    property_id: nullableString(row.property_id),
    guest_session_id: nullableString(row.guest_session_id),
    guest_name: nullableString(row.guest_name),
    status: requiredString(row.status, "needs_human"),
    ai_paused: typeof row.ai_paused === "boolean" ? row.ai_paused : null,
    assigned_to: nullableString(row.assigned_to),
    handoff_reason: nullableString(row.handoff_reason),
    handoff_urgency: nullableString(row.handoff_urgency),
    handoff_at: nullableString(row.handoff_at),
    last_message_at: requiredString(row.last_message_at, requiredString(row.created_at, new Date(0).toISOString())),
    created_at: nullableString(row.created_at),
    resolved_at: nullableString(row.resolved_at),
    properties: normalizeProperty(row.properties),
  }));
}

const HandoffListInput = z.object({
  queue: z
    .enum(["needs_human", "assigned_to_me", "all_active", "ai_only", "all", "resolved"])
    .default("needs_human"),
  limit: z.number().int().min(1).max(200).default(50),
});


const HandoffConversationInput = z.object({ conversationId: z.string().uuid() });

const HandoffTransferInput = z.object({
  conversationId: z.string().uuid(),
  toUserId: z.string().uuid(),
});

const HandoffSendInput = z.object({
  conversationId: z.string().uuid(),
  content: z.string().trim().min(1).max(4000),
  internalNote: z.boolean().optional().default(false),
});

export function parseHandoffListInput(input: unknown) {
  return HandoffListInput.parse(input);
}

export function parseHandoffConversationInput(input: unknown) {
  return HandoffConversationInput.parse(input);
}

export function parseHandoffTransferInput(input: unknown) {
  return HandoffTransferInput.parse(input);
}

export function parseHandoffSendInput(input: unknown) {
  return HandoffSendInput.parse(input);
}