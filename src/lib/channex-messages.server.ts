/**
 * Conector de mensagens Airbnb via Channex (inbound + outbound).
 *
 * Segurança:
 *  - Só responde em imóveis com linha em `property_listing_raw_data` (piloto)
 *    E com `airbnb_ai_enabled = true` (chave liga/desliga no painel).
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
async function describeGuestPhotos(files: GuestPhotoFile[], guestText: string): Promise<string | null> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key || files.length === 0) return null;
  const images = files.map((f) => {
    let bin = "";
    for (let i = 0; i < f.bytes.length; i += 0x8000) bin += String.fromCharCode(...f.bytes.subarray(i, i + 0x8000));
    return `data:${f.mime};base64,${btoa(bin)}`;
  });
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3.8-flash",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  "Um hóspede de hospedagem enviou esta(s) foto(s)" +
                  (guestText ? ` junto com: "${guestText.slice(0, 300)}"` : "") +
                  ". Descreva objetivamente em português, em até 3 frases, o que aparece, transcrevendo literalmente qualquer texto ou mensagem de erro visível e marca/modelo de aparelhos.",
              },
              ...images.map((u) => ({ type: "image_url", image_url: { url: u } })),
            ],
          },
        ],
      }),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as any;
    const d = String(j?.choices?.[0]?.message?.content ?? "").trim();
    return d || null;
  } catch (e) {
    console.warn("[channex-messages] visão falhou", e);
    return null;
  }
}

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

export async function sendChannexThreadMessage(threadId: string, text: string): Promise<string | null> {
  // Conta escolhida no seletor de assinatura: envio direto no Airbnb; qualquer falha cai na Channex.
  const { trySendAsPreferredSender } = await import("@/lib/airbnb-direct-sender.server");
  const direct = await trySendAsPreferredSender(threadId, text);
  if (direct) return direct;
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
/**
 * Trava atômica "uma resposta da IA por mensagem do hóspede" (27/10/2026).
 * Webhook, varredura de vácuo e entrega da decisão da equipe podiam gerar e
 * enviar ao mesmo tempo duas respostas para a mesma pergunta. A chave única
 * em `ops_push_log` garante que só o primeiro envio sai.
 */
