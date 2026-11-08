// Server-only helpers for handoff notifications. Load inside handlers.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { sendPushToSubscriptions, type PushPayload } from "@/lib/push.server";
import { conversationBody, conversationTitle, truncateText } from "@/lib/push-format";

type Admin = SupabaseClient<Database>;

const MONTHS = ["jan.", "fev.", "mar.", "abr.", "mai.", "jun.", "jul.", "ago.", "set.", "out.", "nov.", "dez."];
/** "2026-10-05","2026-10-14" → "5–14 de out." (meses diferentes: "28 de set. – 3 de out."). */
export function formatStayRange(checkin: string, checkout: string | null): string {
  const p = (s: string) => s.split("-").map(Number) as [number, number, number];
  const [, m1, d1] = p(checkin);
  if (!m1 || !d1) return "";
  if (!checkout) return `${d1} de ${MONTHS[m1 - 1]}`;
  const [, m2, d2] = p(checkout);
  if (m1 === m2) return `${d1}–${d2} de ${MONTHS[m1 - 1]}`;
  return `${d1} de ${MONTHS[m1 - 1]} – ${d2} de ${MONTHS[m2 - 1]}`;
}

/**
 * Período da estadia do hóspede (padrão Airbnb: "4–8 de nov."): reserva
 * confirmada do imóvel cujo hóspede bate pelo primeiro nome (ou pela data de
 * check-in, quando conhecida). Sem reserva → "" (o título fica só o nome).
 */
export async function resolveStayRange(
  admin: Admin,
  opts: { propertyId: string | null | undefined; guestName: string | null | undefined; checkinDate?: string | null },
): Promise<string> {
  if (!opts.propertyId) return "";
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data: rows } = await admin
      .from("property_reservations")
      .select("checkin_date, checkout_date, guest_hint")
      .eq("property_id", opts.propertyId)
      .eq("status", "confirmed")
      .gte("checkout_date", opts.checkinDate && opts.checkinDate < today ? opts.checkinDate : today)
      .order("checkin_date", { ascending: true })
      .limit(10);
    const list = (rows ?? []) as Array<{ checkin_date: string; checkout_date: string; guest_hint: string | null }>;
    if (list.length === 0) return "";
    const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const first = norm(opts.guestName ?? "").split(/\s+/)[0] ?? "";
    const byDate = opts.checkinDate ? list.find((r) => r.checkin_date === opts.checkinDate) : undefined;
    const byName = first ? list.find((r) => r.guest_hint && norm(r.guest_hint).startsWith(first)) : undefined;
    const res = byDate ?? byName;
    return res ? formatStayRange(res.checkin_date, res.checkout_date) : "";
  } catch {
    return "";
  }
}

async function conversationProperty(admin: Admin, conversationId: string): Promise<string | null> {
  const { data: conv } = await admin
    .from("property_chat_conversations")
    .select("property_id")
    .eq("id", conversationId)
    .maybeSingle();
  return (conv as { property_id?: string } | null)?.property_id ?? null;
}

/**
 * Retorna user_ids que devem ser notificados quando um handoff acontece
 * em uma dada propriedade: o owner + os account_members ativos com
 * papel owner/agent (viewers não recebem push).
 */
export async function getPropertyNotifiableUsers(admin: Admin, propertyId: string): Promise<string[]> {
  const { data: prop } = await admin
    .from("properties")
    .select("owner_id")
    .eq("id", propertyId)
    .maybeSingle();
  if (!prop) return [];
  const ownerId = prop.owner_id as string;

  const { data: members } = await admin
    .from("account_members")
    .select("member_user_id, role, status")
    .eq("owner_id", ownerId)
    .eq("status", "active");

  const ids = new Set<string>([ownerId]);
  for (const m of members ?? []) {
    if (m.role === "owner" || m.role === "agent") ids.add(m.member_user_id as string);
  }
  return Array.from(ids);
}

export async function sendHandoffPush(
  admin: Admin,
  opts: {
    userIds: string[];
    conversationId: string;
    propertyName: string | null;
    guestName: string | null;
    guestMessage: string | null;
    checkinDate: string | null;
    reason: string | null;
    urgency: string | null;
    /** Texto fixo no lugar da mensagem (ex.: falha de envio). */
    bodyText?: string | null;
  },
) {
  if (opts.userIds.length === 0) return { sent: 0, failed: 0 };
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("user_id", opts.userIds)
    .eq("enabled", true);
  if (!subs || subs.length === 0) return { sent: 0, failed: 0 };

  // Padrão Airbnb (mockup 07/11/2026): "Nome • 4–8 de nov." / imóvel / mensagem.
  const guest = opts.guestName?.trim() || "Hóspede";
  const propertyId = await conversationProperty(admin, opts.conversationId);
  const range = await resolveStayRange(admin, { propertyId, guestName: opts.guestName, checkinDate: opts.checkinDate });
  // Corpo: a mensagem do hóspede (o que a equipe precisa ler); cai para o
  // motivo do encaminhamento quando não há mensagem. Falha de envio usa o
  // texto aprovado (`bodyText`).
  const message =
    opts.bodyText?.trim() ||
    truncateText(opts.guestMessage || opts.reason || `${guest} precisa de suporte.`, 220);
  const payload: PushPayload = {
    title: conversationTitle(guest, range),
    body: conversationBody(opts.propertyName, message),
    data: {
      url: `/admin/atendimento?conv=${opts.conversationId}`,
      conversationId: opts.conversationId,
      tag: `handoff-${opts.conversationId}`,
      urgency: opts.urgency ?? undefined,
    },
  };

  const res = await sendPushToSubscriptions(
    subs.map((s) => ({ id: s.id as string, endpoint: s.endpoint as string, p256dh: s.p256dh as string, auth: s.auth as string })),
    payload,
  );

  if (res.stale.length) {
    await admin.from("push_subscriptions").delete().in("id", res.stale);
  }
  return { sent: res.sent, failed: res.failed };
}

