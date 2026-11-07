/**
 * Conector de mensagens Airbnb via Channex (inbound + outbound).
 *
 * Segurança:
 *  - Só responde em imóveis com linha em `property_listing_raw_data` (piloto)
 *    E com `airbnb_ai_enabled = true` (chave liga/desliga no painel) — a IA
 *    de atendimento é um ponto de extensão (`guest-ai/slot.server`); sem
 *    implementação instalada, a conversa vai para a equipe (needs_human).
 *  - Se não for possível identificar com certeza o anúncio da conversa, a
 *    mensagem NÃO é respondida (evita responder com dados do imóvel errado).
 *  - Pausa humana / handoff respeitados (mesma regra do WhatsApp/Guia).
 */
/** Base da API Channex conforme o ambiente (staging só quando CHANNEX_ENV=staging). */
export function channexBase(): string {
  return process.env["CHANNEX_ENV"] === "staging" ? "https://staging.channex.io/api/v1" : "https://app.channex.io/api/v1";
}

function apiKey(): string {
  const key = process.env["CHANNEX_API_KEY"] ?? process.env["CHANNEX_STAGING_API_KEY"];
  if (!key) throw new Error("Chave Channex ausente.");
  return key;
}

async function channex<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${channexBase()}${path}`, {
    ...init,
    headers: { "user-api-key": apiKey(), Accept: "application/json", "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Channex ${res.status} ${body.slice(0, 200)}`.trim());
  }
  return (await res.json()) as T;
}

/**
 * Reserva confirmada e vigente (ou futura) vinculada a esta conversa do Airbnb.
 * Sem reserva confirmada (ex.: consulta pré-reserva), dados sensíveis ficam bloqueados.
 */
