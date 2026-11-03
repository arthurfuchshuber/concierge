/**
 * F2-B · B2.5 — RESOLUÇÃO DETERMINÍSTICA da identidade de envio (conta/canal remetente). Pura.
 *
 * Espelha as fontes reais do SaaS (inspecionadas em 03/11/2026, sem alterá-las):
 *  - preferência do anfitrião: `channex_raw_records` com `entity_type = 'airbnb_sender_pref'`,
 *    `channex_id = <id do anúncio Airbnb>`, `payload = { owner_id, channel_id, updated_by, updated_at }`
 *    (gravada por `writeSenderPrefs`, lida por `readSenderPrefs` em `airbnb-direct-sender.server.ts`);
 *  - grupo do anúncio: anúncio principal (`property_listing_raw_data.airbnb_listing_id`) + gêmeos
 *    ativos (`channex_twin_links.primary_listing_id/twin_listing_id`). `switchListingSender` grava a
 *    MESMA preferência para todo o grupo — então divergência dentro do grupo é inconsistência;
 *  - contas do tenant: `airbnb_accounts (owner_id, channex_channel_id, status)`;
 *  - conta mapeada do anúncio (envio padrão pela Channex): `property_listing_raw_data.channex_channel_id`.
 *
 * Diferença deliberada em relação ao envio atual do SaaS: lá, falha da conta preferida cai no envio
 * padrão pela Channex. AQUI isso é proibido (diretriz B2.5 §3.3, item 7): preferência existente que
 * não valida NÃO cai para outra conta — o resultado é `unavailable`/`invalid`, e qualquer preparação
 * de envio fica bloqueada. Sem preferência configurada, a conta mapeada do anúncio é a identidade
 * determinística (fonte explícita `listing_mapped_channel`), validada como qualquer outra.
 *
 * Identidade RESOLVIDA e VALIDADA ≠ autorização de envio ≠ envio executado. Este módulo só faz as
 * duas primeiras; `sendAuthorization` é sempre `not_granted` e `delivery` sempre `not_sent`.
 * Nunca usa nome, assinatura, texto da conversa ou papel presumido. O modelo não participa.
 */
import type { GuestSurface } from "@/lib/guest-ai/types";

export const SENDER_IDENTITY_VERSION = "sender-identity.2026-11-03.1";
export const SENDER_PREF_ENTITY = "airbnb_sender_pref";

export const SENDER_IDENTITY_REASONS = [
  "lookup_failed",
  "surface_not_airbnb",
  "listing_unidentified",
  "listing_other_tenant",
  "listing_property_mismatch",
  "reservation_listing_mismatch",
  "twin_inconsistent",
  "preference_invalid",
  "preference_other_tenant",
  "preference_conflict",
  "multiple_mapped_channels",
  "no_channel",
  "channel_not_owned",
  "channel_other_tenant",
  "channel_inactive",
] as const;
export type SenderIdentityReason = (typeof SENDER_IDENTITY_REASONS)[number];

interface Common {
  version: string;
  /** Resolver identidade NÃO autoriza enviar. Sempre `not_granted` na B2.5. */
  sendAuthorization: "not_granted";
  delivery: "not_sent";
}

export type SenderIdentity =
  | (Common & {
      status: "resolved";
      validation: "validated";
      senderChannelId: string;
      source: "host_preference" | "listing_mapped_channel";
      listingId: string;
      primaryListingId: string;
      resolvedAt: string;
      reason: null;
    })
  | (Common & {
      status: "unavailable" | "ambiguous" | "invalid" | "not_applicable";
      validation: "not_validated";
      senderChannelId: null;
      source: null;
      listingId: string | null;
      primaryListingId: string | null;
      resolvedAt: null;
      reason: SenderIdentityReason;
    });

export interface SenderIdentitySource {
  lookup: "ok" | "failed";
  /** Anúncio Airbnb da conversa (fonte confiável do chamador: thread/conversa). */
  conversationListingId: string | null;
  /** Anúncio da reserva, quando conhecido (para conferir coerência). */
  reservationListingId: string | null;
  listings: ReadonlyArray<{ airbnb_listing_id: string | null; property_id: string | null; owner_id: string | null; channex_channel_id: string | null }>;
  twins: ReadonlyArray<{ owner_id: string | null; property_id: string | null; primary_listing_id: string | null; twin_listing_id: string | null; status: string | null }>;
  prefs: ReadonlyArray<{ channex_id: string | null; payload: { owner_id?: unknown; channel_id?: unknown; updated_at?: unknown } | null }>;
  accounts: ReadonlyArray<{ owner_id: string | null; channex_channel_id: string | null; status: string | null }>;
}

export interface SenderIdentityInput {
  /** Identidade do TURNO validado (nunca do modelo). */
  tenantId: string;
  propertyId: string;
  surface: GuestSurface;
  source: SenderIdentitySource;
  now: string;
}

