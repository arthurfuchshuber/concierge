/**
 * Envio direto de mensagens no Airbnb com a conta escolhida no seletor de
 * assinatura ("carimbo"), sem remapear o anúncio na Channex.
 *
 * O proxy usa a autenticação do canal escolhido, sem expor o token OAuth.
 * O corpo de POST fica em request.payload; request.params não envia o corpo.
 * O chamador mantém sua política existente de contingência.
 */
import { usableAirbnbToken } from "@/lib/airbnb-token";

const CX = "https://app.channex.io/api/v1";
const PREF = "airbnb_sender_pref";

function cxHeaders() {
  const key = process.env["CHANNEX_API_KEY"] ?? process.env["CHANNEX_STAGING_API_KEY"];
  if (!key) throw new Error("Chave Channex ausente.");
  return { "user-api-key": key, Accept: "application/json", "Content-Type": "application/json" };
}
async function cx<T = any>(path: string): Promise<T> {
  const res = await fetch(`${CX}${path}`, { headers: cxHeaders() });
  if (!res.ok) throw new Error(`Channex ${res.status}`);
  return (await res.json()) as T;
}

/** Preferências de remetente gravadas (listing → canal). */
export async function readSenderPrefs(db: any, listingIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!listingIds.length) return out;
  const { data } = await db.from("channex_raw_records").select("channex_id, payload").eq("entity_type", PREF).in("channex_id", listingIds);
  for (const r of (data ?? []) as Array<{ channex_id: string; payload: any }>) {
    if (r.payload?.channel_id) out.set(r.channex_id, String(r.payload.channel_id));
  }
  return out;
}

export async function writeSenderPrefs(db: any, ownerId: string, userId: string, listingIds: string[], channelId: string) {
  const now = new Date().toISOString();
  const rows = listingIds.map((l) => ({
    entity_type: PREF,
    channex_id: l,
    source: "conciergeia",
    payload: { owner_id: ownerId, channel_id: channelId, updated_by: userId, updated_at: now },
    last_synced_at: now,
  }));
  const { error } = await db.from("channex_raw_records").upsert(rows, { onConflict: "entity_type,channex_id" });
  if (error) throw new Error("Não foi possível salvar a conta remetente.");
}

/**
 * Token OAuth do canal Airbnb. 1º o cofre do ConciergeIA (`airbnb_sender_credentials`, cifrado); 2º a Channex
 * ao vivo — quando ela ainda devolve um token real, ele é guardado no cofre. Mascarado ("***") ⇒ null.
 */
export async function channelToken(
  channelId: string,
  deps: { db?: any; vault?: (db: any, channelId: string) => Promise<string | null>; channex?: (path: string) => Promise<any> } = {},
): Promise<string | null> {
  const db = deps.db ?? ((await import("@/integrations/supabase/client.server")).supabaseAdmin as any);
  const creds = await import("@/lib/airbnb-sender-credentials.server");
  const local = await (deps.vault ?? creds.getUsableSenderToken)(db, channelId).catch(() => null);
  if (local && usableAirbnbToken({ channel: "AirBNB", settings: { tokens: { access_token: local } } })) return local;
  const r = await (deps.channex ?? cx)(`/channels/${channelId}`).catch(() => null);
  const attrs = r?.data?.attributes;
  const token = usableAirbnbToken(attrs);
  if (token) await creds.captureChannelToken(db, channelId, attrs?.settings);
  return token;
}

/**
 * Resultado DETALHADO do envio pela conta escolhida (IA, 05/11/2026). Quem precisa saber POR QUE o
 * envio direto não aconteceu — para recusar o fallback pela Channex — usa este; `trySendAsPreferredSender`
 * continua com o contrato antigo (id ou null) para o fluxo humano existente.
 *
 *  - `sent`: enviado pela conta preferida (id da mensagem no Airbnb);
 *  - `no_preference`: sem preferência gravada para o anúncio ⇒ a Channex envia pelo canal da thread;
 *  - `preferred_is_mapped`: a preferida É o canal mapeado da thread ⇒ a Channex envia (mesma conta);
 *  - `failed`: havia preferência e o envio direto por ela NÃO aconteceu (token, anúncio divergente, recusa,
 *    rede). O fluxo humano cai na Channex; a IA NÃO (recusa o fallback silencioso).
 */
