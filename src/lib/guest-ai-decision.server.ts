/**
 * DECISÃO HUMANA COM 1 CLIQUE — servidor (10/11/2026, SQL e mockup aprovados pelo titular).
 *
 * Fica FORA de `src/lib/guest-ai/` de propósito (aquele módulo é somente leitura), como `guest-ai-ops-apply`.
 *  - `hasPendingDecision`: o slot consulta antes de qualquer geração; pendente ⇒ silêncio absoluto da IA.
 *  - `openHumanDecision`: o pedido de exceção vira UMA decisão pendente (RPC `guest_ai_decision_open`) com
 *    pergunta curta e botões; a IA não diz nada ao hóspede (nada de frase de espera).
 *  - `decideHumanDecision`: o clique. Trava atômica no banco (`guest_ai_decision_claim`, em nome do usuário logado)
 *    ⇒ ação oficial (late check-out: `internal_set_late_checkout` em nome de quem clicou; o banco confere a
 *    permissão) ⇒ UMA resposta da IA pelo canal de origem ⇒ `guest_ai_decision_mark_reply`.
 *    "Eu assumo a conversa" ⇒ a conversa passa a ser de quem clicou e a IA fica em silêncio (`silent`).
 * Tabela ausente (migração ainda não aplicada) ou erro de leitura ⇒ comportamento de antes (encaminhamento
 * normal). D9 intocada: nenhuma credencial é lida para o hóspede; as do imóvel só entram como valores proibidos.
 */
import {
  buildDecisionOptions,
  buildDecisionQuestion,
  decisionHandoffReason,
  decisionKindFromRequests,
  extractRequestedTime,
  parseBurstRequests,
  DECISION_COLUMNS,
  type DecisionKind,
  type DecisionOption,
  type ExceptionRequest,
  type HumanDecisionRow,
} from "@/lib/guest-ai-decision";
import type { DecisionReplyInput } from "@/lib/guest-ai-decision-reply.server";

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface DecisionDb {
  from(table: string): any;
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: any; error: { message?: string } | null }>;
}

async function adminDb(): Promise<DecisionDb> {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin as unknown as DecisionDb;
}

const PROPERTY_COLUMNS = "id, name, owner_id, checkout_time, checkin_time, checkin_time_max, wifi_password, gate_code, lock_code, pin_code";

/** Há decisão pendente na conversa? Erro de leitura (ou tabela ausente) ⇒ `false` (segue o fluxo de antes). */
/** Uma decisão pendente só cala a IA por até 2 h (caso Carlos, 12/11/2026: ficou pendente por 21 h). */
export const PENDING_DECISION_TTL_MS = 2 * 3600 * 1000;

/**
 * Há decisão PENDENTE que ainda cala a IA nesta conversa? Só se foi aberta há menos de 2 h E nenhum atendente
 * humano falou com o hóspede depois dela (fala humana = pendência tratada; a IA volta nas mensagens seguintes).
 * O cartão continua no painel até alguém decidir; só deixa de bloquear a IA. Falha de leitura ⇒ não bloqueia.
 */
export async function hasPendingDecision(
  conversationId: string,
  deps: { db?: DecisionDb; now?: () => number } = {},
): Promise<boolean> {
  try {
    const db = deps.db ?? (await adminDb());
    const nowMs = (deps.now ?? Date.now)();
    const since = new Date(nowMs - PENDING_DECISION_TTL_MS).toISOString();
    const { data, error } = await db
      .from("guest_ai_human_decisions")
      .select("id, created_at")
      .eq("conversation_id", conversationId)
      .eq("status", "pending")
      .gt("created_at", since)
      .order("created_at", { ascending: true })
      .limit(1);
    if (error || !Array.isArray(data) || data.length === 0) return false;
    const openedAt = (data[0] as { created_at?: string }).created_at;
    if (!openedAt) return true;
    const human = await db
      .from("property_chat_messages")
      .select("id")
      .eq("conversation_id", conversationId)
      .eq("role", "assistant")
      .eq("sender_type", "human")
      .gt("created_at", openedAt)
      .limit(1);
    if (human.error) return true; // não sabe se a equipe falou: mantém a pendência (cartão recente)
    return !(Array.isArray(human.data) && human.data.length > 0);
  } catch {
    return false;
  }
}