const base: Common = { version: SENDER_IDENTITY_VERSION, sendAuthorization: "not_granted", delivery: "not_sent" };
const fail = (
  status: "unavailable" | "ambiguous" | "invalid" | "not_applicable",
  reason: SenderIdentityReason,
  listingId: string | null = null,
  primaryListingId: string | null = null,
): SenderIdentity => ({ ...base, status, validation: "not_validated", senderChannelId: null, source: null, listingId, primaryListingId, resolvedAt: null, reason });

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export function resolveSenderIdentity(i: SenderIdentityInput): SenderIdentity {
  if (!i || i.surface !== "airbnb") return fail("not_applicable", "surface_not_airbnb");
  const src = i.source;
  if (!src || src.lookup !== "ok") return fail("unavailable", "lookup_failed");
  const listingId = str(src.conversationListingId);
  if (!listingId) return fail("unavailable", "listing_unidentified");

  // 1) Anúncio → anúncio principal (direto ou via gêmeo ATIVO), sempre do tenant e do imóvel do turno.
  const asPrimary = src.listings.filter((l) => str(l.airbnb_listing_id) === listingId);
  const asTwin = src.twins.filter((t) => str(t.twin_listing_id) === listingId && t.status === "active");
  if (asPrimary.some((l) => l.owner_id !== i.tenantId) || asTwin.some((t) => t.owner_id !== i.tenantId)) return fail("invalid", "listing_other_tenant", listingId);
  let primaryListingId: string | null = null;
  if (asPrimary.length) {
    if (asPrimary.some((l) => l.property_id !== i.propertyId)) return fail("invalid", "listing_property_mismatch", listingId);
    primaryListingId = listingId;
  } else if (asTwin.length) {
    const primaries = new Set(asTwin.map((t) => str(t.primary_listing_id)));
    if (primaries.size !== 1 || primaries.has(null) || asTwin.some((t) => t.property_id !== i.propertyId)) return fail("invalid", "twin_inconsistent", listingId);
    primaryListingId = [...primaries][0]!;
    const prim = src.listings.filter((l) => str(l.airbnb_listing_id) === primaryListingId);
    if (prim.length === 0 || prim.some((l) => l.owner_id !== i.tenantId || l.property_id !== i.propertyId)) return fail("invalid", "twin_inconsistent", listingId, primaryListingId);
  } else {
    return fail("unavailable", "listing_unidentified", listingId);
  }

  // 2) Grupo do imóvel (principal + gêmeos ativos do MESMO tenant e imóvel).
  const group = new Set<string>([primaryListingId]);
  for (const t of src.twins) {
    if (t.status !== "active" || str(t.primary_listing_id) !== primaryListingId) continue;
    if (t.owner_id !== i.tenantId || t.property_id !== i.propertyId) return fail("invalid", "twin_inconsistent", listingId, primaryListingId);
    const tw = str(t.twin_listing_id);
    if (tw) group.add(tw);
  }
  const res = str(src.reservationListingId);
  if (res && !group.has(res)) return fail("invalid", "reservation_listing_mismatch", listingId, primaryListingId);

  // 3) Preferência do anfitrião para o grupo (precisa ser única, do tenant e bem formada).
  const prefs = src.prefs.filter((p) => p && group.has(String(p.channex_id ?? "")));
  const channels = new Set<string>();
  for (const p of prefs) {
    const ch = str(p.payload?.channel_id);
    if (!p.payload || !ch) return fail("invalid", "preference_invalid", listingId, primaryListingId);
    if (p.payload.owner_id !== i.tenantId) return fail("invalid", "preference_other_tenant", listingId, primaryListingId);
    channels.add(ch);
  }
  if (channels.size > 1) return fail("ambiguous", "preference_conflict", listingId, primaryListingId);
  let candidate: string;
  let source: "host_preference" | "listing_mapped_channel";
  if (channels.size === 1) {
    candidate = [...channels][0]!;
    source = "host_preference";
  } else {
    // Sem preferência: conta mapeada do anúncio principal (única), fonte explícita.
    const mapped = new Set(src.listings.filter((l) => str(l.airbnb_listing_id) === primaryListingId).map((l) => str(l.channex_channel_id)).filter((x): x is string => !!x));
    if (mapped.size > 1) return fail("ambiguous", "multiple_mapped_channels", listingId, primaryListingId);
    if (mapped.size === 0) return fail("unavailable", "no_channel", listingId, primaryListingId);
    candidate = [...mapped][0]!;
    source = "listing_mapped_channel";
  }

  // 4) A conta precisa ser do tenant e estar ativa. Nunca cai para outra conta.
  const rows = src.accounts.filter((a) => str(a.channex_channel_id) === candidate);
  const own = rows.filter((a) => a.owner_id === i.tenantId);
  if (own.length === 0) return fail("invalid", rows.length ? "channel_other_tenant" : "channel_not_owned", listingId, primaryListingId);
  if (!own.some((a) => a.status === "active")) return fail("unavailable", "channel_inactive", listingId, primaryListingId);

  return { ...base, status: "resolved", validation: "validated", senderChannelId: candidate, source, listingId, primaryListingId, resolvedAt: i.now, reason: null };
}

/**
 * Revalidação imediatamente antes de um efeito (B3): se a identidade mudou entre a decisão e o
 * envio (ex.: preferência alterada), o resultado é inválido — nunca se envia pela identidade antiga.
 */
export function revalidateSenderIdentity(decided: SenderIdentity, current: SenderIdentity): "unchanged" | "changed" | "not_resolved" {
  if (decided.status !== "resolved" || current.status !== "resolved") return "not_resolved";
  return decided.senderChannelId === current.senderChannelId && decided.primaryListingId === current.primaryListingId ? "unchanged" : "changed";
}