async function hasConfirmedReservation(
  admin: any,
  propertyId: string,
  m: Inbound,
): Promise<{ ok: boolean; checkin: string | null; checkout: string | null; bookingId: string | null; code: string | null }> {
  const today = new Date().toISOString().slice(0, 10);
  const no = { ok: false, checkin: null, checkout: null, bookingId: null, code: null };
  let bookingId = m.bookingId;
  let otaThreadId: string | null = null;
  if (m.threadId) {
    const t = await channex<{ data?: any }>(`/message_threads/${m.threadId}`).catch(() => null);
    bookingId = bookingId ?? str(t?.data?.relationships?.booking?.data?.id);
    otaThreadId = str(t?.data?.attributes?.ota_message_thread_id);
  }
  const { data: rows } = await admin
    .from("property_reservations")
    .select("external_uid, checkin_date, checkout_date, status, guest_contacts, guest_hint")
    .eq("property_id", propertyId)
    .eq("status", "confirmed")
    .gte("checkout_date", today);
  const match = ((rows ?? []) as any[]).find(
    (r) =>
      (bookingId && r.external_uid === bookingId) ||
      (otaThreadId && r.guest_contacts?.ota_thread_id === otaThreadId),
  );
  if (match) {
    return {
      ok: true,
      checkin: match.checkin_date,
      checkout: match.checkout_date,
      bookingId: bookingId ?? null,
      code: str(match.guest_contacts?.code) ?? str(match.guest_hint),
    };
  }
  // Reservas novas chegam por webhook na tabela `reservas` (antes de qualquer importação manual).
  if (bookingId) {
    const { data: r } = await admin
      .from("reservas")
      .select("data_checkin, data_checkout, status, codigo_reserva_channex")
      .eq("channex_booking_id", bookingId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (r && r.status !== "cancelled" && (!r.data_checkout || r.data_checkout >= today)) {
      return {
        ok: true,
        checkin: r.data_checkin ?? null,
        checkout: r.data_checkout ?? null,
        bookingId,
        code: str(r.codigo_reserva_channex)?.replace(/^ABB-/i, "") ?? null,
      };
    }
  }
  return no;
}

type Inbound = {
  messageId: string | null;
  otaMessageId?: string | null;
  text: string;
  sender: string;
  threadId: string | null;
  bookingId: string | null;
  channexPropertyId: string | null;
  guestName: string | null;
  attachments?: string[];
  /** A Channex marcou `have_attachment`, mesmo que o caminho do anexo não tenha vindo. */
  haveAttachment?: boolean;
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : typeof v === "number" ? String(v) : null;
}

/**
 * Anexos do webhook. A Channex manda caminho RELATIVO ("attachments/<thread>/<msg>/<uuid>.jpeg");
 * ele vira a URL canônica da API (que exige o header `user-api-key` no download).
 */
export function parseAttachments(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const a of v) {
    const raw = typeof a === "string" ? a : (str((a as any)?.url) ?? str((a as any)?.link));
    const url = raw?.trim();
    if (!url) continue;
    if (/^https?:\/\//.test(url)) out.push(url);
    else if (/^\/?attachments\//.test(url)) out.push(`${channexBase()}/${url.replace(/^\/+/, "")}`);
  }
  return out.slice(0, 6);
}

/** URLs da própria Channex exigem a chave de API no download. */
export function isChannexUrl(url: string): boolean {
  try {
    return /(^|\.)channex\.io$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function parseChannexMessage(payload: unknown): Inbound | null {
  const root = (payload ?? {}) as Record<string, any>;
  const p = (root.payload ?? root.data?.attributes ?? root) as Record<string, any>;
  const attachments = parseAttachments(p.attachments);
  const text = str(p.message) ?? str(p.text) ?? "";
  // Foto sem texto: a Channex manda `message: null` + `have_attachment: true`. Isso é mensagem válida.
  const hasAttachment = p.have_attachment === true || attachments.length > 0;
  if (!text && !hasAttachment) return null;
  return {
    messageId: str(p.id) ?? str(p.ota_message_id),
    otaMessageId: str(p.ota_message_id),
    text,
    sender: String(p.sender ?? p.meta?.role ?? "guest").toLowerCase(),
    threadId: str(p.message_thread_id) ?? str(p.thread_id),
    bookingId: str(p.booking_id) ?? str(root.booking_id) ?? str(root.data?.attributes?.booking_id),
    channexPropertyId: str(p.property_id) ?? str(root.property_id),
    guestName: str(p.guest_name) ?? str(p.meta?.name) ?? str(p.sender_name),
    attachments,
    ...(p.have_attachment === true ? { haveAttachment: true } : {}),
  };
}

export type GuestPhotoFile = { url: string; mime: string; bytes: Uint8Array };

/** Baixa as fotos do hóspede (com a chave da Channex quando for URL dela). Nunca lança. */
export async function downloadGuestPhotos(urls: string[]): Promise<GuestPhotoFile[]> {
  const chKey = process.env["CHANNEX_API_KEY"] ?? process.env["CHANNEX_STAGING_API_KEY"];
  const files: GuestPhotoFile[] = [];
  for (const url of urls) {
    try {
      const authed = !!chKey && isChannexUrl(url);
      let res = await fetch(url, authed ? { headers: { "user-api-key": chKey! } } : undefined);
      if (!res.ok && chKey && !authed) res = await fetch(url, { headers: { "user-api-key": chKey } });
      if (!res.ok) continue;
      const mime = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0]!.trim().toLowerCase();
      if (!mime.startsWith("image/")) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > 8_000_000) continue;
      files.push({ url, mime, bytes });
    } catch (e) {
      console.warn("[channex-messages] falha ao baixar foto", e);
    }
  }
  return files;
}

/** Extensão do arquivo a partir do MIME real (jpeg, png, webp...). */
export function extFromMime(mime: string): string {
  const sub = (mime.split("/")[1] ?? "jpeg").split("+")[0]!.toLowerCase().replace(/[^a-z0-9]/g, "");
  return sub === "jpg" || !sub ? "jpeg" : sub;
}

/**
 * Guarda a foto no bucket privado "chat-attachments" para o operador ver a miniatura.
 * Caminho: <property_id>/<conversation_id>/<uuid>.<ext>. NUNCA lança: se o upload falhar
 * (rede, timeout), devolve null e o webhook segue normalmente, só sem a miniatura.
 */
export async function persistGuestPhotoAttachment(
  admin: any,
  p: { propertyId: string; conversationId: string; file: GuestPhotoFile },
): Promise<{ path: string; mime: string; sizeBytes: number } | null> {
  try {
    const path = `${p.propertyId}/${p.conversationId}/${crypto.randomUUID()}.${extFromMime(p.file.mime)}`;
    const { error } = await admin.storage
      .from("chat-attachments")
      .upload(path, p.file.bytes, { contentType: p.file.mime, upsert: false });
    if (error) {
      console.warn("[channex-messages] upload da foto falhou", error.message ?? error);
      return null;
    }
    return { path, mime: p.file.mime, sizeBytes: p.file.bytes.byteLength };
  } catch (e) {
    console.warn("[channex-messages] upload da foto falhou", e);
    return null;
  }
}

/** Descreve fotos do hóspede com modelo de visão para a IA "ver" a imagem. Nunca lança. */
type ListingRow = {
  property_id: string;
  owner_id: string;
  airbnb_listing_id: string;
  channex_room_type_id: string | null;
  airbnb_ai_enabled: boolean;
};

function findListingId(obj: unknown, depth = 0): string | null {
  if (!obj || typeof obj !== "object" || depth > 4) return null;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (/listing_id$/i.test(k) && str(v)) return str(v);
    const nested = findListingId(v, depth + 1);
    if (nested) return nested;
  }
  return null;
}

/** Descobre com segurança a qual imóvel piloto a conversa pertence. */
async function resolveListing(admin: any, m: Inbound): Promise<ListingRow | null> {
  const { data: rows } = await admin
    .from("property_listing_raw_data")
    .select("property_id, owner_id, airbnb_listing_id, channex_room_type_id, airbnb_ai_enabled");
  const listings = (rows ?? []) as ListingRow[];
  if (!listings.length) return null;

  // 1) Reserva conhecida → room type → anúncio.
  if (m.bookingId) {
    const { data: r } = await admin
      .from("reservas")
      .select("channex_room_type_id")
      .eq("channex_booking_id", m.bookingId)
      .limit(1)
      .maybeSingle();
    const rt = r?.channex_room_type_id as string | undefined;
    if (rt) {
      const direct = listings.find((l) => l.channex_room_type_id === rt);
      if (direct) return direct;
      // Reserva feita no anúncio gêmeo → resolve para o anúncio principal do par.
      const { data: tw } = await admin
        .from("channex_twin_links")
        .select("property_id, primary_listing_id")
        .eq("twin_room_type_id", rt)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      if (tw) {
        const hit =
          listings.find((l) => l.airbnb_listing_id === tw.primary_listing_id) ??
          listings.find((l) => l.property_id === tw.property_id);
        if (hit) return hit;
      }
    }
  }
  // 1b) Propriedade Channex do gêmeo (evento traz property_id).
  if (m.channexPropertyId) {
    const { data: tw } = await admin
      .from("channex_twin_links")
      .select("property_id, primary_listing_id")
      .eq("twin_channex_property_id", m.channexPropertyId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (tw) {
      const hit =
        listings.find((l) => l.airbnb_listing_id === tw.primary_listing_id) ??
        listings.find((l) => l.property_id === tw.property_id);
      if (hit) return hit;
    }
  }
  // 2) Conversa na Channex expõe o listing id do Airbnb.
  if (m.threadId) {
    const t = await channex<{ data?: unknown }>(`/message_threads/${m.threadId}`).catch(() => null);
    const raw = findListingId(t?.data);
    if (raw) {
      // Anúncio gêmeo (mesma unidade física) resolve para o anúncio principal.
      const { resolvePrimaryListingId } = await import("@/lib/channex-listing.server");
      const listingId = await resolvePrimaryListingId(raw);
      return listings.find((l) => l.airbnb_listing_id === listingId) ?? null;
    }
  }
  return null; // incerto → não responde
}

/** O chat do Airbnb não renderiza Markdown: remove marcações antes do envio. */
export function toAirbnbPlainText(text: string): string {
  // O Airbnb bloqueia mensagens com links (message_has_prohibited_content).
  return text
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/(https?:\/\/|www\.)\S+/gi, "")
    .replace(/\b[\w-]+\.(com|gl|ly|br|net|org|app|io)(\/\S*)?\b/gi, "")
    .replace(/[ \t]*:[ \t]*(?=\n|$)/g, ".")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|[^\w*])\*([^*\n]+)\*(?!\w)/g, "$1$2")
    .replace(/(^|[^\w_])_([^_\n]+)_(?!\w)/g, "$1$2")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*\*\s+/gm, "- ")
    .replace(/\*/g, "")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Remetente ESTRITO (Copiloto, 05/11/2026): `expectedChannelId` é a conta resolvida e validada pela política
 * de identidade de envio (`airbnb_sender_pref` do próprio tenant, anúncio do imóvel da conversa). Em modo
 * estrito NÃO existe fallback silencioso: se a preferida falhar, ou se a conta que de fato enviaria (preferida
 * ou canal da thread) não for a esperada, a função LANÇA e nada é enviado.
 */