export interface OpenDecisionInput {
  conversationId: string;
  triggerMessageId: string;
  /** `formalChangeRequests` da decisão do modelo. */
  formalChangeRequests: readonly string[];
  internalQuestion: string | null;
}

export type OpenDecisionResult =
  | { opened: true; id: string; kind: DecisionKind; reason: string }
  | { opened: false; code: "not_an_exception" | "already_authorized" | "pending_exists" | "exists" | "invalid" | "error"; reason?: string }
  /** Saída tardia com OUTRO check-in no dia da saída: não há o que decidir; a saída é pontual (aviso à equipe). */
  | { opened: false; code: "same_day_turnover"; reason: string };


/**
 * Viradas no mesmo dia da reserva da conversa (11/11/2026): outra reserva CONFIRMADA do mesmo imóvel chegando no
 * dia da nossa saída, ou saindo no dia da nossa entrada. Anúncios gêmeos (`channex_twin_links`) não têm imóvel
 * próprio no ConciergeIA: as reservas deles já entram no `property_id` do imóvel principal, então a consulta
 * por imóvel cobre as duas listagens. Sem reserva ou falha de leitura ⇒ `null` (desconhecido).
 */
export async function loadTurnoverFlags(
  db: DecisionDb,
  propertyId: string,
  reservationId: string | null,
): Promise<{ sameDayArrival: boolean | null; sameDayDeparture: boolean | null }> {
  const unknown = { sameDayArrival: null, sameDayDeparture: null };
  if (!reservationId) return unknown;
  try {
    const { data: res } = await db.from("property_reservations").select("checkin_date, checkout_date").eq("id", reservationId).maybeSingle();
    const checkin = typeof res?.checkin_date === "string" ? res.checkin_date : null;
    const checkout = typeof res?.checkout_date === "string" ? res.checkout_date : null;
    const other = async (col: "checkin_date" | "checkout_date", date: string | null) => {
      if (!date) return null;
      const { data, error } = await db
        .from("property_reservations")
        .select("id")
        .eq("property_id", propertyId)
        .eq(col, date)
        .neq("id", reservationId)
        .eq("status", "confirmed")
        .limit(1);
      if (error) return null;
      return Array.isArray(data) ? data.length > 0 : null;
    };
    const [sameDayArrival, sameDayDeparture] = await Promise.all([other("checkin_date", checkout), other("checkout_date", checkin)]);
    return { sameDayArrival, sameDayDeparture };
  } catch {
    return unknown;
  }
}

/** Janela da rajada: mensagens do hóspede desde a última resposta (IA/equipe), no máximo 3 minutos antes do gatilho. */
export const BURST_WINDOW_MS = 3 * 60_000;

/** Mesma leitura da rajada com o cliente administrativo padrão (o slot não conhece cliente de banco). */
export async function loadGuestBurstFor(conversationId: string, triggerMessageId: string): Promise<string[]> {
  return loadGuestBurst(await adminDb(), conversationId, triggerMessageId);
}

