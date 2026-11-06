/**
 * F2-B · B3.2 — LEITURA das fontes da identidade de envio Airbnb (somente leitura).
 *
 * Produz o `SenderIdentitySource` da política pura `resolveSenderIdentity` (B2.5), sem decidir nada:
 *  1. anúncio da conversa: as propriedades Channex vistas nos webhooks brutos DESTA thread (thread do
 *     turno validado) → anúncio principal (`property_listing_raw_data.channex_property_id`) ou gêmeo
 *     (`channex_twin_links.twin_channex_property_id`). Mais de um anúncio ⇒ candidatos múltiplos ⇒
 *     a política devolve `ambiguous` (nunca escolhe um);
 *  2. grupo do anúncio: linhas do anúncio e dos gêmeos SEM filtrar por tenant (para que a política
 *     detecte anúncio/gêmeo de OUTRO tenant e invalide, em vez de simplesmente não enxergar);
 *  3. preferência do anfitrião (`airbnb_sender_pref`), só os campos do contrato por caminho JSON;
 *  4. contas Airbnb candidatas (owner, canal, status) — nenhuma coluna de token/credencial.
 * Ausência de `sender_user_id` nunca é usada como prova de nada aqui: identidade de ENVIO (conta do
 * anfitrião) ≠ remetente de uma mensagem ≠ titular da reserva. Falha de leitura ⇒ `lookup: "failed"`
 * ⇒ `unavailable`. Fora do Airbnb, a política responde `not_applicable` sem consulta.
 */
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import { assertIssued } from "@/lib/guest-ai/trust";
import { SENDER_PREF_ENTITY, type SenderIdentitySource } from "@/lib/guest-ai/policy/sender-identity";
import { GuestAiAbortedError, abortableDb, getGuestAiDb, throwIfAborted, type GuestAiDb } from "./client.server";
import { SENDER_ACCOUNT_COLUMNS, SENDER_LISTING_COLUMNS, SENDER_PREF_SELECT, SENDER_TWIN_COLUMNS, cols } from "./projections";
import { RAW_MESSAGE_ENTITY, threadIdOf } from "./airbnb-thread.server";

const FAILED: SenderIdentitySource = { lookup: "failed", conversationListingId: null, reservationListingId: null, listings: [], twins: [], prefs: [], accounts: [] };
const MAX = 50;

type Listing = SenderIdentitySource["listings"][number] & { channex_property_id?: string | null };
type Twin = SenderIdentitySource["twins"][number] & { twin_channex_property_id?: string | null };