export interface StrictSenderOptions {
  expectedChannelId: string;
}

export class StrictSenderError extends Error {
  constructor(readonly code: "preferred_sender_failed" | "sender_mismatch", readonly detail: string | null) {
    super(code);
    this.name = "StrictSenderError";
  }
}

export async function sendChannexThreadMessage(threadId: string, text: string, strict?: StrictSenderOptions): Promise<string | null> {
  // Conta escolhida no seletor de assinatura: envio direto no Airbnb; no fluxo humano qualquer falha cai na Channex.
  const { sendAsPreferredSenderDetailed } = await import("@/lib/airbnb-direct-sender.server");
  const direct = await sendAsPreferredSenderDetailed(threadId, text, strict?.expectedChannelId);
  if (direct.outcome === "sent") return direct.messageId;
  if (!strict && direct.outcome === "failed") console.error("[airbnb-direct] envio direto falhou, usando Channex", direct.reason);
  if (strict) {
    if (direct.outcome === "failed") throw new StrictSenderError("preferred_sender_failed", direct.reason);
    const channelThatSends = direct.outcome === "preferred_is_mapped" ? direct.channelId : direct.threadChannelId;
    if (channelThatSends !== strict.expectedChannelId) throw new StrictSenderError("sender_mismatch", channelThatSends);
  }
  const res = await channex<{ data?: { id?: string } }>(`/message_threads/${threadId}/messages`, {
    method: "POST",
    body: JSON.stringify({ message: { message: text } }),
  });
  return res?.data?.id ?? null;
}

