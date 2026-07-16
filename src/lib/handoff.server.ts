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
  const bodyText = (opts.guestMessage?.trim() || opts.reason?.trim() || `${guest} pediu atendimento humano.`).slice(0, 220);
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