export async function claimAiReplySlot(admin: any, conversationId: string, propertyId: string): Promise<boolean> {
  try {
    const { data: last } = await admin
      .from("property_chat_messages")
      .select("id")
      .eq("conversation_id", conversationId)
      .eq("role", "user")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastId = (last as { id?: string } | null)?.id;
    if (!lastId) return true;
    const { data: prop } = await admin.from("properties").select("owner_id").eq("id", propertyId).maybeSingle();
    const ownerId = (prop as { owner_id?: string } | null)?.owner_id;
    if (!ownerId) return true;
    const { error } = await admin.from("ops_push_log").insert({
      owner_id: ownerId,
      kind: "ai-reply-slot",
      dedupe_key: `ai-reply:${conversationId}:${lastId}`,
      payload: { conversationId, messageId: lastId },
    });
    return !error;
  } catch {
    return true;
  }
}

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
  },
): Promise<{ ok: boolean; messageId?: string; text: string }> {
  const text = toAirbnbPlainText(p.text);
  if (!text) return { ok: false, text };
  if (p.senderType === "ai" && !(await claimAiReplySlot(admin, p.conversationId, p.propertyId))) {
    console.info("[channex-messages] resposta da IA duplicada descartada", p.conversationId);
    return { ok: true, text };
  }
  let externalId: string | null = null;
  let status: "sent" | "failed" = "sent";
  try {
    externalId = await sendChannexThreadMessage(p.threadId, text);
  } catch (e) {
    status = "failed";
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
  return { ok: status === "sent", messageId, text };
}

/**
 * Monta o conteúdo e as colunas de anexo da mensagem do hóspede (texto e/ou foto).
 * Baixa a foto, a IA "vê" (transcrição), e a imagem é guardada no storage para a miniatura do
 * operador. Falha em qualquer etapa nunca derruba o webhook nem a resposta da IA.
 */
export async function buildGuestPhotoMessage(
  admin: any,
  p: { text: string; urls: string[]; haveAttachment: boolean; propertyId: string; conversationId: string },
): Promise<{ content: string; photoDesc: string | null; attachmentFields: Record<string, unknown> }> {
  let content = p.text;
  if (p.urls.length === 0) {
    if (!content && p.haveAttachment) {
      // Foto sem texto e sem caminho utilizável: a mensagem não pode sumir em silêncio.
      content = "[Foto enviada pelo hóspede — não foi possível visualizar; peça gentilmente para descrever o que aparece]";
    }
    return { content, photoDesc: null, attachmentFields: {} };
  }
  const files = await downloadGuestPhotos(p.urls);
  const photoDesc = await describeGuestPhotos(files, p.text);
  const n = p.urls.length;
  const label = n > 1 ? `${n} fotos enviadas` : "Foto enviada";
  const tag = photoDesc
    ? `[${label} pelo hóspede — conteúdo: ${photoDesc}]`
    : `[${label} pelo hóspede — não foi possível visualizar; peça gentilmente para descrever o que aparece]`;
  content = content ? `${content}\n${tag}` : tag;

  const saved = files[0] ? await persistGuestPhotoAttachment(admin, { propertyId: p.propertyId, conversationId: p.conversationId, file: files[0] }) : null;
  const attachmentFields: Record<string, unknown> = saved
    ? {
        attachment_path: saved.path,
        attachment_type: "image",
        attachment_mime: saved.mime,
        attachment_size_bytes: saved.sizeBytes,
        attachment_name: `foto-airbnb.${extFromMime(saved.mime)}`,
        attachment_transcript: photoDesc,
      }
    : // Sem arquivo guardado: mantém o que já havia (tipo + transcrição), sem caminho.
      { attachment_type: "image", attachment_name: "foto-airbnb", attachment_transcript: photoDesc };
  return { content, photoDesc, attachmentFields };
}

/** Processa um evento `message` da fila Channex. */
export async function handleChannexMessage(payload: unknown): Promise<void> {
  const m = parseChannexMessage(payload);
  if (!m || !m.threadId) return;
  if (m.sender !== "guest") {
    // Mensagem programada do Airbnb: vira contexto para a IA, sem pausá-la.
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
    .select("id, ai_paused, paused_until, assigned_to, ai_reply_due_at, ai_reply_ctx")
    .eq("property_id", listing.property_id)
    .eq("guest_session_id", sessionId)
    .maybeSingle();

  let convId: string;
  let aiPaused = false;
  if (existing?.id) {
    convId = existing.id as string;
    const { resolvePause } = await import("@/lib/ai/pause");
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
  await admin.from("property_chat_messages").insert({
    conversation_id: convId,
    role: "user",
    content,
    sender_type: "guest",
    channel: "airbnb" as never,
    external_id: m.messageId,
    delivery_status: "delivered",
    ...attachmentFields,
  });

  await admin
    .from("property_chat_conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", convId);

  // Código da reserva liga a conversa e dá baixa de check-in/out mesmo com a IA pausada.
  try {
    const link = await import("@/lib/ai/conversation-link.server");
    const res = await hasConfirmedReservation(admin, listing.property_id, m).catch(() => null);
    if (res?.code) await link.linkConversationByCode(admin, { conversationId: convId, propertyId: listing.property_id, code: res.code });
    const auto = await link.applyStayCompletionOnIngest(admin, { conversationId: convId, propertyId: listing.property_id, message: m.text });
    // Previsão de horário (chegada/saída) vai pro painel mesmo com a IA pausada ou desligada.
    await link
      .applyStayForecastOnIngest(admin, { conversationId: convId, propertyId: listing.property_id, message: m.text })
      .catch((e: unknown) => console.error("[channex-messages] previsão no ingest falhou", e));
    if (!auto) {
      const { proposeProactiveDecision } = await import("@/lib/ai/human-loop/proactive-decisions.server");
      await proposeProactiveDecision(admin, { conversationId: convId, trigger: "guest" });
    }
  } catch (e) {
    console.error("[channex-messages] vínculo/baixa falhou", e);
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
    // Pausa com prazo + IA ligada: agenda a retomada para logo após o fim da pausa.
    // Se ninguém da equipe responder até lá, a IA responde o bloco pendente do hóspede
    // com o histórico completo (resposta humana nesse meio tempo esvazia o bloco → nada sai).
    const until = (existing as { paused_until?: string | null } | null)?.paused_until ?? null;
    const untilMs = until ? new Date(until).getTime() : NaN;
    if (listing.airbnb_ai_enabled && aiPaused && Number.isFinite(untilMs)) {
      await admin
        .from("property_chat_conversations")
        .update({
          ai_reply_due_at: new Date(untilMs + 5_000).toISOString(),
          ai_reply_ctx: {
            threadId: m.threadId,
            bookingId: m.bookingId,
            channexPropertyId: m.channexPropertyId,
            guestName: m.guestName,
            propertyId: listing.property_id,
          },
        } as never)
        .eq("id", convId);
    }
    return;
  }

  if (!prop || !process.env["LOVABLE_API_KEY"]) return;

  // JANELA DE CONSOLIDAÇÃO: a mensagem já está gravada (nada se perde); a IA não roda agora.
  // Cada nova mensagem do mesmo hóspede REINICIA a espera; quando a janela fecha, uma única
  // execução responde a todas as frases picadas de uma vez (ver `processDueAiReplies`).
  const pending = existing as { ai_reply_due_at?: string | null; ai_reply_ctx?: { firstAt?: string } | null } | null;
  const firstAt =
    pending?.ai_reply_due_at && pending.ai_reply_ctx?.firstAt ? pending.ai_reply_ctx.firstAt : new Date().toISOString();
  await admin
    .from("property_chat_conversations")
    .update({
      ai_reply_due_at: nextAiReplyDueAt(Date.now(), new Date(firstAt).getTime()),
      ai_reply_ctx: {
        firstAt,
        threadId: m.threadId,
        bookingId: m.bookingId,
        channexPropertyId: m.channexPropertyId,
        guestName: m.guestName,
        propertyId: listing.property_id,
      },
    } as never)
    .eq("id", convId);
}

/** Espera sem novas mensagens antes de a IA responder (15–20 s: o hóspede costuma mandar frases em sequência). */
export const AI_REPLY_DEBOUNCE_MS = 15_000;
/** Teto absoluto de espera desde a 1ª mensagem ainda não respondida. */
export const AI_REPLY_MAX_WAIT_MS = 30_000;

/** Prazo da resposta: reinicia a cada mensagem, mas nunca passa de 30 s após a primeira. */
export function nextAiReplyDueAt(nowMs: number, firstAtMs: number): string {
  return new Date(Math.min(nowMs + AI_REPLY_DEBOUNCE_MS, firstAtMs + AI_REPLY_MAX_WAIT_MS)).toISOString();
}

type ReplyCtx = {
  threadId: string;
  bookingId: string | null;
  channexPropertyId: string | null;
  guestName: string | null;
  propertyId: string;
  /** Retentativas já feitas após erro transitório da IA (0/ausente = 1ª execução). */
  attempts?: number;
  lastError?: string;
};

/** Espera (segundos) antes de cada retentativa da IA: 1ª = 20 s, 2ª = 35 s. */
export const AI_REPLY_RETRY_DELAYS_S = [20, 35] as const;

function aiErrorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

function aiErrorStatus(error: unknown): number | null {
  const e = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } } | null;
  for (const v of [e?.status, e?.statusCode, e?.response?.status]) {
    if (typeof v === "number") return v;
  }
  const m = aiErrorText(error).match(/\b(400|401|402|403|429|502|503|504)\b/);
  return m ? Number(m[1]) : null;
}

/**
 * Erro passageiro do provedor de IA (vale tentar de novo): 429, 502, 503, 504, queda de rede e
 * timeout. Erros definitivos (400, 401, 402 sem créditos, 403 e validações internas) não repetem.
 */
export function isTransientAiError(error: unknown): boolean {
  const status = aiErrorStatus(error);
  if (status !== null) return [429, 502, 503, 504].includes(status);
  return /ECONNRESET|ETIMEDOUT|fetch failed|AbortError|timeout|timed out|upstream|overloaded|temporarily unavailable/i.test(
    aiErrorText(error),
  );
}

/** Motivo em português claro para o alerta/handoff (nunca o erro cru do provedor). */
export function describeAiError(error: unknown): string {
  const status = aiErrorStatus(error);
  const text = aiErrorText(error);
  if (status === 429) return "Limite de requisições momentâneo no provedor de IA.";
  if (/ETIMEDOUT|AbortError|timeout|timed out/i.test(text) && status === null)
    return "Tempo limite excedido na comunicação com o serviço de IA.";
  if (status === 402) return "Créditos de IA insuficientes (erro 402).";
  if (status !== null && [502, 503, 504].includes(status))
    return `Instabilidade temporária no provedor de inteligência artificial (erro ${status} upstream).`;
  if (/upstream|overloaded|temporarily unavailable|ECONNRESET|fetch failed/i.test(text))
    return "Instabilidade temporária no provedor de inteligência artificial (erro de upstream).";
  const msg = (error instanceof Error ? error.message : text).replace(/\s+/g, " ").trim();
  return (msg || "erro desconhecido").slice(0, 120);
}

/**
 * Falha ao gerar a resposta da IA. Erro passageiro: reagenda (20 s, depois 35 s). Sem tentativas
 * ou erro definitivo: a conversa vai para atendimento humano (urgência alta) com o motivo, vira
 * alerta crítico e a equipe recebe push. Se uma pessoa já assumiu (IA pausada), não faz nada.
 */
export async function handleAiReplyFailure(
  admin: any,
  convId: string,
  ctx: ReplyCtx | null,
  error: unknown,
): Promise<"retry" | "handoff" | "skipped"> {
  if (!ctx?.propertyId) return "skipped";
  const { isPausedNow } = await import("@/lib/ai/pause");
  const { data: conv } = await admin
    .from("property_chat_conversations")
    .select("ai_paused, paused_until")
    .eq("id", convId)
    .maybeSingle();
  if (conv && isPausedNow(conv as never)) return "skipped";

  const attempts = ctx.attempts ?? 0;
  const raw = aiErrorText(error).slice(0, 300);
  if (isTransientAiError(error) && attempts < AI_REPLY_RETRY_DELAYS_S.length) {
    const delay = AI_REPLY_RETRY_DELAYS_S[attempts]!;
    console.warn(
      `[channex-messages] Erro transitório de IA na conversa ${convId}. Reagendando tentativa ${attempts + 1}/${AI_REPLY_RETRY_DELAYS_S.length} em ${delay}s...`,
    );
    // Só reagenda se nenhuma mensagem nova do hóspede reiniciou a janela (ela venceria, com contexto novo).
    await admin
      .from("property_chat_conversations")
      .update({
        ai_reply_due_at: new Date(Date.now() + delay * 1000).toISOString(),
        ai_reply_ctx: { ...ctx, attempts: attempts + 1, lastError: raw },
      } as never)
      .eq("id", convId)
      .is("ai_reply_due_at", null);
    return "retry";
  }

  const motivo = describeAiError(error).replace(/[.\s]+$/, "");
  const reason = `A IA não conseguiu responder devido a: ${motivo}. Por favor, assuma a conversa.`;
  await admin
    .from("property_chat_conversations")
    .update({
      status: "needs_human",
      handoff_reason: reason,
      handoff_urgency: "high",
      handoff_at: new Date().toISOString(),
      ai_reply_due_at: null,
    } as never)
    .eq("id", convId);

  let propertyName: string | null = null;
  try {
    const { data: prop } = await admin.from("properties").select("owner_id, name").eq("id", ctx.propertyId).maybeSingle();
    propertyName = (prop as { name?: string | null } | null)?.name ?? null;
    if ((prop as { owner_id?: string } | null)?.owner_id) {
      await admin.from("ai_alerts").insert({
        tenant_id: (prop as { owner_id: string }).owner_id,
        property_id: ctx.propertyId,
        kind: "ai_provider_error",
        severity: "critical",
        title: "Falha na resposta da IA ao hóspede",
        detail: `A IA tentou responder ${ctx.guestName ?? "o hóspede"} no imóvel ${propertyName ?? ""}, mas falhou após retentativas. Motivo: ${motivo}. A conversa foi movida para atendimento humano.`,
        metadata: { threadId: ctx.threadId, attempts, lastError: raw },
      });
    }
  } catch (e) {
    console.error("[channex-messages] alerta de falha da IA não gravado", e);
  }
  try {
    const { getPropertyNotifiableUsers, sendHandoffPush } = await import("@/lib/handoff.server");
    const ids = new Set(await getPropertyNotifiableUsers(admin, ctx.propertyId));
    const { data: admins } = await admin.from("user_roles").select("user_id").eq("role", "admin");
    for (const a of (admins ?? []) as Array<{ user_id: string }>) ids.add(a.user_id);
    await sendHandoffPush(admin, {
      userIds: Array.from(ids),
      conversationId: convId,
      propertyName,
      guestName: ctx.guestName,
      guestMessage: null,
      checkinDate: null,
      reason,
      urgency: "high",
    });
  } catch (e) {
    console.error("[channex-messages] push da falha da IA não enviado", e);
  }
  return "handoff";
}

/**
 * Junta o bloco de mensagens do hóspede ainda sem resposta (tudo que veio depois da última
 * resposta do anfitrião/IA) em um único texto, uma frase por linha.
 */
export async function consolidatedGuestBlock(
  admin: any,
  conversationId: string,
): Promise<{ text: string; count: number; lastAt: string | null }> {
  const { data: lastReply } = await admin
    .from("property_chat_messages")
    .select("created_at")
    .eq("conversation_id", conversationId)
    .eq("role", "assistant")
    .not("is_internal_note", "is", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  let q = admin
    .from("property_chat_messages")
    .select("content, created_at")
    .eq("conversation_id", conversationId)
    .eq("role", "user")
    .order("created_at", { ascending: true })
    .limit(20);
  if (lastReply?.created_at) q = q.gt("created_at", lastReply.created_at);
  const { data: rows } = await q;
  const msgs = ((rows ?? []) as Array<{ content: string | null; created_at: string }>).filter(
    (r) => (r.content ?? "").trim().length > 0,
  );
  return {
    text: msgs.map((r) => String(r.content).trim()).join("\n"),
    count: msgs.length,
    lastAt: msgs.length ? msgs[msgs.length - 1]!.created_at : null,
  };
}

/**
 * Responde as conversas cuja janela de consolidação fechou. Seguro para rodar em paralelo:
 * cada conversa é "reivindicada" por comparação do horário agendado — se chegou mensagem nova
 * (horário mudou) ou outra execução já pegou, esta desiste sem responder.
 */
export async function processDueAiReplies(limit = 25): Promise<number> {
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const { data: due } = await admin
    .from("property_chat_conversations")
    .select("id, ai_reply_due_at")
    .not("ai_reply_due_at", "is", null)
    .lte("ai_reply_due_at", new Date().toISOString())
    .order("ai_reply_due_at", { ascending: true })
    .limit(limit);
  let done = 0;
  for (const row of (due ?? []) as Array<{ id: string; ai_reply_due_at: string }>) {
    // Reivindica com um "aluguel" de 2 min em vez de apagar o agendamento: se a execução
    // morrer no meio (limite de tempo do servidor), a conversa volta à fila sozinha e o
    // hóspede nunca fica sem resposta. As travas de envio impedem resposta duplicada.
    const { data: cur } = await admin
      .from("property_chat_conversations")
      .select("ai_reply_ctx")
      .eq("id", row.id)
      .maybeSingle();
    const prevCtx = ((cur as { ai_reply_ctx?: ReplyCtx | null } | null)?.ai_reply_ctx ?? null) as
      | (ReplyCtx & { leases?: number })
      | null;
    const leases = (prevCtx?.leases ?? 0) + 1;
    // Aluguel maior que o tempo máximo de uma resposta (cron com timeout de 150 s),
    // para que uma resposta lenta não seja reivindicada de novo e contada como falha.
    const leaseUntil = new Date(Date.now() + 180_000).toISOString();
    const { data: claimed } = await admin
      .from("property_chat_conversations")
      .update({ ai_reply_due_at: leaseUntil, ai_reply_ctx: { ...(prevCtx ?? {}), leases } } as never)
      .eq("id", row.id)
      .eq("ai_reply_due_at", row.ai_reply_due_at)
      .select("id, ai_reply_ctx")
      .maybeSingle();
    if (!claimed) continue; // mensagem nova reiniciou a espera, ou outra execução já pegou
    const ctx = (claimed as { ai_reply_ctx?: ReplyCtx | null }).ai_reply_ctx ?? null;
    const release = async () => {
      const { leases: _l, ...rest } = (ctx ?? {}) as ReplyCtx & { leases?: number };
      await admin
        .from("property_chat_conversations")
        .update({ ai_reply_due_at: null, ai_reply_ctx: rest } as never)
        .eq("id", row.id)
        .eq("ai_reply_due_at", leaseUntil);
    };
    try {
      if (leases > 3) throw new Error("A IA não concluiu a resposta após várias tentativas (tempo esgotado).");
      await runConsolidatedAiReply(admin, row.id, ctx);
      await release();
      done += 1;
    } catch (e) {
      console.error("[channex-messages] resposta consolidada falhou", row.id, e);
      await release().catch(() => null);
      try {
        await handleAiReplyFailure(admin, row.id, ctx, e);
      } catch (e2) {
        console.error("[channex-messages] tratamento da falha da IA falhou", row.id, e2);
      }
    }
  }
  return done;
}

async function runConsolidatedAiReply(admin: any, convId: string, ctx: ReplyCtx | null): Promise<void> {
  if (!ctx?.threadId || !ctx.propertyId) return;
  const { data: conv0 } = await admin
    .from("property_chat_conversations")
    .select("id, ai_paused, paused_until, guest_session_id")
    .eq("id", convId)
    .maybeSingle();
  if (!conv0) return;
  const { data: sw0 } = await admin
    .from("property_listing_raw_data")
    .select("airbnb_ai_enabled")
    .eq("property_id", ctx.propertyId)
    .maybeSingle();
  const { isPausedNow } = await import("@/lib/ai/pause");
  if (!(sw0 as any)?.airbnb_ai_enabled || isPausedNow(conv0 as never)) return;
  // Card de decisão da equipe pendente nesta conversa (ex.: autorizar remarcação):
  // a IA não fala com o hóspede até a equipe decidir pelo botão.
  const { data: openDecision } = await admin
    .from("ai_human_escalations")
    .select("id")
    .eq("conversation_id", convId)
    .eq("status", "pending")
    .eq("reason", "proactive_decision")
    .limit(1);
  if (openDecision?.length) return;

  // Bloco do hóspede ainda sem resposta → UMA mensagem para o agente.
  const block = await consolidatedGuestBlock(admin, convId);
  if (block.count === 0 || !block.lastAt) return; // já respondido
  const guestMsgAt = block.lastAt;
  const sessionId = (conv0 as { guest_session_id: string }).guest_session_id;
  const m: Inbound = {
    messageId: null,
    text: block.text,
    sender: "guest",
    threadId: ctx.threadId,
    bookingId: ctx.bookingId,
    channexPropertyId: ctx.channexPropertyId,
    guestName: ctx.guestName,
  };

  const { data: prop } = await admin.from("properties").select("*").eq("id", ctx.propertyId).maybeSingle();
  if (!prop || !process.env["LOVABLE_API_KEY"]) return;
  const propertyName = (prop as { name?: string } | null)?.name ?? "";
  const listing = { property_id: ctx.propertyId };

  const { loadAgentHistory } = await import("@/lib/chat-audio.server");
  const fullHistory = await loadAgentHistory(admin, convId, 20 + block.count);
  // As frases do bloco entram só uma vez (como mensagem atual), não também no histórico.
  const history = [...fullHistory];
  for (let i = 0; i < block.count && history.length && history[history.length - 1]!.role === "user"; i += 1) history.pop();
  const reservation = await hasConfirmedReservation(admin, listing.property_id, m).catch(() => ({
    ok: false,
    checkin: null,
    checkout: null,
    bookingId: null as string | null,
    code: null as string | null,
  }));
  const inquiry = await loadInquiryDetails(admin, m.threadId!).catch(() => null);
  const { runHospitalityAgent } = await import("@/lib/ai/orchestrator.server");
  const { loadReservationDossier } = await import("@/lib/ai/reservation-dossier.server");
  // Usa o booking/código descoberto pela thread quando o evento chega sem bookingId.
  let dossier: Awaited<ReturnType<typeof loadReservationDossier>> = null;
  if (reservation.ok && reservation.bookingId) {
    dossier = await loadReservationDossier(admin, {
      propertyId: listing.property_id,
      bookingId: reservation.bookingId,
    }).catch(() => null);
  }
  if (!dossier && reservation.ok && reservation.code) {
    dossier = await loadReservationDossier(admin, {
      propertyId: listing.property_id,
      code: reservation.code,
    }).catch(() => null);
  }
  const result = await runHospitalityAgent({
    supabase: admin,
    property: prop as unknown as Record<string, unknown>,
    conversationId: convId,
    sessionId,
    guestName: m.guestName,
    message: m.text,
    history,
    surface: "airbnb",
    channel: "airbnb",
    channelReference: m.threadId!,
    reservationVerified: reservation.ok,
    checkinDate: reservation.checkin ?? inquiry?.checkin ?? null,
    checkoutDate: reservation.checkout ?? inquiry?.checkout ?? null,
    bookingRequest: inquiry,
    reservationDossier: dossier?.text ?? null,
    reservationCode: reservation.ok ? (reservation.code ?? null) : null,
  });

  if (result.handoff) {
    // Nunca mexe em ai_paused aqui: uma pausa gravada por resposta humana
    // durante o processamento precisa continuar valendo.
    await admin
      .from("property_chat_conversations")
      .update({
        status: "needs_human",
        handoff_reason: result.handoffReason ?? "Hóspede pediu atendimento humano.",
        handoff_urgency: result.handoffUrgency,
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
        guestMessage: m.text,
        checkinDate: null,
        reason: result.handoffReason ?? "Hóspede pediu atendimento humano.",
        urgency: result.handoffUrgency,
      });
    } catch (e) {
      console.error("[channex-messages] push de handoff falhou", e);
    }
  }

  const reply = toAirbnbPlainText(result.reply);
  if (!reply) return;

  // Rechecagem na hora do envio: a chave pode ter sido desligada, o anfitrião pode ter falado
  // ou o hóspede pode ter mandado outra mensagem enquanto a IA pensava. Nesses casos a resposta
  // é descartada (se chegou mensagem nova, a próxima janela responde o bloco inteiro).
  const [{ data: sw }, { data: conv }, { data: humanAfter }, { data: guestAfter }] = await Promise.all([
    admin.from("property_listing_raw_data").select("airbnb_ai_enabled").eq("property_id", listing.property_id).maybeSingle(),
    admin.from("property_chat_conversations").select("ai_paused, paused_until").eq("id", convId).maybeSingle(),
    // A conta (humano OU mensagem programada/sistema) falou depois do hóspede? A IA cala.
    admin
      .from("property_chat_messages")
      .select("id")
      .eq("conversation_id", convId)
      .in("sender_type", ["human", "system", "ai"])
      .not("is_internal_note", "is", true)
      .gte("created_at", guestMsgAt)
      .limit(1),
    admin
      .from("property_chat_messages")
      .select("id")
      .eq("conversation_id", convId)
      .eq("role", "user")
      .gt("created_at", guestMsgAt)
      .limit(1),
  ]);
  if (!(sw as any)?.airbnb_ai_enabled || isPausedNow(conv as never)) return;
  if ((humanAfter ?? []).length > 0) return;
  if ((guestAfter ?? []).length > 0) return;
  // Resposta pensada como pré-reserva, mas a reserva confirmou enquanto a IA pensava: descarta.
  if (!reservation.ok) {
    const nowConfirmed = await hasConfirmedReservation(admin, listing.property_id, m).catch(() => null);
    if (nowConfirmed?.ok) {
      console.info("[channex-messages] resposta pré-reserva descartada: reserva confirmada durante a geração", m.threadId);
      return;
    }
  }
  if (!(await claimAiReplySlot(admin, convId, listing.property_id))) {
    console.info("[channex-messages] resposta duplicada descartada (já respondida)", convId);
    return;
  }
  let externalId: string | null = null;
  let status: "sent" | "failed" = "sent";
  try {
    // UMA resposta para o bloco inteiro.
    externalId = await sendChannexThreadMessage(m.threadId!, reply);
  } catch (e) {
    status = "failed";
    console.error("[channex-messages] envio ao Airbnb falhou", e);
    const msg = e instanceof Error ? e.message : String(e);
    const { reportDeliveryFailure } = await import("@/lib/delivery-failure.server");
    await reportDeliveryFailure(admin, {
      conversationId: convId,
      propertyId: listing.property_id,
      channel: "airbnb",
      propertyName,
      guestName: m.guestName,
      guestMessage: m.text,
      detail: /prohibited_content/.test(msg) ? "conteúdo proibido pela plataforma" : msg.slice(0, 120),
    });
  }
  await admin.from("property_chat_messages").insert({
    conversation_id: convId,
    role: "assistant",
    content: reply,
    sender_type: "ai",
    channel: "airbnb" as never,
    external_id: externalId,
    delivery_status: status,
  });
}

/**
 * Mensagens programadas/automáticas do Airbnb chegam como "anfitrião". Sinais:
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
  const { pausePatch } = await import("@/lib/ai/pause");
  const { data: convs } = await admin
    .from("property_chat_conversations")
    .select("id, property_id")
    .eq("guest_session_id", `airbnb:${m.threadId}`);
  const norm = (x: string) => x.replace(/\s+/g, " ").trim();
  for (const c of (convs ?? []) as Array<{ id: string; property_id: string | null }>) {
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
      // O anfitrião já respondeu direto no Airbnb: a pergunta da IA à equipe
      // perde o sentido e sai da tela (já entregue, a IA não repete).
      // Cards proativos/de aprendizado NUNCA são fechados por mensagens do
      // anfitrião: só somem quando a equipe responde ou descarta.
      const { data: allOpen } = await admin
        .from("ai_human_escalations")
        .select("id, owner_id, property_id, agent_type, guest_name, question_to_human, context_snapshot")
        .eq("conversation_id", c.id)
        .eq("status", "pending")
        // Só pendências RECENTES (últimas 4h): consulta de dias atrás nunca é
        // "respondida" por uma fala de hoje (23/10/2026).
        .gte("created_at", new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString());
      const openAsks = ((allOpen ?? []) as Array<{ id: string; context_snapshot: Record<string, unknown> | null }>).filter(
        (r) => !r.context_snapshot?.proactive && !r.context_snapshot?.host_learning,
      );
      if (openAsks.length) {
        await admin
          .from("ai_human_escalations")
          .update({
            status: "answered",
            human_response: m.text.slice(0, 2000),
            resolved_at: new Date().toISOString(),
            applied_to_guest: true,
          } as never)
          .in("id", openAsks.map((r) => r.id))
          .eq("status", "pending");
      }
      try {
        const { offerHostAnswerLearning } = await import("@/lib/ai/human-loop/host-answer-learning.server");
        await offerHostAnswerLearning(admin as never, {
          conversationId: c.id,
          hostText: m.text,
          openAsks: openAsks as never,
        });
      } catch (e) {
        console.error("[channex-messages] oferta de aprendizado falhou", (e as Error)?.message);
      }
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
    if (!automated) {
      const { completeStayFromHumanMessage } = await import("@/lib/ai/human-closing.server");
      await completeStayFromHumanMessage(c.id, m.text);
      // Horário combinado pela equipe vira fato da reserva (a IA não se contradiz depois).
      if (c.property_id) {
        const { applyAgreedTimeFromStaffMessage } = await import("@/lib/ai/stay-intent-resolver.server");
        await applyAgreedTimeFromStaffMessage(admin, { propertyId: c.property_id, conversationId: c.id, message: m.text }).catch(
          (e: unknown) => console.error("[channex-messages] horário combinado falhou", e),
        );
      }
      // Copiloto proativo: fala da equipe pode indicar ação no app (ex.: chaves entregues).
      const { proposeProactiveDecision } = await import("@/lib/ai/human-loop/proactive-decisions.server");
      await proposeProactiveDecision(admin, { conversationId: c.id, trigger: "staff" });
    }
  }
}

/**
 * Datas/hóspedes da consulta ou pedido de reserva do Airbnb (eventos `inquiry`
 * e `reservation_request` da Channex), para a IA nunca perguntar o que o
 * hóspede já informou na plataforma.
 */
async function loadInquiryDetails(
  admin: any,
  threadId: string | null | undefined,
): Promise<{ checkin: string; checkout: string; nights: number | null; guests: number | null; stage: string } | null> {
  if (!threadId) return null;
  const { data } = await admin
    .from("fila_webhooks_channex")
    .select("evento, payload")
    .in("evento", ["inquiry", "reservation_request"])
    .eq("payload->payload->>message_thread_id", threadId)
    .order("id", { ascending: false })
    .limit(1);
  const row = (data ?? [])[0] as { evento: string; payload: any } | undefined;
  if (!row) return null;
  const p = row.payload?.payload ?? {};
  const b = p.booking_details;
  const r = p.bms?.raw_message?.reservation;
  const checkin = b?.checkin_date ?? r?.start_date ?? p.bms?.arrival_date;
  const checkout = b?.checkout_date ?? r?.end_date ?? p.bms?.departure_date;
  if (!checkin || !checkout) return null;
  const nights = Number(b?.nights ?? r?.nights) || null;
  const guests =
    Number(b?.number_of_guests) ||
    Number(p.bms?.occ_adults ?? 0) + Number(p.bms?.occ_children ?? 0) ||
    null;
  return { checkin, checkout, nights, guests, stage: row.evento };
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