/** Textos das mensagens do hóspede da rajada que termina em `triggerMessageId` (da mais antiga à mais nova). */
export async function loadGuestBurst(
  db: DecisionDb,
  conversationId: string,
  triggerMessageId: string,
): Promise<string[]> {
  const { data: trig } = await db
    .from("property_chat_messages")
    .select("id, content, created_at")
    .eq("id", triggerMessageId)
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (!trig?.created_at) return typeof trig?.content === "string" ? [trig.content] : [];
  const since = new Date(Date.parse(trig.created_at) - BURST_WINDOW_MS).toISOString();
  const { data } = await db
    .from("property_chat_messages")
    .select("id, content, created_at, sender_type, is_internal_note")
    .eq("conversation_id", conversationId)
    .gte("created_at", since)
    .lte("created_at", trig.created_at)
    .order("created_at", { ascending: false })
    .limit(15);
  const out: string[] = [];
  for (const m of (data ?? []) as Array<{ content: string | null; sender_type: string | null; is_internal_note: boolean | null }>) {
    if (m.is_internal_note) continue;
    if (m.sender_type !== "guest") break; // resposta da IA/equipe encerra a rajada
    if (typeof m.content === "string" && m.content.trim()) out.push(m.content);
  }
  if (out.length === 0 && typeof trig.content === "string") out.push(trig.content);
  return out.reverse();
}