/**
 * Entrega no chat do Airbnb uma mensagem nascida fora do webhook (resposta do
 * atendente levada pela IA, ou atendente digitando no ConciergeIA). Higieniza
 * o texto, envia pela Channex, grava com status e reporta falhas.
 */
export async function deliverToAirbnbThread(
  admin: any,
  p: {
    conversationId: string;
    threadId: string;
    propertyId: string;
    text: string;
    senderType: "ai" | "human";
    senderUserId?: string | null;
    skipInsert?: boolean;
    /** Copiloto: remetente estrito (sem fallback silencioso de conta). Ausente = fluxo humano inalterado. */
    strictSender?: StrictSenderOptions;
  },
): Promise<{ ok: boolean; messageId?: string; externalId: string | null; text: string; failure?: string }> {
  const text = toAirbnbPlainText(p.text);
  if (!text) return { ok: false, externalId: null, text };
  let externalId: string | null = null;
  let status: "sent" | "failed" = "sent";
  let failure: string | undefined;
  try {
    externalId = await sendChannexThreadMessage(p.threadId, text, p.strictSender);
  } catch (e) {
    status = "failed";
    failure = e instanceof StrictSenderError ? e.code : "delivery_failed";
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[channex-messages] entrega ao Airbnb falhou", msg);
    try {
      const { data: prop } = await admin.from("properties").select("name").eq("id", p.propertyId).maybeSingle();
      const { reportDeliveryFailure } = await import("@/lib/delivery-failure.server");
      await reportDeliveryFailure(admin, {
        conversationId: p.conversationId,
        propertyId: p.propertyId,
        channel: "airbnb",
        propertyName: (prop as { name?: string } | null)?.name ?? "",
        guestName: null,
        guestMessage: "",
        detail: /prohibited_content/.test(msg) ? "conteúdo proibido pela plataforma" : msg.slice(0, 120),
      } as never);
    } catch (err) {
      console.error("[channex-messages] alerta de falha não registrado", err);
    }
  }
  let messageId: string | undefined;
  if (!p.skipInsert) {
    const { data: ins } = await admin
      .from("property_chat_messages")
      .insert({
        conversation_id: p.conversationId,
        role: "assistant",
        content: text,
        sender_type: p.senderType,
        sender_user_id: p.senderUserId ?? null,
        channel: "airbnb" as never,
        external_id: externalId,
        delivery_status: status,
      })
      .select("id")
      .single();
    messageId = (ins as { id?: string } | null)?.id;
    await admin
      .from("property_chat_conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", p.conversationId);
  }
  return { ok: status === "sent", messageId, externalId, text, failure };
}

/**
 * Monta o conteúdo e as colunas de anexo da mensagem do hóspede (texto e/ou foto).
 * Baixa a foto e a guarda no storage para a miniatura do operador. Falha em
 * qualquer etapa nunca derruba o webhook.
 */
