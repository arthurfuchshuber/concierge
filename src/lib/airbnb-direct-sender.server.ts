/**
 * Envio direto de mensagens no Airbnb com a conta escolhida no seletor de
 * assinatura ("carimbo"), sem remapear o anúncio na Channex.
 *
 * Segurança:
 *  - O token OAuth é lido ao vivo da Channex a cada envio (nunca gravado no
 *    nosso banco nem devolvido ao navegador).
 *  - Antes de enviar, a conversa é lida no Airbnb com o token escolhido e o
 *    anúncio dela precisa ser exatamente o da conversa na Channex; qualquer
 *    divergência ou erro cai no envio padrão pela Channex (hóspede nunca fica
 *    sem resposta).
 */
const CX = "https://app.channex.io/api/v1";
const AIRBNB = "https://api.airbnb.com/v2";
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

/** Token OAuth atual do canal Airbnb (lido da Channex, nunca persistido). */
async function channelToken(channelId: string): Promise<string | null> {
  const r = await cx<{ data?: any }>(`/channels/${channelId}`);
  const a = r?.data?.attributes;
  if (a?.channel !== "AirBNB") return null;
  const s = a?.settings ?? {};
  if (s.token_invalid) return null;
  const t = s.tokens?.access_token;
  const exp = Number(s.tokens?.expires_at ?? 0);
  if (!t || (exp && exp * 1000 < Date.now() + 60_000)) return null;
  return String(t);
}

/**
 * Resultado DETALHADO do envio pela conta escolhida (Copiloto, 05/11/2026). Quem precisa saber POR QUE o
 * envio direto não aconteceu — para recusar o fallback pela Channex — usa este; `trySendAsPreferredSender`
 * continua com o contrato antigo (id ou null) para o fluxo humano existente.
 *
 *  - `sent`: enviado pela conta preferida (id da mensagem no Airbnb);
 *  - `no_preference`: sem preferência gravada para o anúncio ⇒ a Channex envia pelo canal da thread;
 *  - `preferred_is_mapped`: a preferida É o canal mapeado da thread ⇒ a Channex envia (mesma conta);
 *  - `failed`: havia preferência e o envio direto por ela NÃO aconteceu (token, anúncio divergente, recusa,
 *    rede). O fluxo humano cai na Channex; o Copiloto NÃO (recusa o fallback silencioso).
 */
export type PreferredSendOutcome =
  | { outcome: "sent"; messageId: string; channelId: string }
  | { outcome: "no_preference"; threadChannelId: string | null }
  | { outcome: "preferred_is_mapped"; channelId: string }
  | { outcome: "failed"; reason: "thread_unresolved" | "token_unavailable" | "listing_mismatch" | "preference_mismatch" | "airbnb_rejected" | "network"; channelId: string | null };

/**
 * `expectedChannelId` (modo estrito do Copiloto): a conta que a política de identidade resolveu. Se existir
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
    const token = await channelToken(prefChannel);
    if (!token) return { outcome: "failed", reason: "token_unavailable", channelId: prefChannel };
    // Blindagem: a conversa vista pela conta escolhida precisa ser do mesmo anúncio.
    const seen = await threadListing(otaThreadId, token);
    if (!seen || seen !== listingId) return { outcome: "failed", reason: "listing_mismatch", channelId: prefChannel };
    const id = await postDirect(otaThreadId, text, token);
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

async function threadListing(otaThreadId: string, token: string): Promise<string | null> {
  const res = await fetch(`${AIRBNB}/threads/${encodeURIComponent(otaThreadId)}?_format=for_messaging_sync_with_posts_china`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) return null;
  const j: any = await res.json().catch(() => null);
  const id = j?.thread?.attachment?.booking_details?.listing_id ?? j?.thread?.listing_id ?? null;
  return id ? String(id) : null;
}

async function postDirect(otaThreadId: string, text: string, token: string): Promise<string | null> {
  const res = await fetch(`${AIRBNB}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ thread_id: Number(otaThreadId), message: text }),
  });
  const body = await res.text().catch(() => "");
  if (!res.ok) {
    console.error("[airbnb-direct] Airbnb recusou", res.status, body.slice(0, 200));
    return null;
  }
  let id: string | null = null;
  try {
    const j = JSON.parse(body);
    id = j?.message?.id != null ? String(j.message.id) : null;
  } catch { /* ignore */ }
  return id ?? `airbnb-direct:${Date.now()}`;
}