/** Abre a decisão pendente para um pedido de exceção do hóspede. Nunca lança. */
export async function openHumanDecision(input: OpenDecisionInput, deps: { db?: DecisionDb } = {}): Promise<OpenDecisionResult> {
  const modelKind = decisionKindFromRequests(input.formalChangeRequests);
  if (!modelKind) return { opened: false, code: "not_an_exception" };
  try {
    const db = deps.db ?? (await adminDb());
    const { data: conv } = await db
      .from("property_chat_conversations")
      .select("id, property_id, guest_name, reservation_id")
      .eq("id", input.conversationId)
      .maybeSingle();
    if (!conv?.property_id) return { opened: false, code: "invalid" };
    const { data: prop } = await db.from("properties").select(PROPERTY_COLUMNS).eq("id", conv.property_id).maybeSingle();
    if (!prop?.owner_id) return { opened: false, code: "invalid" };
    const { data: msg } = await db
      .from("property_chat_messages")
      .select("id, content")
      .eq("id", input.triggerMessageId)
      .eq("conversation_id", input.conversationId)
      .maybeSingle();
    const triggerText = typeof msg?.content === "string" ? msg.content : "";
    // RAJADA: o pedido é lido em todas as mensagens do hóspede desde a última resposta, não só na última.
    const burstTexts = await loadGuestBurst(db, input.conversationId, input.triggerMessageId).catch(() => [triggerText]);
    // horários oficiais do imóvel: chegada DEPOIS do início do check-in nunca é entrada antecipada (caso Ary)
    const burst = parseBurstRequests(burstTexts, {
      officialCheckin: prop.checkin_time ?? null,
      officialCheckinMax: prop.checkin_time_max ?? null,
      officialCheckout: prop.checkout_time ?? null,
    });
    const guestMessage = burstTexts.length > 0 ? burstTexts.join("\n") : triggerText;
    // Chegada DENTRO da janela oficial rotulada como "entrada antecipada" (pelo modelo ou pelo fallback): não é
    // exceção; não se abre cartão (diretiva de 11/11/2026, caso Ary).
    if (modelKind === "early_checkin" && !burst.early && !burst.late && !burst.lateArrival && burst.arrivalInWindow) {
      return { opened: false, code: "not_an_exception" };
    }
    // o modelo diz que HÁ exceção; a rajada diz QUAL (e corrige rótulo trocado). Os dois tipos juntos ⇒ um cartão só.
    let kind: DecisionKind = modelKind;
    const both = !!(burst.late && burst.early);
    if (both) kind = "operational_concession";
    // chegada tardia (depois do limite de check-in): recepção fora do horário é concessão, nunca "entrada antecipada"
    else if (burst.lateArrival && !burst.early && !burst.late) kind = "operational_concession";
    else if (modelKind !== "operational_concession" || burst.late || burst.early) {
      if (burst.late && !burst.early) kind = "late_checkout";
      else if (burst.early && !burst.late) kind = "early_checkin";
    }
    const time =
      kind === "late_checkout"
        ? (burst.late?.time ?? extractRequestedTime(triggerText))
        : kind === "early_checkin"
          ? (burst.early?.time ?? extractRequestedTime(triggerText))
          : null;

    // late check-out já concedido no card ⇒ não há o que decidir (a IA responde normalmente)
    if (kind === "late_checkout" && conv.reservation_id) {
      const { data: card } = await db
        .from("guest_arrival_status")
        .select("late_checkout_time")
        .eq("reservation_id", conv.reservation_id)
        .eq("kind", "checkout")
        .limit(1);
      if ((card as Array<{ late_checkout_time?: string | null }> | null)?.[0]?.late_checkout_time)
        return { opened: false, code: "already_authorized" };
    }
    // Viradas no mesmo dia (saída: outra entrada; entrada: outra saída), consideradas as listagens gêmeas.
    const { sameDayArrival, sameDayDeparture } = await loadTurnoverFlags(db, conv.property_id, conv.reservation_id ?? null);
    // Só saída tardia, com outro check-in no dia da saída: a saída é pontual; não se abre cartão de aprovação.
    if (kind === "late_checkout" && !both && sameDayArrival === true) {
      return { opened: false, code: "same_day_turnover", reason: "Pediu saída tardia, mas há outro check-in no mesmo dia: a saída é pontual no horário oficial." };
    }

    const question = buildDecisionQuestion({
      kind,
      guestName: conv.guest_name ?? null,
      time,
      officialCheckout: prop.checkout_time ?? null,
      officialCheckin: prop.checkin_time ?? null,
      sameDayArrival,
      sameDayDeparture,
      internalQuestion: both ? null : input.internalQuestion,
      guestMessage,
      late: burst.late,
      early: burst.early,
      lateArrival: kind === "operational_concession" && !both ? burst.lateArrival : null,
      officialCheckinMax: prop.checkin_time_max ?? null,
    });
    const lateArrivalCard = kind === "operational_concession" && !both && !!burst.lateArrival;
    const options = lateArrivalCard
      ? buildDecisionOptions("operational_concession", null).map((o) =>
          o.id === "approve" ? { ...o, label: "Receber mais tarde" } : o,
        )
      : both
      ? buildDecisionOptions("operational_concession", null).map((o) =>
          o.id === "approve" ? { ...o, label: "Aprovar os dois (cortesia)" } : o,
        )
      : buildDecisionOptions(kind, time);
    const { data, error } = await db.rpc("guest_ai_decision_open", {
      p_tenant_id: prop.owner_id,
      p_property_id: conv.property_id,
      p_conversation_id: input.conversationId,
      p_trigger_message_id: input.triggerMessageId,
      p_kind: kind,
      p_question_text: question,
      p_options: options,
    });
    if (error) return { opened: false, code: "error" };
    const reason = decisionHandoffReason(kind, time);
    const r = (data ?? {}) as { result?: string; id?: string };
    if (r.result === "opened" && r.id) return { opened: true, id: r.id, kind, reason };
    if (r.result === "pending_exists" || r.result === "exists") return { opened: false, code: r.result, reason };
    return { opened: false, code: "invalid" };
  } catch {
    return { opened: false, code: "error" };
  }
}

// ─────────────────────────── O clique ───────────────────────────

export type DecideResult =
  | { ok: true; outcome: "replied" | "silent"; replySource?: "model" | "fallback" }
  | { ok: true; outcome: "reply_failed"; code: string }
  | { ok: false; code: "already_decided"; decidedBy: string | null; decidedAt: string | null; decidedOptionId: string | null }
  | { ok: false; code: "not_found" | "forbidden" | "invalid" | "action_failed" | "late_checkout_rejected" | "not_authorized" | "error" };

export interface DecideDeps {
  db?: DecisionDb;
  reply?: (input: DecisionReplyInput) => Promise<{ text: string; source: "model" | "fallback" }>;
  /** Entrega pelo canal de origem; devolve o id da mensagem gravada ou null quando não entregou. */
  deliver?: (p: { conversationId: string; session: string; propertyId: string; text: string }) => Promise<string | null>;
  now?: () => Date;
}