export async function buildGuestPhotoMessage(
  admin: any,
  p: { text: string; urls: string[]; haveAttachment: boolean; propertyId: string; conversationId: string },
): Promise<{ content: string; attachmentFields: Record<string, unknown> }> {
  let content = p.text;
  if (p.urls.length === 0) {
    if (!content && p.haveAttachment) {
      // Foto sem texto e sem caminho utilizável: a mensagem não pode sumir em silêncio.
      content = "[Foto enviada pelo hóspede — não foi possível visualizar]";
    }
    return { content, attachmentFields: {} };
  }
  const files = await downloadGuestPhotos(p.urls);
  const n = p.urls.length;
  const label = n > 1 ? `${n} fotos enviadas` : "Foto enviada";
  const tag = files[0] ? `[${label} pelo hóspede]` : `[${label} pelo hóspede — não foi possível visualizar]`;
  content = content ? `${content}\n${tag}` : tag;

  const saved = files[0] ? await persistGuestPhotoAttachment(admin, { propertyId: p.propertyId, conversationId: p.conversationId, file: files[0] }) : null;
  const attachmentFields: Record<string, unknown> = saved
    ? {
        attachment_path: saved.path,
        attachment_type: "image",
        attachment_mime: saved.mime,
        attachment_size_bytes: saved.sizeBytes,
        attachment_name: `foto-airbnb.${extFromMime(saved.mime)}`,
      }
    : // Sem arquivo guardado: mantém o tipo, sem caminho.
      { attachment_type: "image", attachment_name: "foto-airbnb" };
  return { content, attachmentFields };
}

