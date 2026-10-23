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

/**
 * Previsão de horário (chegada/saída) dita pelo hóspede → painel
 * (`guest_arrival_status.arrival_time_override`), INDEPENDENTE da IA: roda na
 * entrada da mensagem, antes de qualquer trava de pausa, então vale também
 * quando o atendimento é humano. Mesma validação/segurança de
 * `registerStayTimeForecast` (nunca regride, não sobrescreve horário da equipe,
 * respeita o horário permitido do imóvel).
 */
export async function applyStayForecastOnIngest(
  admin: SupabaseClient,
  p: { conversationId: string; propertyId: string; message: string },
): Promise<{ ok: boolean; kind?: "checkin" | "checkout"; time?: string } | null> {
  const { detectStayForecast, registerStayTimeForecast } = await import("./stay-intent-resolver.server");
  const forecast = detectStayForecast(p.message);
  if (!forecast) return null;

  const { data: conv } = await admin
    .from("property_chat_conversations")
    .select("reservation_id, guest_name")
    .eq("id", p.conversationId)
    .maybeSingle();
  const guestName = (conv as { guest_name?: string | null } | null)?.guest_name ?? null;

  const { findStayForEvent } = await import("./stay-events.server");
  const stay = await findStayForEvent(admin, {
    propertyId: p.propertyId,
    checkinDate: null,
    checkoutDate: null,
    conversationId: p.conversationId,
  });
  if (!stay) return null;

  const res = await registerStayTimeForecast(
    admin,
    { propertyId: p.propertyId, checkinDate: stay.checkinDate, checkoutDate: stay.checkoutDate, guestName },
    { kind: forecast.kind, time: forecast.time },
  );
  return res.ok ? { ok: true, kind: forecast.kind, time: res.horario ?? forecast.time } : null;
}

/* ───────────────────────── Memória contínua entre canais ─────────────────────────
 * Hóspede que já falava no Airbnb e abre o Guia com o código da reserva NÃO começa
 * do zero: as conversas recentes (7 dias) da MESMA reserva, em qualquer canal, entram
 * no histórico que a IA lê. A conversa do Guia continua sendo a do navegador (a sessão
 * é a credencial do polling); o que se unifica é a memória.
 */
export type HistoryTurn = { role: string; content: string; at?: string | null };

/** Junta o histórico da própria conversa com o de outros canais, em ordem cronológica. */
export function mergeCrossChannelHistory(own: HistoryTurn[], others: HistoryTurn[], limit = 30): HistoryTurn[] {
  if (others.length === 0) return own;
  const t = (x: HistoryTurn) => (x.at ? new Date(x.at).getTime() : 0);
  const seen = new Set<string>();
  const merged = [...others, ...own]
    .map((x, i) => ({ x, i }))
    .sort((a, b) => t(a.x) - t(b.x) || a.i - b.i)
    .map(({ x }) => x)
    .filter((x) => {
      const k = `${x.role}|${x.at ?? ""}|${x.content}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  return merged.slice(-limit);
}

/** Mensagens recentes de OUTRAS conversas ligadas à mesma reserva (Airbnb, WhatsApp, Guia). */
export async function loadReservationSiblingHistory(
  admin: SupabaseClient,
  p: { conversationId: string; days?: number; perConversation?: number; maxConversations?: number },
): Promise<HistoryTurn[]> {
  const { data: conv } = await admin
    .from("property_chat_conversations")
    .select("reservation_id")
    .eq("id", p.conversationId)
    .maybeSingle();
  const rid = (conv as { reservation_id?: string | null } | null)?.reservation_id ?? null;
  if (!rid) return [];
  const since = new Date(Date.now() - (p.days ?? 7) * 86_400_000).toISOString();
  const { data: sibs } = await admin
    .from("property_chat_conversations")
    .select("id")
    .eq("reservation_id", rid)
    .neq("id", p.conversationId)
    .gte("last_message_at", since)
    .order("last_message_at", { ascending: false })
    .limit(p.maxConversations ?? 4);
  const { loadAgentHistory } = await import("@/lib/chat-audio.server");
  const out: HistoryTurn[] = [];
  for (const s of (sibs ?? []) as Array<{ id: string }>) {
    const h = await loadAgentHistory(admin, s.id, p.perConversation ?? 20);
    out.push(...h.filter((m) => !m.at || m.at >= since));
  }
  return out;
}