async function setLateCheckout(
  db: DecisionDb,
  p: { propertyId: string; reservationId: string; actor: string; time: string },
): Promise<"ok" | "late_checkout_rejected" | "not_authorized" | "action_failed"> {
  const found = await db
    .from("guest_arrival_status")
    .select("id")
    .eq("reservation_id", p.reservationId)
    .eq("kind", "checkout")
    .limit(1);
  if (found.error) return "action_failed";
  let cardId = (found.data as Array<{ id?: unknown }> | null)?.[0]?.id;
  if (typeof cardId !== "string") {
    const ins = await db
      .from("guest_arrival_status")
      .insert({ property_id: p.propertyId, reservation_id: p.reservationId, kind: "checkout" })
      .select("id");
    cardId = (ins.data as Array<{ id?: unknown }> | null)?.[0]?.id;
    if (ins.error || typeof cardId !== "string") return "action_failed";
  }
  const r = await db.rpc("internal_set_late_checkout", { _arrival_status_id: cardId, _actor: p.actor, _time: p.time });
  if (!r.error) return "ok";
  const e = r.error.message ?? "";
  if (/late_checkout_(forbidden|requires_identity)|internal_actor_required/.test(e)) return "not_authorized";
  if (/late_checkout_(must_be_after_official|requires_official_checkout|invalid_time|checkout_only)/.test(e))
    return "late_checkout_rejected";
  return "action_failed";
}

/** Entrega padrão: Airbnb pela Channex (como a IA), WhatsApp em standby (não entrega), guia grava no chat. */
async function defaultDeliver(p: { conversationId: string; session: string; propertyId: string; text: string }): Promise<string | null> {
  const db = await adminDb();
  if (p.session.startsWith("airbnb:")) {
    const { deliverToAirbnbThread } = await import("@/lib/channex-messages.server");
    const r = await deliverToAirbnbThread(db, {
      conversationId: p.conversationId,
      threadId: p.session.slice("airbnb:".length),
      propertyId: p.propertyId,
      text: p.text,
      senderType: "ai",
    });
    return r.ok ? (r.messageId ?? null) : null;
  }
  if (p.session.startsWith("wa:") || p.session.startsWith("whatsapp:")) return null; // canal em standby
  const { data, error } = await db
    .from("property_chat_messages")
    .insert({ conversation_id: p.conversationId, role: "assistant", content: p.text, sender_type: "ai" })
    .select("id")
    .single();
  if (error || !data?.id) return null;
  void (async () => {
    try {
      const { data: c } = await db
        .from("property_chat_conversations")
        .select("properties:property_id(name, slug, city)")
        .eq("id", p.conversationId)
        .maybeSingle();
      const pr = (c?.properties ?? null) as { name?: string; slug?: string; city?: string | null } | null;
      const { sendPushToGuest } = await import("@/lib/guest-push.server");
      const { guestPushBody } = await import("@/lib/push-format");
      const city = (pr?.city ?? "").split(",")[0]?.trim() ?? "";
      await sendPushToGuest(p.conversationId, {
        title: pr?.name?.trim() || "Anfitrião",
        body: guestPushBody(city, p.text),
        data: { url: pr?.slug ? `/g/${pr.slug}?chat=1` : "/", conversationId: p.conversationId, tag: `guest-reply-${p.conversationId}` },
      });
    } catch {
      /* push é melhor esforço */
    }
  })();
  return String(data.id);
}

