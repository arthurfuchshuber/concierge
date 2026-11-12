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
import {
  assessPeriod,
  buildOccupancy,
  calendarWindow,
  extractMentionedDates,
  extractRequestedPeriod,
  parseStayRules,
  type CalendarRow,
  type PeriodAssessment,
  type PortfolioAlternative,
  type PropertyCalendarOccupancy,
  type RequestedPeriod,
  type StayRules,
} from "@/lib/guest-ai/calendar-occupancy";
import { getGuestAiDb, type GuestAiDb } from "./client.server";
import {
  CALENDAR_GUEST_TEXT_COLUMNS,
  LISTING_STAY_RULE_COLUMNS,
  PORTFOLIO_PROPERTY_COLUMNS,
  RESERVATION_COLUMNS,
  cols,
} from "./projections";
import { publicPropertyTitle } from "./public-title";

/** Quantas alternativas do portfólio vão ao modelo, no máximo. */
export const PORTFOLIO_MAX_ALTERNATIVES = 3;

type ListingRuleRow = {
  property_id: string | null;
  airbnb_listing_id: string | null;
  sync_paused_at: string | null;
  not_found_at: string | null;
  availability_rule: unknown;
};

/** Regras do anúncio ATIVO do imóvel (primeiro sem pausa nem "não encontrado"). Falha ⇒ `null` (desconhecida). */
function rulesFrom(rows: readonly ListingRuleRow[], propertyId: string): { rules: StayRules | null; listingId: string | null } {
  const row = rows.find((r) => r.property_id === propertyId && !r.sync_paused_at && !r.not_found_at);
  return { rules: row ? parseStayRules(row.availability_rule) : null, listingId: row?.airbnb_listing_id ?? null };
}

/** Link oficial do anúncio: o cadastrado no imóvel ou o montado pelo id do Airbnb (só dígitos). */
export function listingUrl(registered: string | null | undefined, listingId: string | null | undefined): string | null {
  const reg = (registered ?? "").trim();
  if (/^https:\/\/(?:www\.)?airbnb\.com(?:\.br)?\/rooms\/\d{6,24}$/.test(reg)) return reg;
  const id = (listingId ?? "").trim();
  return /^\d{6,24}$/.test(id) ? `https://www.airbnb.com.br/rooms/${id}` : null;
}

/**
 * Outros imóveis do MESMO anfitrião (conta do turno), na MESMA cidade, ativos e com anúncio sincronizado, que estão
 * LIVRES em todas as noites do período E cumprem o mínimo de noites do anúncio. Sem link oficial ou sem regra de
 * estadia conhecida, o imóvel não entra (nunca sugestão cega). Erro de leitura ⇒ `null`.
 */
async function fetchPortfolioAlternatives(
  db: GuestAiDb,
  turn: ValidatedTurn,
  period: RequestedPeriod,
  today: string,
): Promise<PortfolioAlternative[] | null> {
  try {
    const props = await db
      .from("properties")
      .select(cols(PORTFOLIO_PROPERTY_COLUMNS))
      .eq("owner_id", turn.tenantId)
      .is("archived_at", null)
      .limit(200);
    if (props.error || !Array.isArray(props.data)) return null;
    const all = props.data as Array<{ id: string; name: string | null; city: string | null; airbnb_listing_url: string | null }>;
    const own = all.find((p) => p.id === turn.propertyId);
    const city = (own?.city ?? "").trim().toLowerCase();
    const candidates = all.filter((p) => p.id !== turn.propertyId && city && (p.city ?? "").trim().toLowerCase() === city);
    if (candidates.length === 0) return [];
    const ids = candidates.map((p) => p.id);
    const [listings, reservations] = await Promise.all([
      db.from("property_listing_raw_data").select(cols(LISTING_STAY_RULE_COLUMNS)).in("property_id", ids).limit(400),
      db
        .from("property_reservations")
        .select(cols(RESERVATION_COLUMNS))
        .in("property_id", ids)
        .in("status", ["confirmed", "blocked"])
        .gt("checkout_date", period.checkin)
        .lt("checkin_date", period.checkout)
        .limit(1000),
    ]);
    if (listings.error || reservations.error) return null;
    const lrows = (listings.data ?? []) as ListingRuleRow[];
    const rrows = (reservations.data ?? []) as CalendarRow[];
    const out: PortfolioAlternative[] = [];
    for (const p of candidates) {
      const { rules, listingId } = rulesFrom(lrows, p.id);
      const url = listingUrl(p.airbnb_listing_url, listingId);
      const name = publicPropertyTitle(p.name);
      if (!rules || !url || !name) continue;
      const occ = buildOccupancy(rrows, { propertyId: p.id, today, windowStart: period.checkin, windowEnd: period.checkout });
      const a = assessPeriod(occ, period, rules);
      if (a.bookable !== "sim" || a.minNights === null) continue;
      out.push({ name, url, checkin: period.checkin, checkout: period.checkout, nights: period.nights, minNights: a.minNights });
      if (out.length >= PORTFOLIO_MAX_ALTERNATIVES) break;
    }
    return out;
  } catch {
    return null;
  }
}

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
  let texts: readonly string[] | undefined = opts.guestTexts;
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
  const occ = buildOccupancy((data ?? []) as CalendarRow[], {
    propertyId: turn.propertyId,
    today: opts.today,
    windowStart: win.start,
    windowEnd: win.end,
    excludeReservationId: turn.reservationId,
    stay,
    mentionedDates,
  });

  // 4) CONSULTA DE DATAS (sem estadia na conversa): o período da mensagem mais recente que cita datas, avaliado com
  //    o mínimo de noites do anúncio; se aqui não der para reservar, o portfólio do anfitrião (12/11/2026, caso Tais)
  if (stay) return occ;
  const latestWithDates = texts.find((t) => extractMentionedDates(t, opts.today).length > 0);
  const period = latestWithDates ? extractRequestedPeriod(latestWithDates, opts.today) : null;
  if (!period) return occ;
  let ownRules: StayRules | null = null;
  try {
    const lr = await db.from("property_listing_raw_data").select(cols(LISTING_STAY_RULE_COLUMNS)).eq("property_id", turn.propertyId).limit(5);
    if (!lr.error) ownRules = rulesFrom((lr.data ?? []) as ListingRuleRow[], turn.propertyId).rules;
  } catch {
    ownRules = null;
  }
  // o período pode sair da janela consultada: avalia com as reservas do próprio período
  let periodOcc: Pick<PropertyCalendarOccupancy, "occupiedRanges" | "today"> = occ;
  if (period.checkin < occ.windowStart || addDaysSafe(period.checkout, -1) > occ.windowEnd) {
    const pr = await db
      .from("property_reservations")
      .select(cols(RESERVATION_COLUMNS))
      .eq("property_id", turn.propertyId)
      .in("status", ["confirmed", "blocked"])
      .gt("checkout_date", period.checkin)
      .lt("checkin_date", period.checkout)
      .limit(300);
    if (pr.error) throw new Error("property_calendar_lookup_failed");
    periodOcc = buildOccupancy((pr.data ?? []) as CalendarRow[], {
      propertyId: turn.propertyId,
      today: opts.today,
      windowStart: period.checkin,
      windowEnd: period.checkout,
    });
  }
  const requested: PeriodAssessment = assessPeriod(periodOcc, period, ownRules);
  const alternatives = requested.bookable === "sim" ? null : await fetchPortfolioAlternatives(db, turn, period, opts.today);
  return { ...occ, requested, alternatives };
}

function addDaysSafe(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
