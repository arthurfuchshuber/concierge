/**
 * Ocupação do calendário do imóvel do turno (11/11/2026, caso Gleison + diretivas de calendário dinâmico).
 * Somente leitura, projeções fechadas: reservas só com `RESERVATION_COLUMNS` (id, imóvel, status, origem, datas;
 * nenhum nome, contato, valor ou texto de outro hóspede) e, da própria conversa, só o texto das últimas mensagens
 * do hóspede, para achar as DATAS citadas (nunca vai ao modelo por aqui).
 *
 * Janela dinâmica (`calendarWindow`): estadia ⇒ véspera da entrada até 3 dias após a saída; datas citadas ⇒ o
 * intervalo citado, mesmo meses à frente; nada disso ⇒ próximos 14 dias. O imóvel vem SEMPRE do turno validado.
 * Anúncios gêmeos (`channex_twin_links`) não têm imóvel próprio no ConciergeIA: as reservas deles já entram no
 * `property_id` do imóvel principal (conferido em produção em 11/11/2026), então o filtro por imóvel cobre a
 * unidade física inteira. Erro de leitura lança (o builder trata como indisponível; a IA não presume livre).
 */
import { assertIssued } from "@/lib/guest-ai/trust";
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import { buildOccupancy, calendarWindow, extractMentionedDates, type CalendarRow, type PropertyCalendarOccupancy } from "@/lib/guest-ai/calendar-occupancy";
import { getGuestAiDb, type GuestAiDb } from "./client.server";
import { CALENDAR_GUEST_TEXT_COLUMNS, RESERVATION_COLUMNS, cols } from "./projections";

/** Quantas mensagens recentes do hóspede são lidas para achar datas citadas. */
export const CALENDAR_GUEST_TEXT_MESSAGES = 6;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function fetchPropertyOccupancy(
  turn: ValidatedTurn,
  opts: { today: string; guestTexts?: readonly string[] },
  deps?: { db?: GuestAiDb },
): Promise<PropertyCalendarOccupancy> {
  assertIssued("turn", turn, "data_requires_validated_turn");
  const db = deps?.db ?? (await getGuestAiDb());

  // 1) estadia da conversa (só se for do MESMO imóvel)
  let stay: { checkin: string; checkout: string } | null = null;
  if (turn.reservationId) {
    const { data, error } = await db.from("property_reservations").select(cols(RESERVATION_COLUMNS)).eq("id", turn.reservationId).maybeSingle();
    if (error) throw new Error("property_calendar_lookup_failed");
    const r = (data ?? null) as CalendarRow | null;
    if (r && r.property_id === turn.propertyId && ISO_DATE.test(r.checkin_date ?? "") && ISO_DATE.test(r.checkout_date ?? "")) {
      stay = { checkin: r.checkin_date!, checkout: r.checkout_date! };
    }
  }

  // 2) datas citadas pelo hóspede nas últimas mensagens (consulta de datas futuras, mesmo meses à frente)
  let texts = opts.guestTexts;
  if (!texts) {
    const { data, error } = await db
      .from("property_chat_messages")
      .select(cols(CALENDAR_GUEST_TEXT_COLUMNS))
      .eq("conversation_id", turn.conversationId)
      .eq("role", "user")
      .eq("sender_type", "guest")
      .order("created_at", { ascending: false })
      .limit(CALENDAR_GUEST_TEXT_MESSAGES);
    if (error) throw new Error("property_calendar_lookup_failed");
    texts = ((data ?? []) as Array<{ content?: unknown; is_internal_note?: unknown }>)
      .filter((m) => m.is_internal_note !== true)
      .map((m) => (typeof m.content === "string" ? m.content : ""));
  }
  const mentionedDates = [...new Set(texts.flatMap((t) => extractMentionedDates(t, opts.today)))].sort();

  // 3) ocupação na janela dinâmica
  const win = calendarWindow({ today: opts.today, stay, mentionedDates });
  const { data, error } = await db
    .from("property_reservations")
    .select(cols(RESERVATION_COLUMNS))
    .eq("property_id", turn.propertyId)
    .in("status", ["confirmed", "blocked"])
    .gt("checkout_date", win.start)
    .lte("checkin_date", win.end)
    .order("checkin_date", { ascending: true })
    .limit(300);
  if (error) throw new Error("property_calendar_lookup_failed");
  return buildOccupancy((data ?? []) as CalendarRow[], {
    propertyId: turn.propertyId,
    today: opts.today,
    windowStart: win.start,
    windowEnd: win.end,
    excludeReservationId: turn.reservationId,
    stay,
    mentionedDates,
  });
}