/** O clique da equipe. `userId` vem SEMPRE da sessão autenticada. Nunca lança. */
export async function decideHumanDecision(
  input: { decisionId: string; optionId: string; userId: string },
  deps: DecideDeps = {},
): Promise<DecideResult> {
  try {
    const db = deps.db ?? (await adminDb());
    // 1) trava atômica contra duplo clique (o banco também confere o acesso de quem clicou ao imóvel)
    const claim = await db.rpc("guest_ai_decision_claim", {
      p_decision_id: input.decisionId,
      p_actor: input.userId,
      p_option_id: input.optionId,
    });
    if (claim.error) return { ok: false, code: "error" };
    const c = (claim.data ?? {}) as Record<string, any>;
    if (c.result === "already_decided")
      return {
        ok: false,
        code: "already_decided",
        decidedBy: c.decided_by ?? null,
        decidedAt: null,
        decidedOptionId: c.decided_option_id ?? null,
      };
    if (c.result === "not_found") return { ok: false, code: "not_found" };
    if (c.result === "forbidden") return { ok: false, code: "forbidden" };
    if (c.result !== "claimed") return { ok: false, code: "invalid" };
    const option = c.option as DecisionOption;

    const { data: row } = await db.from("guest_ai_human_decisions").select(DECISION_COLUMNS).eq("id", input.decisionId).maybeSingle();
    const d = row as HumanDecisionRow | null;
    if (!d) return { ok: false, code: "not_found" };
    const { data: conv } = await db
      .from("property_chat_conversations")
      .select("id, property_id, guest_name, guest_session_id, reservation_id, status")
      .eq("id", d.conversation_id)
      .maybeSingle();
    if (!conv) return { ok: false, code: "not_found" };

    // 2) "Eu assumo a conversa": a conversa passa a ser de quem clicou; IA em silêncio, nada vai ao hóspede
    if (option.ai_intent === "assume") {
      await db
        .from("property_chat_conversations")
        .update({ status: "assigned", assigned_to: input.userId, claim_requested_by: null, claim_requested_at: null })
        .eq("id", d.conversation_id);
      await db.rpc("guest_ai_decision_mark_reply", { p_decision_id: d.id, p_status: "silent", p_message_id: null });
      return { ok: true, outcome: "silent" };
    }

    // 3) ação oficial (late check-out aprovado com horário)
    if (d.kind === "late_checkout" && option.ai_intent === "approve" && option.time) {
      if (!conv.reservation_id) {
        await db.rpc("guest_ai_decision_mark_reply", { p_decision_id: d.id, p_status: "error", p_message_id: null });
        return { ok: false, code: "action_failed" };
      }
      const r = await setLateCheckout(db, {
        propertyId: conv.property_id,
        reservationId: conv.reservation_id,
        actor: input.userId,
        time: option.time,
      });
      if (r !== "ok") {
        // nada é dito ao hóspede: a equipe responde manualmente
        await db.rpc("guest_ai_decision_mark_reply", { p_decision_id: d.id, p_status: "error", p_message_id: null });
        return { ok: false, code: r };
      }
    }

    // 4) UMA resposta da IA pelo canal de origem
    const { data: prop } = await db.from("properties").select(PROPERTY_COLUMNS).eq("id", conv.property_id).maybeSingle();
    const { data: msg } = await db
      .from("property_chat_messages")
      .select("content")
      .eq("id", d.trigger_message_id)
      .maybeSingle();
    // a resposta considera TODA a rajada do hóspede (ex.: saída tardia + entrada antecipada), não só o gatilho
    const burstTexts = await loadGuestBurst(db, d.conversation_id, d.trigger_message_id).catch(() => [] as string[]);
    const guestText = burstTexts.length > 0 ? burstTexts.join("\n") : typeof msg?.content === "string" ? msg.content : "";
    const replyInput: DecisionReplyInput = {
      kind: d.kind,
      intent: option.ai_intent,
      time: option.time ?? null,
      officialCheckout: prop?.checkout_time ?? null,
      officialCheckin: prop?.checkin_time ?? null,
      guestName: conv.guest_name ?? null,
      guestMessage: guestText,
      propertyName: prop?.name ?? "",
      forbiddenValues: [prop?.wifi_password, prop?.gate_code, prop?.lock_code, prop?.pin_code].filter(
        (v): v is string => typeof v === "string" && v.trim().length > 0,
      ),
    };
    const reply = deps.reply
      ? await deps.reply(replyInput)
      : await (await import("@/lib/guest-ai-decision-reply.server")).generateDecisionReply(replyInput);
    const deliver = deps.deliver ?? defaultDeliver;
    const messageId = await deliver({
      conversationId: d.conversation_id,
      session: String(conv.guest_session_id ?? ""),
      propertyId: conv.property_id,
      text: reply.text,
    }).catch(() => null);
    if (!messageId) {
      await db.rpc("guest_ai_decision_mark_reply", { p_decision_id: d.id, p_status: "error", p_message_id: null });
      return { ok: true, outcome: "reply_failed", code: "delivery_failed" };
    }
    await db.rpc("guest_ai_decision_mark_reply", { p_decision_id: d.id, p_status: "sent", p_message_id: messageId });
    // a exceção foi resolvida: o chamado sai da fila humana (só se ninguém assumiu a conversa)
    if (conv.status === "needs_human") {
      await db
        .from("property_chat_conversations")
        .update({ status: "ai", handoff_reason: null, handoff_urgency: null, last_message_at: (deps.now ?? (() => new Date()))().toISOString() })
        .eq("id", d.conversation_id)
        .eq("status", "needs_human");
    }
    return { ok: true, outcome: "replied", replySource: reply.source };
  } catch {
    return { ok: false, code: "error" };
  }
}

