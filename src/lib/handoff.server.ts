// Server-only helpers for handoff notifications. Load inside handlers.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { sendPushToSubscriptions, type PushPayload } from "@/lib/push.server";

type Admin = SupabaseClient<Database>;

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
  opts: { userIds: string[]; conversationId: string; propertyName: string | null; guestName: string | null; guestMessage: string | null; checkinDate: string | null; reason: string | null; urgency: string | null },
) {
  if (opts.userIds.length === 0) return { sent: 0, failed: 0 };
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("user_id", opts.userIds)
    .eq("enabled", true);
  if (!subs || subs.length === 0) return { sent: 0, failed: 0 };

  const guest = opts.guestName?.trim() || "Hóspede";
  let checkinLabel = "";
  if (opts.checkinDate) {
    try {
      const [y, m, d] = opts.checkinDate.split("-").map(Number);
      if (y && m && d) checkinLabel = ` • check-in ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
    } catch {
      // ignore
    }
  }
  // Preferimos o `reason` (resumo gerado pela IA em 3ª pessoa: "Hóspede está
  // perguntando sobre X…") — é mais útil para o anfitrião do que a mensagem
  // crua do hóspede. Cai para a mensagem original se o resumo não veio.
  const bodyText = (opts.reason?.trim() || opts.guestMessage?.trim() || `${guest} pediu atendimento humano.`).slice(0, 220);
  const payload: PushPayload = {
    title: `${guest}${checkinLabel}`,
    body: bodyText,
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

  const guest = opts.guestName?.trim() || "Hóspede";
  const payload: PushPayload = {
    title: `${guest} respondeu`,
    body: opts.guestMessage.trim().slice(0, 220) || "Nova mensagem na conversa.",
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
      title: "Conversa ainda em aberto",
      body: `${guest}${prop?.name ? ` — ${prop.name}` : ""} continua aguardando resposta.`,
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
