/**
 * F2-B · B3.1/B3.2 — LEITURA dos webhooks brutos de mensagens do Airbnb de UMA thread (só leitura).
 *
 * Fonte: `channex_raw_records` com `entity_type = 'webhook:message'`, gravado por
 * `enfileirarWebhookChannex` ANTES do processamento da fila (`first_seen_at` = recebimento). A thread
 * vem SEMPRE do turno validado (`guest_session_id = 'airbnb:<thread>'`), nunca de parâmetro.
 * Projeção só por caminhos JSON escalares (`RAW_MESSAGE_META_SELECT`): o texto da mensagem nunca é
 * lido. Também resolve as propriedades Channex do imóvel do turno (anúncio principal + gêmeos ativos
 * do MESMO tenant) para conferir que o bruto é deste imóvel.
 */
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import type { PauseRawRow } from "@/lib/guest-ai/policy/human-pause";
import type { GuestAiDb } from "./client.server";
import { RAW_MESSAGE_META_SELECT, cols } from "./projections";

export const RAW_MESSAGE_ENTITY = "webhook:message";
const THREAD_PATH = "payload->payload->>message_thread_id";
const SENDER_PATH = "payload->payload->>sender";

export class GuestAiReadError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "GuestAiReadError";
  }
}

/** Thread Channex da conversa Airbnb (sessão `airbnb:<thread>`), ou `null` fora do Airbnb. */
export function threadIdOf(turn: ValidatedTurn): string | null {
  if (turn.surface !== "airbnb") return null;
  const m = /^airbnb:([A-Za-z0-9-]{8,80})$/.exec(turn.guestSessionId);
  return m ? m[1]! : null;
}

type RawMetaDb = { id: string; first_seen_at: string | null; channex_property_id: string | null; sender: string | null; inserted_at: string | null; message_id: string | null; ota_message_id: string | null };

export const toPauseRaw = (r: RawMetaDb): PauseRawRow => ({
  record_id: String(r.id),
  first_seen_at: r.first_seen_at ?? null,
  sender: r.sender ?? null,
  inserted_at: r.inserted_at ?? null,
  message_id: r.message_id ?? null,
  ota_message_id: r.ota_message_id ?? null,
  channex_property_id: r.channex_property_id ?? null,
});

/**
 * Brutos da thread desde `sinceIso` (por recebimento) + o bruto `property` mais recente da thread
 * (independente da janela), até `limit`. `complete=false` quando bateu no teto (lista cortada).
 */
export async function fetchThreadRawMeta(db: GuestAiDb, threadId: string, opts: { sinceIso: string; limit: number; messageIds?: readonly string[] }): Promise<{ rows: PauseRawRow[]; complete: boolean }> {
  const base = () => db.from("channex_raw_records").select(RAW_MESSAGE_META_SELECT).eq("entity_type", RAW_MESSAGE_ENTITY).eq(THREAD_PATH, threadId);
  const [win, latest, byIds] = await Promise.all([
    base().gte("first_seen_at", opts.sinceIso).order("first_seen_at", { ascending: true }).limit(opts.limit + 1),
    base().eq(SENDER_PATH, "property").order("first_seen_at", { ascending: false }).limit(1),
    opts.messageIds && opts.messageIds.length ? base().in("payload->payload->>id", [...opts.messageIds]).limit(opts.limit + 1) : Promise.resolve({ data: [], error: null }),
  ]);
  if (win.error || latest.error || byIds.error) throw new GuestAiReadError("raw_lookup_failed");
  const w = (win.data ?? []) as RawMetaDb[];
  const b = (byIds.data ?? []) as RawMetaDb[];
  const complete = w.length <= opts.limit && b.length <= opts.limit;
  const seen = new Map<string, PauseRawRow>();
  for (const r of [...w.slice(0, opts.limit), ...((latest.data ?? []) as RawMetaDb[]), ...b.slice(0, opts.limit)]) seen.set(String(r.id), toPauseRaw(r));
  return { rows: [...seen.values()], complete };
}

/** Propriedades Channex do imóvel do turno (anúncio + gêmeos ativos). Outro tenant ⇒ erro. */
export async function fetchPropertyChannexIds(db: GuestAiDb, turn: ValidatedTurn): Promise<string[]> {
  const [listings, twins] = await Promise.all([
    db.from("property_listing_raw_data").select(cols(["property_id", "owner_id", "channex_property_id"])).eq("property_id", turn.propertyId).limit(20),
    db.from("channex_twin_links").select(cols(["property_id", "owner_id", "twin_channex_property_id", "status"])).eq("property_id", turn.propertyId).limit(20),
  ]);
  if (listings.error || twins.error) throw new GuestAiReadError("listing_lookup_failed");
  const out = new Set<string>();
  for (const l of (listings.data ?? []) as Array<{ owner_id: string | null; channex_property_id: string | null }>) {
    if (l.owner_id !== turn.tenantId) throw new GuestAiReadError("listing_other_tenant");
    if (l.channex_property_id) out.add(l.channex_property_id);
  }
  for (const t of (twins.data ?? []) as Array<{ owner_id: string | null; twin_channex_property_id: string | null; status: string | null }>) {
    if (t.status !== "active") continue;
    if (t.owner_id !== turn.tenantId) throw new GuestAiReadError("twin_other_tenant");
    if (t.twin_channex_property_id) out.add(t.twin_channex_property_id);
  }
  return [...out];
}