export async function loadSenderIdentitySource(turn: ValidatedTurn, deps: { db?: GuestAiDb; signal?: AbortSignal } = {}): Promise<SenderIdentitySource> {
  assertIssued("turn", turn, "data_requires_validated_turn");
  throwIfAborted(deps.signal);
  if (turn.surface !== "airbnb") return { ...FAILED, lookup: "ok" };
  const thread = threadIdOf(turn);
  if (!thread) return FAILED;
  const db = abortableDb(deps.db ?? (await getGuestAiDb()), deps.signal);
  try {
    // 1) Propriedades Channex desta thread (metadado escalar do bruto, sem texto).
    const raw = await db
      .from("channex_raw_records")
      .select(cols(["channex_property_id"]))
      .eq("entity_type", RAW_MESSAGE_ENTITY)
      .eq("payload->payload->>message_thread_id", thread)
      .limit(501);
    if (raw.error) return FAILED;
    const rawRows = (raw.data ?? []) as Array<{ channex_property_id: string | null }>;
    if (rawRows.length > 500) return FAILED;
    const cx = [...new Set(rawRows.map((r) => r.channex_property_id).filter((x): x is string => !!x))];
    if (cx.length === 0) return { ...FAILED, lookup: "ok" };

    const [byCxListing, byCxTwin] = await Promise.all([
      db.from("property_listing_raw_data").select(cols(SENDER_LISTING_COLUMNS)).in("channex_property_id", cx).limit(MAX),
      db.from("channex_twin_links").select(cols(SENDER_TWIN_COLUMNS)).in("twin_channex_property_id", cx).limit(MAX),
    ]);
    if (byCxListing.error || byCxTwin.error) return FAILED;
    const candidates = new Set<string>();
    for (const l of (byCxListing.data ?? []) as Listing[]) if (l.airbnb_listing_id) candidates.add(l.airbnb_listing_id);
    for (const t of (byCxTwin.data ?? []) as Twin[]) if (t.twin_listing_id && t.status === "active") candidates.add(t.twin_listing_id);
    const conversationListingCandidates = [...candidates].sort();
    if (conversationListingCandidates.length !== 1) {
      return { ...FAILED, lookup: "ok", conversationListingCandidates };
    }
    const listingId = conversationListingCandidates[0]!;

    // 2) Grupo: linhas do anúncio e dos gêmeos (principal ou gêmeo = listingId) e seus principais.
    const [twinsA, twinsB] = await Promise.all([
      db.from("channex_twin_links").select(cols(SENDER_TWIN_COLUMNS)).eq("twin_listing_id", listingId).limit(MAX),
      db.from("channex_twin_links").select(cols(SENDER_TWIN_COLUMNS)).eq("primary_listing_id", listingId).limit(MAX),
    ]);
    if (twinsA.error || twinsB.error) return FAILED;
    const twinsFirst = [...((twinsA.data ?? []) as Twin[]), ...((twinsB.data ?? []) as Twin[])];
    const primaries = new Set<string>([listingId, ...twinsFirst.map((t) => t.primary_listing_id).filter((x): x is string => !!x)]);
    const [listings, twinsC] = await Promise.all([
      db.from("property_listing_raw_data").select(cols(SENDER_LISTING_COLUMNS)).in("airbnb_listing_id", [...primaries]).limit(MAX),
      db.from("channex_twin_links").select(cols(SENDER_TWIN_COLUMNS)).in("primary_listing_id", [...primaries]).limit(MAX),
    ]);
    if (listings.error || twinsC.error) return FAILED;
    const twinMap = new Map<string, Twin>();
    for (const t of [...twinsFirst, ...((twinsC.data ?? []) as Twin[])]) twinMap.set(`${t.primary_listing_id}|${t.twin_listing_id}|${t.owner_id}|${t.status}`, t);
    const twins = [...twinMap.values()];
    const group = new Set<string>([...primaries, ...twins.map((t) => t.twin_listing_id).filter((x): x is string => !!x)]);

    // 3) Preferências do grupo e 4) contas candidatas.
    const prefsRes = await db.from("channex_raw_records").select(SENDER_PREF_SELECT).eq("entity_type", SENDER_PREF_ENTITY).in("channex_id", [...group]).limit(MAX);
    if (prefsRes.error) return FAILED;
    const prefs = ((prefsRes.data ?? []) as Array<{ channex_id: string | null; owner_id: string | null; channel_id: string | null; updated_at: string | null }>).map((p) => ({
      channex_id: p.channex_id,
      payload: { owner_id: p.owner_id ?? undefined, channel_id: p.channel_id ?? undefined, updated_at: p.updated_at ?? undefined },
    }));
    const listingRows = (listings.data ?? []) as Listing[];
    const channels = new Set<string>();
    for (const p of prefs) if (typeof p.payload.channel_id === "string" && p.payload.channel_id) channels.add(p.payload.channel_id);
    for (const l of listingRows) if (l.channex_channel_id) channels.add(l.channex_channel_id);
    let accounts: SenderIdentitySource["accounts"] = [];
    if (channels.size) {
      const acc = await db.from("airbnb_accounts").select(cols(SENDER_ACCOUNT_COLUMNS)).in("channex_channel_id", [...channels]).limit(MAX);
      if (acc.error) return FAILED;
      accounts = (acc.data ?? []) as SenderIdentitySource["accounts"];
    }
    throwIfAborted(deps.signal);
    return {
      lookup: "ok",
      conversationListingId: listingId,
      conversationListingCandidates,
      reservationListingId: null,
      listings: listingRows.map((l) => ({ airbnb_listing_id: l.airbnb_listing_id, property_id: l.property_id, owner_id: l.owner_id, channex_channel_id: l.channex_channel_id })),
      twins: twins.map((t) => ({ owner_id: t.owner_id, property_id: t.property_id, primary_listing_id: t.primary_listing_id, twin_listing_id: t.twin_listing_id, status: t.status })),
      prefs,
      accounts,
    };
  } catch (e) {
    if (e instanceof GuestAiAbortedError || deps.signal?.aborted) throw new GuestAiAbortedError();
    return FAILED;
  }
}