/** Processa um evento `message` da fila Channex. */
export async function handleChannexMessage(payload: unknown): Promise<void> {
  const m = parseChannexMessage(payload);
  if (!m || !m.threadId) return;
  if (m.sender !== "guest") {
    // Mensagem programada do Airbnb: só registra, sem pausar a IA.
    // Anfitrião falando de verdade → IA se cala nessa conversa (10 min, renovável).
    const automated = isAutomatedHostMessage(payload, m.text);
    await pauseOnHostMessage(m, automated).catch((e: unknown) => console.error("[channex-messages] pausa falhou", e));
    return;
  }

  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");

  // Idempotência: mesma mensagem não é processada duas vezes.
  // Reenvios da Channex podem trazer outro `id` com o mesmo `ota_message_id`: checa ambos,
  // senão cada reenvio empurrava a janela de resposta para frente.
  const extIds = [m.messageId, m.otaMessageId].filter((v): v is string => !!v);
  if (extIds.length) {
    const { data: dup } = await admin
      .from("property_chat_messages")
      .select("id")
      .eq("channel", "airbnb" as never)
      .in("external_id", extIds)
      .limit(1);
    if (dup?.length) return;
  }

  const listing = await resolveListing(admin, m);
  if (!listing) {
    console.warn("[channex-messages] conversa sem imóvel piloto identificado — ignorada", m.threadId);
    return;
  }

  const sessionId = `airbnb:${m.threadId}`;
  const { data: existing } = await admin
    .from("property_chat_conversations")
    .select("id, ai_paused, paused_until, assigned_to")
    .eq("property_id", listing.property_id)
    .eq("guest_session_id", sessionId)
    .maybeSingle();

  let convId: string;
  let aiPaused = false;
  if (existing?.id) {
    convId = existing.id as string;
    const { resolvePause } = await import("@/lib/chat/pause");
    aiPaused = await resolvePause(admin, convId, existing as never);
  } else {
    const { data: created, error } = await admin
      .from("property_chat_conversations")
      .insert({
        property_id: listing.property_id,
        guest_session_id: sessionId,
        guest_name: m.guestName,
        status: "ai",
        ai_paused: false,
      })
      .select("id")
      .single();
    if (error || !created) throw new Error(error?.message ?? "Falha ao criar conversa.");
    convId = created.id as string;
  }

  const guestMsgAt = new Date().toISOString();
  const { content, attachmentFields } = await buildGuestPhotoMessage(admin, {
    text: m.text,
    urls: m.attachments ?? [],
    haveAttachment: !!m.haveAttachment,
    propertyId: listing.property_id,
    conversationId: convId,
  });
  const { data: guestMsg } = await admin
    .from("property_chat_messages")
    .insert({
      conversation_id: convId,
      role: "user",
      content,
      sender_type: "guest",
      channel: "airbnb" as never,
      external_id: m.messageId,
      delivery_status: "delivered",
      ...attachmentFields,
    })
    .select("id")
    .single();

  await admin
    .from("property_chat_conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", convId);

  // Código da reserva liga a conversa à reserva oficial, mesmo com a IA pausada. ANTES do Copiloto (07/11/2026):
  // o vínculo concluído e gravado evita que a sugestão rode com a conversa ainda sem reserva.
  try {
    const link = await import("@/lib/chat/conversation-link.server");
    const res = await hasConfirmedReservation(admin, listing.property_id, m).catch(() => null);
    if (res?.code) await link.linkConversationByCode(admin, { conversationId: convId, propertyId: listing.property_id, code: res.code });
  } catch (e) {
    console.error("[channex-messages] vínculo falhou", e);
  }

  // ─── Copiloto (05/11/2026): sugestão para a EQUIPE aprovar, em segundo plano (não bloqueia, não responde
  // ao hóspede, não altera o fluxo abaixo). Dono do anúncio resolvido com certeza por `resolveListing`.
  {
    const triggerId = (guestMsg as { id?: string } | null)?.id;
    if (triggerId) {
      try {
        const { triggerCopilotSuggestion } = await import("@/lib/guest-ai/copilot/trigger.server");
        await triggerCopilotSuggestion({ surface: "airbnb", conversationId: convId, messageId: triggerId, expectedOwnerId: listing.owner_id });
      } catch (e) {
        console.error("[channex-messages] copiloto não disparado", e instanceof Error ? e.name : "");
      }
    }
  }

  const { data: prop } = await admin.from("properties").select("*").eq("id", listing.property_id).maybeSingle();
  const propertyName = (prop as { name?: string } | null)?.name ?? "";

  // Chave desligada ou humano no controle → só registra e avisa a equipe.
  if (!listing.airbnb_ai_enabled || aiPaused) {
    try {
      const { getPropertyNotifiableUsers, sendGuestReplyPush } = await import("@/lib/handoff.server");
      const assigned = (existing as { assigned_to?: string | null } | null)?.assigned_to ?? null;
      const userIds = assigned ? [assigned] : await getPropertyNotifiableUsers(admin, listing.property_id);
      await sendGuestReplyPush(admin, {
        userIds,
        conversationId: convId,
        propertyName,
        guestName: m.guestName,
        guestMessage: content,
      });
    } catch (e) {
      console.error("[channex-messages] push falhou", e);
    }
    return;
  }

  if (!prop) return;

  // ─── IA de atendimento: ponto de extensão (sem implementação instalada).
  // Sem IA, a conversa vai para a fila humana e a equipe é avisada por push.
  const { requestGuestAiReply, NO_AI_HANDOFF_REASON } = await import("@/lib/guest-ai/slot.server");
  const ai = await requestGuestAiReply({
    surface: "airbnb",
    conversationId: convId,
    messageId: (guestMsg as { id?: string } | null)?.id ?? "",
    // Dono do anúncio resolvido com certeza por `resolveListing`.
    expectedOwnerId: listing.owner_id,
  });
  const handoffTriggered = ai ? ai.handoff : true;
  if (handoffTriggered) {
    const reason = ai?.handoffReason ?? NO_AI_HANDOFF_REASON;
    const urgency = ai?.handoffUrgency ?? null;
    await admin
      .from("property_chat_conversations")
      .update({
        status: "needs_human",
        ai_paused: false,
        handoff_reason: reason,
        handoff_urgency: urgency,
        handoff_at: new Date().toISOString(),
      })
      .eq("id", convId);
    try {
      const { getPropertyNotifiableUsers, sendHandoffPush } = await import("@/lib/handoff.server");
      const userIds = await getPropertyNotifiableUsers(admin, listing.property_id);
      await sendHandoffPush(admin, {
        userIds,
        conversationId: convId,
        propertyName,
        guestName: m.guestName,
        guestMessage: content,
        checkinDate: null,
        reason,
        urgency,
      });
    } catch (e) {
      console.error("[channex-messages] push de handoff falhou", e);
    }
  }
  const finalReply = (ai?.reply ?? "").trim();
  if (finalReply) {
    await deliverToAirbnbThread(admin, {
      conversationId: convId,
      threadId: m.threadId,
      propertyId: listing.property_id,
      text: finalReply,
      senderType: "ai",
    });
  }
}

