/**
 * Fixtures da B2.5: portas operacionais completas (o harness passivo exige todas), fontes de
 * identidade de envio, lotes de mensagens e decisões v4. Tudo sintético; nada de produção.
 */
import type { ShadowHarnessDeps } from "@/lib/guest-ai/shadow/harness";
import type { ConversationOwnershipRow } from "@/lib/guest-ai/orchestrator/case-ownership";
import type { SenderIdentitySource } from "@/lib/guest-ai/policy/sender-identity";
import type { StayCardRow } from "@/lib/guest-ai/policy/stay-authorizations";
import { buildGuestMessageBatch, type BatchMessageInput, type GuestMessageBatch } from "@/lib/guest-ai/batch/message-batch";
import { normalizeHistory } from "@/lib/guest-ai/history";
import { CONV, MSG, ctx, history } from "./b23-chain";
import { row } from "./b21-fixtures";

export const TENANT = "t1";
export const PROPERTY = "p1";
export const LISTING = "1001";
export const TWIN = "1002";
export const CH_PREF = "ch-pref";
export const CH_MAPPED = "ch-mapped";

/** Conversa sem chamado e sem pausa. */
export const ownershipRow = (over: Partial<ConversationOwnershipRow> = {}): ConversationOwnershipRow => ({
  id: CONV,
  status: "ai",
  assigned_to: null,
  handoff_reason: null,
  handoff_urgency: null,
  handoff_at: null,
  resolved_at: null,
  ai_paused: false,
  paused_until: null,
  ...over,
});

export const R6 = { late_checkout_time: "13:00", late_checkout_approved_at: "2026-11-02T15:00:00Z", late_checkout_by: "00000000-0000-4000-8000-0000000000aa" };
export const stayCard = (over: Partial<StayCardRow> = {}): StayCardRow => ({ kind: "checkout", status: "pending", property_id: PROPERTY, reservation_id: "r1", ...over });
export const staySource = (cards: StayCardRow[] = []) => ({
  reservation: { id: "r1", property_id: PROPERTY, status: "confirmed", checkin_date: "2026-11-04", checkout_date: "2026-11-07" },
  stayReservationIds: [],
  property: { timezone: "America/Sao_Paulo", checkOutTime: "11:00" },
  cards,
});

/** Fonte de identidade de envio coerente: anúncio + gêmeo do mesmo imóvel, preferência e contas do tenant. */
export const senderSource = (over: Partial<SenderIdentitySource> = {}): SenderIdentitySource => ({
  lookup: "ok",
  conversationListingId: LISTING,
  reservationListingId: null,
  listings: [{ airbnb_listing_id: LISTING, property_id: PROPERTY, owner_id: TENANT, channex_channel_id: CH_MAPPED }],
  twins: [{ owner_id: TENANT, property_id: PROPERTY, primary_listing_id: LISTING, twin_listing_id: TWIN, status: "active" }],
  prefs: [
    { channex_id: LISTING, payload: { owner_id: TENANT, channel_id: CH_PREF, updated_at: "2026-11-01T00:00:00Z" } },
    { channex_id: TWIN, payload: { owner_id: TENANT, channel_id: CH_PREF, updated_at: "2026-11-01T00:00:00Z" } },
  ],
  accounts: [
    { owner_id: TENANT, channex_channel_id: CH_PREF, status: "active" },
    { owner_id: TENANT, channex_channel_id: CH_MAPPED, status: "active" },
  ],
  ...over,
});

/** Todas as portas de leitura exigidas pelo harness, com dados benignos por padrão. */
export function operationalPorts(over: Partial<ShadowHarnessDeps["ports"]> = {}): ShadowHarnessDeps["ports"] {
  return {
    loadContext: async () => ctx(),
    loadHistory: async () => history(),
    loadDossiers: async () => null,
    loadStayAuthorizationSource: async () => staySource(),
    loadConversationOwnership: async () => ownershipRow(),
    loadSenderIdentitySource: async () => senderSource(),
    // B3.2 — pausa derivada: sem intervenção humana recente (benigno).
    loadHumanPause: async () => ({ lookup: "ok", column: { ai_paused: false, paused_until: null }, persisted: [], persistedComplete: true, raw: [], rawComplete: true, allowedSourcePropertyIds: null }),
    ...over,
  };
}

/** Mensagem de lote do hóspede (escopo padrão do turno de teste). */
export const batchMsg = (id: string, text: string, createdAt: string, over: Partial<BatchMessageInput> = {}): BatchMessageInput => ({
  id,
  conversationId: CONV,
  propertyId: PROPERTY,
  tenantId: TENANT,
  channel: "web",
  senderRole: "guest",
  senderId: "wa:5511988887777",
  text,
  createdAt,
  ...over,
});
export const BATCH_SCOPE = { conversationId: CONV, propertyId: PROPERTY, tenantId: TENANT, channel: "web" as const, senderId: "wa:5511988887777" };

export const M1 = "aaaaaaaa-0000-4000-8000-000000000001";
export const M2 = "aaaaaaaa-0000-4000-8000-000000000002";
export const M3 = "aaaaaaaa-0000-4000-8000-000000000003";

/** Lote de 4 mensagens terminando na mensagem do turno (MSG) + histórico coerente. */
export function burst(texts: [string, string, string, string] = ["Oi", "Tenho uma dúvida", "O estacionamento é coberto?", "E cabe uma caminhonete?"]): { batch: GuestMessageBatch; historyResult: ReturnType<typeof normalizeHistory> } {
  const ids = [M1, M2, M3, MSG];
  const times = ["2026-11-03T10:00:00.000Z", "2026-11-03T10:00:04.000Z", "2026-11-03T10:00:09.000Z", "2026-11-03T10:00:15.000Z"];
  const r = buildGuestMessageBatch({ scope: BATCH_SCOPE, messages: ids.map((id, i) => batchMsg(id, texts[i]!, times[i]!)), alreadyAnswered: [], closed: true });
  if (!r.ok) throw new Error(r.reason);
  const historyResult = normalizeHistory(
    [
      row({ created_at: "2026-11-03T09:00:00Z", role: "assistant", sender_type: "human", content: "Bem-vindos!" }),
      ...ids.map((id, i) => row({ id, created_at: times[i]!, content: texts[i]! })),
    ],
    { conversationId: CONV, currentMessageId: MSG },
  );
  return { batch: r.batch, historyResult };
}