export type PreferredSendOutcome =
  | { outcome: "sent"; messageId: string; channelId: string }
  | { outcome: "no_preference"; threadChannelId: string | null }
  | { outcome: "preferred_is_mapped"; channelId: string }
  | { outcome: "failed"; reason: "thread_unresolved" | "token_unavailable" | "listing_mismatch" | "preference_mismatch" | "airbnb_rejected" | "network"; channelId: string | null };

/**
 * `expectedChannelId` (modo estrito da IA): a conta que a política de identidade resolveu. Se existir
 * preferência gravada e ela for OUTRA conta, nada é enviado (`preference_mismatch`) — conferido ANTES da rede do Airbnb.
 */
export async function sendAsPreferredSenderDetailed(channexThreadId: string, text: string, expectedChannelId?: string): Promise<PreferredSendOutcome> {
  let prefChannel: string | null = null;
  try {
    const t = await cx<{ data?: any }>(`/message_threads/${channexThreadId}`);
    const attrs = t?.data?.attributes ?? {};
    const otaThreadId = attrs.ota_message_thread_id ? String(attrs.ota_message_thread_id) : null;
    const channelOfThread: string | null = t?.data?.relationships?.channel?.data?.id ? String(t.data.relationships.channel.data.id) : null;
    const listingId = String(attrs.meta?.listing_id ?? attrs.listing_id ?? "") || null;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    // Sem anúncio identificado não há como saber se existe preferência: o fluxo humano envia pela Channex.
    if (!listingId) return { outcome: "no_preference", threadChannelId: channelOfThread };
    prefChannel = (await readSenderPrefs(db, [listingId])).get(listingId) ?? null;
    if (!prefChannel) return { outcome: "no_preference", threadChannelId: channelOfThread };
    if (expectedChannelId && prefChannel !== expectedChannelId) return { outcome: "failed", reason: "preference_mismatch", channelId: prefChannel };
    if (prefChannel === channelOfThread) return { outcome: "preferred_is_mapped", channelId: prefChannel };
    if (!otaThreadId) return { outcome: "failed", reason: "thread_unresolved", channelId: prefChannel };
    // Channex não expõe mais o token (resposta do suporte, 27/11/2026): o envio sai pelo proxy autenticado
    // do canal escolhido no seletor "Assinar como"; a Channex usa o token dela e o Airbnb carimba essa conta.
    const id = await postViaChannexProxy(prefChannel, otaThreadId, text);
    return id ? { outcome: "sent", messageId: id, channelId: prefChannel } : { outcome: "failed", reason: "airbnb_rejected", channelId: prefChannel };
  } catch (e) {
    console.error("[airbnb-direct] envio direto indisponível", e instanceof Error ? e.message : e);
    return { outcome: "failed", reason: "network", channelId: prefChannel };
  }
}

/**
 * Tenta enviar pela conta escolhida. Retorna o id da mensagem no Airbnb, ou
 * null quando o envio direto não se aplica/falha (o chamador usa a Channex).
 */
export async function trySendAsPreferredSender(channexThreadId: string, text: string): Promise<string | null> {
  const r = await sendAsPreferredSenderDetailed(channexThreadId, text);
  if (r.outcome === "failed") console.error("[airbnb-direct] envio direto falhou, usando Channex", r.reason);
  return r.outcome === "sent" ? r.messageId : null;
}

/**
 * Envio pelo proxy da Channex (`POST /channels/:id/action/api_proxy`, método temporário liberado pelo suporte
 * em 27/11/2026): a mensagem sai pela conta do canal informado, sem acesso ao token. null = recusado.
 */
export async function postViaChannexProxy(
  channelId: string,
  otaThreadId: string,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const res = await fetchImpl(`${CX}/channels/${encodeURIComponent(channelId)}/action/api_proxy`, {
    method: "POST",
    headers: cxHeaders(),
    body: JSON.stringify({
      request: { endpoint: "messages", method: "post", payload: { thread_id: Number(otaThreadId), message: text } },
    }),
  });
  const body = await res.text().catch(() => "");
  if (!res.ok) {
    console.error("[airbnb-proxy] Channex/Airbnb recusou", res.status, body.slice(0, 200));
    return null;
  }
  let j: any = null;
  try { j = JSON.parse(body); } catch { /* ignore */ }
  if (j?.errors || j?.data?.error || j?.error) {
    console.error("[airbnb-proxy] erro no corpo", body.slice(0, 200));
    return null;
  }
  const m = j?.data?.message ?? j?.message ?? j?.data?.attributes?.message;
  const id = j?.data?.id ?? m?.id;
  return id != null ? String(id) : null;
}