/** Expira a decisão pendente da conversa (ex.: conversa encerrada pela equipe). Nunca lança. */
export async function expirePendingDecisions(conversationId: string, deps: { db?: DecisionDb } = {}): Promise<void> {
  try {
    const db = deps.db ?? (await adminDb());
    const { data } = await db
      .from("guest_ai_human_decisions")
      .select("id")
      .eq("conversation_id", conversationId)
      .eq("status", "pending");
    for (const r of (data ?? []) as Array<{ id: string }>) await db.rpc("guest_ai_decision_expire", { p_decision_id: r.id });
  } catch {
    /* melhor esforço */
  }
}


/**
 * A equipe respondeu o hóspede por conta própria (painel, Copiloto ou direto no Airbnb): as decisões pendentes da
 * conversa viram "assumidas pela equipe" (sem resposta da IA) e o cartão sai do painel. `actorUserId` é quem
 * respondeu; sem ele (mensagem sincronizada do Airbnb) vale o titular da decisão. Usa só as RPCs da decisão
 * (a tabela é somente leitura). Melhor esforço: nunca lança.
 */
export async function resolvePendingDecisionsOnHumanMessage(
  conversationId: string,
  opts: { actorUserId?: string | null } = {},
  deps: { db?: DecisionDb } = {},
): Promise<number> {
  let resolved = 0;
  try {
    const db = deps.db ?? (await adminDb());
    const { data } = await db
      .from("guest_ai_human_decisions")
      .select("id, tenant_id, options")
      .eq("conversation_id", conversationId)
      .eq("status", "pending");
    for (const r of (data ?? []) as Array<{ id: string; tenant_id: string; options: DecisionOption[] | null }>) {
      const assume = (r.options ?? []).find((o) => o.ai_intent === "assume");
      if (!assume) continue;
      const claim = await db.rpc("guest_ai_decision_claim", {
        p_decision_id: r.id,
        p_actor: opts.actorUserId || r.tenant_id,
        p_option_id: assume.id,
      });
      const c = (claim.data ?? {}) as { result?: string };
      if (claim.error || c.result !== "claimed") continue;
      await db.rpc("guest_ai_decision_mark_reply", { p_decision_id: r.id, p_status: "silent", p_message_id: null });
      resolved += 1;
    }
  } catch {
    /* melhor esforço */
  }
  return resolved;
}
