/**
 * CÓDIGO DE RESERVA É SOBERANO (19/10/2026).
 *
 * Toda conversa (Airbnb, Guia, WhatsApp) é ligada à reserva oficial SOMENTE
 * pelo código da reserva — nunca por nome. Assim as conversas da mesma
 * reserva se unificam no painel e o cabeçalho mostra a reserva certa.
 *
 * Também roda a baixa automática de check-in/check-out a cada mensagem do
 * hóspede, mesmo com a IA pausada ou desligada: a confirmação do hóspede é um
 * fato operacional, não depende de quem responde.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const okStatus = (s: unknown) => !/cancel|inquiry|request|pending|declin|expired/i.test(String(s ?? ""));

export function normalizeReservationCode(raw: string | null | undefined): string | null {
  const c = String(raw ?? "").trim().toUpperCase().replace(/^ABB-/, "");
  return /^[A-Z0-9-]{3,40}$/.test(c) ? c : null;
}

/** Acha a reserva oficial do imóvel pelo código. */
export async function findReservationIdByCode(
  admin: SupabaseClient,
  propertyId: string,
  rawCode: string | null | undefined,
): Promise<string | null> {
  const code = normalizeReservationCode(rawCode);
  if (!code) return null;
  const [a, b] = await Promise.all([
    admin.from("property_reservations").select("id, status").eq("property_id", propertyId).eq("guest_contacts->>code", code).limit(5),
    admin.from("property_reservations").select("id, status").eq("property_id", propertyId).eq("guest_hint", code).limit(5),
  ]);
  const rows = [...((a.data ?? []) as Array<{ id: string; status: string | null }>), ...((b.data ?? []) as Array<{ id: string; status: string | null }>)];
  return rows.find((r) => okStatus(r.status))?.id ?? null;
}

/** Grava o vínculo da conversa com a reserva (só se ainda não houver um). */
export async function linkConversationByCode(
  admin: SupabaseClient,
  p: { conversationId: string; propertyId: string; code: string | null | undefined },
): Promise<string | null> {
  const { data: conv } = await admin
    .from("property_chat_conversations")
    .select("reservation_id")
    .eq("id", p.conversationId)
    .maybeSingle();
  const current = (conv as { reservation_id?: string | null } | null)?.reservation_id ?? null;
  if (current) return current;
  const rid = await findReservationIdByCode(admin, p.propertyId, p.code);
  if (!rid) return null;
  await admin.from("property_chat_conversations").update({ reservation_id: rid }).eq("id", p.conversationId);
  return rid;
}

/**
 * Baixa de check-in/check-out a partir da fala do hóspede, independente da IA.
 * Só age quando a conversa já está ligada a uma reserva (pelo código).
 */
export async function applyStayCompletionOnIngest(
  admin: SupabaseClient,
  p: { conversationId: string; propertyId: string; message: string },
): Promise<"checkin" | "checkout" | null> {
  const { detectStayCompletion } = await import("./stay-completion-detect");
  const kind = detectStayCompletion(p.message, "");
  if (!kind) return null;
  const { data: conv } = await admin
    .from("property_chat_conversations")
    .select("reservation_id")
    .eq("id", p.conversationId)
    .maybeSingle();
  if (!(conv as { reservation_id?: string | null } | null)?.reservation_id) return null;
  const { findStayForEvent, applyStayEvent } = await import("./stay-events.server");
  const stay = await findStayForEvent(admin, {
    propertyId: p.propertyId,
    checkinDate: null,
    checkoutDate: null,
    conversationId: p.conversationId,
  });
  if (!stay) return null;
  const r = await applyStayEvent(admin, stay, kind);
  return r.ok ? kind : null;
}