/**
 * Push pra CADA mensagem nova do hóspede numa conversa que já está com um
 * humano (assigned_to preenchido). Antes, só a mensagem que DISPARAVA o
 * handoff gerava push — qualquer mensagem seguinte do hóspede na mesma
 * conversa (já assumida) não avisava ninguém, mesmo com o atendente
 * esperando resposta. Se a conversa tem um responsável específico
 * (assigned_to), só ele é notificado — não o time inteiro.
 */
export async function sendGuestReplyPush(
  admin: Admin,
  opts: {
    userIds: string[];
    conversationId: string;
    propertyName: string | null;
    guestName: string | null;
    guestMessage: string;
  },
) {
  if (opts.userIds.length === 0) return { sent: 0, failed: 0 };
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("user_id", opts.userIds)
    .eq("enabled", true);
  if (!subs || subs.length === 0) return { sent: 0, failed: 0 };

  // Padrão Airbnb (mockup 07/11/2026): "Nome • 4–8 de nov." / imóvel / mensagem.
  const guest = opts.guestName?.trim() || "Hóspede";
  const propertyId = await conversationProperty(admin, opts.conversationId).catch(() => null);
  const range = await resolveStayRange(admin, { propertyId, guestName: opts.guestName });
  const msg = truncateText(opts.guestMessage, 220) || "Nova mensagem na conversa.";
  const payload: PushPayload = {
    title: conversationTitle(guest, range),
    body: conversationBody(opts.propertyName, msg),
    data: {
      url: `/admin/atendimento?conv=${opts.conversationId}`,
      conversationId: opts.conversationId,
      tag: `handoff-${opts.conversationId}`,
    },
  };

  const res = await sendPushToSubscriptions(
    subs.map((s) => ({ id: s.id as string, endpoint: s.endpoint as string, p256dh: s.p256dh as string, auth: s.auth as string })),
    payload,
  );

  if (res.stale.length) {
    await admin.from("push_subscriptions").delete().in("id", res.stale);
  }
  return { sent: res.sent, failed: res.failed };
}

/**
 * Lembrete horário: conversas assumidas por um humano (assigned_to) que
 * continuam abertas (não resolvidas) recebem um push a cada ~1h avisando
 * que a conversa com o hóspede continua em aberto. Chamado por um cron.
 *
 * Usa `last_reminder_at` (não só `handoff_at`) pra saber quando foi o
 * ÚLTIMO lembrete — sem isso, rodar o cron a cada 15min mandaria push a
 * cada 15min pra qualquer conversa aberta há mais de 1h, não de hora em
 * hora de verdade.
 */
export async function sendOpenConversationReminders(admin: Admin, now = new Date()) {
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const { data: convs } = await admin
    .from("property_chat_conversations")
    .select("id, assigned_to, guest_name, handoff_at, last_reminder_at, properties:property_id(name)")
    .not("assigned_to", "is", null)
    .in("status", ["assigned", "needs_human"])
    .lte("handoff_at", oneHourAgo)
    .or(`last_reminder_at.is.null,last_reminder_at.lte.${oneHourAgo}`);

  let sent = 0;
  let failed = 0;
  for (const c of convs ?? []) {
    const assignedTo = c.assigned_to as string | null;
    if (!assignedTo) continue;
    const prop = Array.isArray(c.properties) ? c.properties[0] : c.properties;
    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", assignedTo)
      .eq("enabled", true);
    // Mesmo sem inscrição de push ativa, marca como "lembrado" agora — evita
    // ficar reconsultando a mesma conversa a cada execução do cron.
    await admin.from("property_chat_conversations").update({ last_reminder_at: now.toISOString() }).eq("id", c.id);
    if (!subs || subs.length === 0) continue;
    const guest = (c.guest_name as string | null)?.trim() || "Hóspede";
    const payload: PushPayload = {
      title: "Conversa ainda em aberto!",
      body: conversationBody(prop?.name ?? null, `${guest} continua aguardando resposta.`),
      data: {
        url: `/admin/atendimento?conv=${c.id}`,
        conversationId: c.id as string,
        tag: `handoff-reminder-${c.id}`,
      },
    };
    const res = await sendPushToSubscriptions(
      subs.map((s) => ({ id: s.id as string, endpoint: s.endpoint as string, p256dh: s.p256dh as string, auth: s.auth as string })),
      payload,
    );
    sent += res.sent;
    failed += res.failed;
    if (res.stale.length) await admin.from("push_subscriptions").delete().in("id", res.stale);
  }
  return { sent, failed, checked: (convs ?? []).length };
}
