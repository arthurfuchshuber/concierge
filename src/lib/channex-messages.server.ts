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
    // Anfitrião falando de verdade → IA se cala nessa conversa (10 min, renovável).
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

  const guestMsgAt = new Date().toISOString();
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
  await admin
    .from("property_chat_conversations")
    .update({
      ai_reply_due_at: new Date(Date.now() + AI_REPLY_DEBOUNCE_MS).toISOString(),
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

/** Espera sem novas mensagens antes de a IA responder (15–20 s: o hóspede costuma mandar frases em sequência). */
export const AI_REPLY_DEBOUNCE_MS = 15_000;

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
      .in("sender_type", ["human", "system"])
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
      .in("sender_type", ["ai", "human"])
      .gte("created_at", since);
    const isEcho = ((aiRecent ?? []) as Array<{ external_id: string | null; content: string | null }>).some(
      (r) => (m.messageId && r.external_id === m.messageId) || norm(String(r.content ?? "")) === norm(m.text),
    );
    if (isEcho) continue;
    if (!automated) {
      await admin.from("property_chat_conversations").update(pausePatch()).eq("id", c.id);
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
