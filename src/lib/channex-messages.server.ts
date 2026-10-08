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
const CHANNEX_BASE = "https://app.channex.io/api/v1";

function apiKey(): string {
  const key = process.env["CHANNEX_API_KEY"] ?? process.env["CHANNEX_STAGING_API_KEY"];
  if (!key) throw new Error("Chave Channex ausente.");
  return key;
}

async function channex<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${CHANNEX_BASE}${path}`, {
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
async function hasConfirmedReservation(admin: any, propertyId: string, m: Inbound): Promise<{ ok: boolean; checkin: string | null; checkout: string | null }> {
  const today = new Date().toISOString().slice(0, 10);
  const no = { ok: false, checkin: null, checkout: null };
  let bookingId = m.bookingId;
  let otaThreadId: string | null = null;
  if (m.threadId) {
    const t = await channex<{ data?: any }>(`/message_threads/${m.threadId}`).catch(() => null);
    bookingId = bookingId ?? str(t?.data?.relationships?.booking?.data?.id);
    otaThreadId = str(t?.data?.attributes?.ota_message_thread_id);
  }
  const { data: rows } = await admin
    .from("property_reservations")
    .select("external_uid, checkin_date, checkout_date, status, guest_contacts")
    .eq("property_id", propertyId)
    .eq("status", "confirmed")
    .gte("checkout_date", today);
  const match = ((rows ?? []) as any[]).find(
    (r) =>
      (bookingId && r.external_uid === bookingId) ||
      (otaThreadId && r.guest_contacts?.ota_thread_id === otaThreadId),
  );
  if (match) return { ok: true, checkin: match.checkin_date, checkout: match.checkout_date };
  // Reservas novas chegam por webhook na tabela `reservas` (antes de qualquer importação manual).
  if (bookingId) {
    const { data: r } = await admin
      .from("reservas")
      .select("data_checkin, data_checkout, status")
      .eq("channex_booking_id", bookingId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (r && r.status !== "cancelled" && (!r.data_checkout || r.data_checkout >= today)) {
      return { ok: true, checkin: r.data_checkin ?? null, checkout: r.data_checkout ?? null };
    }
  }
  return no;
}

type Inbound = {
  messageId: string | null;
  text: string;
  sender: string;
  threadId: string | null;
  bookingId: string | null;
  channexPropertyId: string | null;
  guestName: string | null;
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : typeof v === "number" ? String(v) : null;
}

export function parseChannexMessage(payload: unknown): Inbound | null {
  const root = (payload ?? {}) as Record<string, any>;
  const p = (root.payload ?? root.data?.attributes ?? root) as Record<string, any>;
  const text = str(p.message) ?? str(p.text);
  if (!text) return null;
  return {
    messageId: str(p.id) ?? str(p.ota_message_id),
    text,
    sender: String(p.sender ?? p.meta?.role ?? "guest").toLowerCase(),
    threadId: str(p.message_thread_id) ?? str(p.thread_id),
    bookingId: str(p.booking_id),
    channexPropertyId: str(p.property_id) ?? str(root.property_id),
    guestName: str(p.guest_name) ?? str(p.meta?.name) ?? str(p.sender_name),
  };
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
    if (rt) return listings.find((l) => l.channex_room_type_id === rt) ?? null;
  }
  // 2) Conversa na Channex expõe o listing id do Airbnb.
  if (m.threadId) {
    const t = await channex<{ data?: unknown }>(`/message_threads/${m.threadId}`).catch(() => null);
    const listingId = findListingId(t?.data);
    if (listingId) return listings.find((l) => l.airbnb_listing_id === listingId) ?? null;
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
  },
): Promise<{ ok: boolean; messageId?: string; text: string }> {
  const text = toAirbnbPlainText(p.text);
  if (!text) return { ok: false, text };
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

/** Processa um evento `message` da fila Channex. */
export async function handleChannexMessage(payload: unknown): Promise<void> {
  const m = parseChannexMessage(payload);
  if (!m || !m.threadId) return;
  if (m.sender !== "guest") {
    // Mensagem programada do Airbnb: vira contexto para a IA, sem pausá-la.
    // Anfitrião falando de verdade → IA se cala nessa conversa (30 min, renovável).
    const automated = isAutomatedHostMessage(payload, m.text);
    await pauseOnHostMessage(m, automated).catch((e: unknown) => console.error("[channex-messages] pausa falhou", e));
    return;
  }

  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");

  // Idempotência: mesma mensagem não é processada duas vezes.
  if (m.messageId) {
    const { data: dup } = await admin
      .from("property_chat_messages")
      .select("id")
      .eq("channel", "airbnb" as never)
      .eq("external_id", m.messageId)
      .maybeSingle();
    if (dup) return;
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

  await admin.from("property_chat_messages").insert({
    conversation_id: convId,
    role: "user",
    content: m.text,
    sender_type: "guest",
    channel: "airbnb" as never,
    external_id: m.messageId,
    delivery_status: "delivered",
  });
  await admin
    .from("property_chat_conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", convId);

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
        guestMessage: m.text,
      });
    } catch (e) {
      console.error("[channex-messages] push falhou", e);
    }
    return;
  }

  if (!prop || !process.env["LOVABLE_API_KEY"]) return;

  const { loadAgentHistory } = await import("@/lib/chat-audio.server");
  const history = await loadAgentHistory(admin, convId, 20);
  const reservation = await hasConfirmedReservation(admin, listing.property_id, m).catch(() => ({
    ok: false,
    checkin: null,
    checkout: null,
  }));
  const inquiry = await loadInquiryDetails(admin, m.threadId).catch(() => null);
  const { runHospitalityAgent } = await import("@/lib/ai/orchestrator.server");
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
    channelReference: m.threadId,
    reservationVerified: reservation.ok,
    checkinDate: reservation.checkin ?? inquiry?.checkin ?? null,
    checkoutDate: reservation.checkout ?? inquiry?.checkout ?? null,
    bookingRequest: inquiry,
  });

  if (result.handoff) {
    await admin
      .from("property_chat_conversations")
      .update({
        status: "needs_human",
        ai_paused: false,
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

  // Rechecagem na hora do envio: a chave pode ter sido desligada ou o anfitrião
  // pode ter falado enquanto a IA pensava. Nesse caso, a resposta é descartada.
  const [{ data: sw }, { data: conv }] = await Promise.all([
    admin.from("property_listing_raw_data").select("airbnb_ai_enabled").eq("property_id", listing.property_id).maybeSingle(),
    admin.from("property_chat_conversations").select("ai_paused, paused_until").eq("id", convId).maybeSingle(),
  ]);
  const { isPausedNow } = await import("@/lib/ai/pause");
  if (!(sw as any)?.airbnb_ai_enabled || isPausedNow(conv as never)) return;
  let externalId: string | null = null;
  let status: "sent" | "failed" = "sent";
  try {
    externalId = await sendChannexThreadMessage(m.threadId, reply);
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

/** Mensagem do anfitrião vinda do Airbnb: registra e (se humana) pausa a IA. */
async function pauseOnHostMessage(m: Inbound, automated = false): Promise<void> {
  if (!m.threadId) return;
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const { pausePatch } = await import("@/lib/ai/pause");
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
      .eq("sender_type", "ai")
      .gte("created_at", since);
    const isEcho = ((aiRecent ?? []) as Array<{ external_id: string | null; content: string | null }>).some(
      (r) => (m.messageId && r.external_id === m.messageId) || norm(String(r.content ?? "")) === norm(m.text),
    );
    if (isEcho) continue;
    if (!automated) await admin.from("property_chat_conversations").update(pausePatch()).eq("id", c.id);
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