/**
 * Mensagem do anfitrião vinda da plataforma: detectada como automação por
 * flag de automação no payload ou conteúdo típico (link do guia ConciergeIA,
 * código de reserva junto de boas-vindas/instruções).
 */
export function isAutomatedHostMessage(payload: unknown, text: string): boolean {
  const raw = JSON.stringify(payload ?? {}).toLowerCase();
  if (/"(is_automated|automated|scheduled|is_scheduled|is_template|auto_message)"\s*:\s*true/.test(raw)) return true;
  if (/"(source|origin|sent_by)"\s*:\s*"(automation|scheduled|template|system)/.test(raw)) return true;
  const t = text.toLowerCase();
  if (/conciergeia\.app\/g\//.test(t)) return true;
  const hasCode = /\bhm[a-z0-9]{8}\b/i.test(text);
  if (hasCode && /(bem-vind|boas-vindas|check-?in|check-?out|guia|reserva)/.test(t)) return true;
  return false;
}

/** Patch aplicado quando o anfitrião responde no Airbnb: pausa a IA e leva a conversa para "Humano". */
export function hostTakeoverPatch<T extends Record<string, unknown>>(pause: T, now = new Date()): T & {
  status: "assigned";
  resolved_at: null;
  last_message_at: string;
} {
  return { ...pause, status: "assigned", resolved_at: null, last_message_at: now.toISOString() };
}

/** Mensagem do anfitrião vinda do Airbnb: registra e (se humana) pausa a IA. */
export async function pauseOnHostMessage(m: Inbound, automated = false): Promise<void> {
  if (!m.threadId) return;
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const { pausePatch } = await import("@/lib/chat/pause");
  const { data: convs } = await admin
    .from("property_chat_conversations")
    .select("id")
    .eq("guest_session_id", `airbnb:${m.threadId}`);
  const norm = (x: string) => x.replace(/\s+/g, " ").trim();
  for (const c of (convs ?? []) as Array<{ id: string }>) {
    // Eco das próprias respostas da IA (enviadas pela API) não conta como anfitrião.
    const since = new Date(Date.now() - 10 * 60_000).toISOString();
    const { data: aiRecent } = await admin
      .from("property_chat_messages")
      .select("external_id, content")
      .eq("conversation_id", c.id)
      .in("sender_type", ["ai", "human"])
      .gte("created_at", since);
    const isEcho = ((aiRecent ?? []) as Array<{ external_id: string | null; content: string | null }>).some(
      (r) => (m.messageId && r.external_id === m.messageId) || norm(String(r.content ?? "")) === norm(m.text),
    );
    if (isEcho) continue;
    if (!automated) {
      // Anfitrião falando direto no Airbnb = atendimento humano: sai da aba "IA"/"Resolvidas"
      // e vai para "Humano" (status in needs_human/assigned). `assigned_to` não é tocado.
      await admin.from("property_chat_conversations").update(hostTakeoverPatch(pausePatch())).eq("id", c.id);
      await purgePendingChatForThread(admin, m.threadId);
    }
    if (m.messageId) {
      const { data: dup } = await admin
        .from("property_chat_messages")
        .select("id")
        .eq("channel", "airbnb" as never)
        .eq("external_id", m.messageId)
        .maybeSingle();
      if (dup) continue;
    }
    await admin.from("property_chat_messages").insert({
      conversation_id: c.id,
      role: "assistant",
      content: m.text,
      sender_type: automated ? "system" : "human",
      channel: "airbnb" as never,
      external_id: m.messageId,
      delivery_status: "delivered",
    });
  }
}

/**
 * Alguém da conta respondeu (Airbnb ou painel): descarta mensagens de chat
 * desse thread ainda na fila, para a IA não responder por cima.
 */
export async function purgePendingChatForThread(admin: any, threadId: string | null | undefined): Promise<void> {
  if (!threadId) return;
  try {
    await admin
      .from("fila_webhooks_channex")
      .update({
        processado: true,
        processado_em: new Date().toISOString(),
        erro: "Descartado: anfitrião respondeu diretamente",
      })
      .eq("processado", false)
      .in("evento", ["message", "new_message"])
      .eq("payload->payload->>message_thread_id", threadId);
  } catch (e) {
    console.error("[channex-messages] expurgo da fila falhou", e);
  }
}
