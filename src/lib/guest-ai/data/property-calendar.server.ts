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
  addDays as addDaysPure,
  approximateBookableWindow,
  APPROX_SHIFT_DAYS,
  assessPeriod,
  averageNightly,
  buildOccupancy,
  calendarWindow,
  extractMentionedDates,
  extractRequestedPeriod,
  isNightOccupied,
  nearestBookableWindows,
  NEAREST_WINDOW_MAX_SHIFT_DAYS,
  parseStayRules,
  type CalendarRow,
  type PeriodAssessment,
  type PortfolioAlternative,
  type PropertyCalendarOccupancy,
  type RequestedPeriod,
  type StayEdgeNight,
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

/** Quantas alternativas do portfólio vão ao modelo, no máximo, POR CAMADA (mesmo proprietário · outros). */
export const PORTFOLIO_MAX_ALTERNATIVES = 3;

/** Diárias reais por noite de um anúncio (calendário do Airbnb). `null` = não lidas (nada é estimado). */
export type NightlyPriceFetcher = (
  listing: { channelId: string; listingId: string },
  start: string,
  end: string,
) => Promise<ReadonlyMap<string, number> | null>;

const defaultPrices: NightlyPriceFetcher = async (l, start, end) =>
  (await import("@/lib/airbnb-host-api.server")).fetchAirbnbNightlyPrices(l.channelId, l.listingId, start, end);

type ListingRuleRow = {
  property_id: string | null;
  airbnb_listing_id: string | null;
  channex_channel_id?: string | null;
  sync_paused_at: string | null;
  not_found_at: string | null;
  availability_rule: unknown;
};

/** Regras do anúncio ATIVO do imóvel (primeiro sem pausa nem "não encontrado"). Falha ⇒ `null` (desconhecida). */
function rulesFrom(rows: readonly ListingRuleRow[], propertyId: string): { rules: StayRules | null; listingId: string | null; channelId: string | null } {
  const row = rows.find((r) => r.property_id === propertyId && !r.sync_paused_at && !r.not_found_at);
  return { rules: row ? parseStayRules(row.availability_rule) : null, listingId: row?.airbnb_listing_id ?? null, channelId: row?.channex_channel_id ?? null };
}

/** Link oficial do anúncio: o cadastrado no imóvel ou o montado pelo id do Airbnb (só dígitos). */
export function listingUrl(registered: string | null | undefined, listingId: string | null | undefined): string | null {
  const reg = (registered ?? "").trim();
  if (/^https:\/\/(?:www\.)?airbnb\.com(?:\.br)?\/rooms\/\d{6,24}$/.test(reg)) return reg;
  const id = (listingId ?? "").trim();
  return /^\d{6,24}$/.test(id) ? `https://www.airbnb.com.br/rooms/${id}` : null;
}

/**
 * PORTFÓLIO EM CAMADAS (16/11/2026, caso Tais; refeito em 26/11/2026, caso Izabela). Imóveis da MESMA conta, na MESMA
 * cidade, ativos, com anúncio sincronizado, link oficial e regra de estadia conhecida (nunca sugestão cega):
 *  1) camada "mesmo_proprietario": do mesmo proprietário do imóvel da conversa, primeiro;
 *  2) camada "outro_proprietario": dos demais proprietários da conta, ordenados pela diária REAL mais parecida.
 * Em cada imóvel vale o período exato; sem ele, o aproximado (entrada/saída até 2 dias, com noites em comum, ex.:
 * 27→01 vira 28→01). Grupo maior que a capacidade cadastrada não entra. Anúncios gêmeos são o mesmo imóvel (uma
 * opção, um link). Até `PORTFOLIO_MAX_ALTERNATIVES` por camada. Erro de leitura ⇒ `null`.
 */
async function fetchPortfolioAlternatives(
  db: GuestAiDb,
  turn: ValidatedTurn,
  period: RequestedPeriod,
  today: string,
  opts: {
    allowBelowMinNights?: boolean;
    partySize?: number | null;
    approximate?: boolean;
    prices?: NightlyPriceFetcher | null;
    /** Diária real do imóvel da conversa (referência de preço); lida em paralelo. */
    ownAvgNightly?: number | null | Promise<number | null>;
  } = {},
): Promise<PortfolioAlternative[] | null> {
  try {
    const props = await db
      .from("properties")
      .select(cols(PORTFOLIO_PROPERTY_COLUMNS))
      .eq("owner_id", turn.tenantId)
      .is("archived_at", null)
      .limit(200);
    if (props.error || !Array.isArray(props.data)) return null;
    const all = props.data as Array<{
      id: string;
      name: string | null;
      city: string | null;
      owner_contact_id?: string | null;
      airbnb_listing_url: string | null;
      airbnb_guest_count?: number | null;
      airbnb_bedroom_count?: number | null;
    }>;
    const own = all.find((p) => p.id === turn.propertyId);
    const city = (own?.city ?? "").trim().toLowerCase();
    const ownOwner = own?.owner_contact_id ?? null;
    // mesma cidade e, sabendo o tamanho do grupo, com capacidade para ele (16/11/2026: imóvel similar)
    const party = typeof opts.partySize === "number" && opts.partySize > 0 ? opts.partySize : null;
    const candidates = all.filter(
      (p) =>
        p.id !== turn.propertyId &&
        city &&
        (p.city ?? "").trim().toLowerCase() === city &&
        !(party !== null && typeof p.airbnb_guest_count === "number" && p.airbnb_guest_count > 0 && p.airbnb_guest_count < party),
    );
    if (candidates.length === 0) return [];
    const ids = candidates.map((p) => p.id);
    const approx = opts.approximate !== false && !opts.allowBelowMinNights;
    const from = approx ? addDaysPure(period.checkin, -APPROX_SHIFT_DAYS) : period.checkin;
    const to = approx ? addDaysPure(period.checkout, APPROX_SHIFT_DAYS) : period.checkout;
    const [listings, reservations] = await Promise.all([
      db.from("property_listing_raw_data").select(cols(LISTING_STAY_RULE_COLUMNS)).in("property_id", ids).limit(400),
      db
        .from("property_reservations")
        .select(cols(RESERVATION_COLUMNS))
        .in("property_id", ids)
        .in("status", ["confirmed", "blocked"])
        .gt("checkout_date", from)
        .lt("checkin_date", to)
        .limit(1000),
    ]);
    if (listings.error || reservations.error) return null;
    const lrows = (listings.data ?? []) as ListingRuleRow[];
    const rrows = (reservations.data ?? []) as CalendarRow[];
    type Found = PortfolioAlternative & { channelId: string | null; listingId: string | null; guests: number | null; rooms: number | null };
    const found: Found[] = [];
    for (const p of candidates) {
      const { rules, listingId, channelId } = rulesFrom(lrows, p.id);
      const url = listingUrl(p.airbnb_listing_url, listingId);
      const name = publicPropertyTitle(p.name);
      if (!rules || !url || !name) continue;
      const occ = buildOccupancy(rrows, { propertyId: p.id, today, windowStart: from, windowEnd: to });
      const a = assessPeriod(occ, period, rules);
      if (a.minNights === null) continue;
      const belowMinOnly = a.allNightsFree && a.meetsMinNights === false && a.withinBookingWindow !== false && period.checkin >= today;
      let win: RequestedPeriod | null = null;
      let exact = true;
      let minNights = a.minNights;
      let meetsMin = a.meetsMinNights !== false;
      if (a.bookable === "sim" || (opts.allowBelowMinNights && belowMinOnly)) win = period;
      else if (approx) {
        win = approximateBookableWindow(occ, period, rules);
        exact = false;
        if (win) {
          const w = assessPeriod(occ, win, rules);
          minNights = w.minNights ?? minNights;
          meetsMin = true;
        }
      }
      if (!win) continue;
      found.push({
        propertyId: p.id,
        name,
        url,
        checkin: win.checkin,
        checkout: win.checkout,
        nights: win.nights,
        minNights,
        meetsMinNights: meetsMin,
        maxGuests: typeof p.airbnb_guest_count === "number" ? p.airbnb_guest_count : null,
        bedrooms: typeof p.airbnb_bedroom_count === "number" ? p.airbnb_bedroom_count : null,
        tier: ownOwner && p.owner_contact_id === ownOwner ? "mesmo_proprietario" : "outro_proprietario",
        exact,
        avgNightly: null,
        channelId,
        listingId,
        guests: typeof p.airbnb_guest_count === "number" ? p.airbnb_guest_count : null,
        rooms: typeof p.airbnb_bedroom_count === "number" ? p.airbnb_bedroom_count : null,
      });
    }
    // diária REAL de cada opção no período dela (calendário do anúncio); sem leitura, fica sem preço (nada estimado)
    if (opts.prices && found.length) {
      const read = await Promise.all(
        found.map((f) =>
          f.channelId && f.listingId
            ? opts.prices!({ channelId: f.channelId, listingId: f.listingId }, f.checkin, addDaysPure(f.checkout, -1)).catch(() => null)
            : Promise.resolve(null),
        ),
      );
      found.forEach((f, i) => (f.avgNightly = averageNightly(read[i], f)));
    }
    const ownGuests = typeof own?.airbnb_guest_count === "number" ? own.airbnb_guest_count : null;
    const ownRooms = typeof own?.airbnb_bedroom_count === "number" ? own.airbnb_bedroom_count : null;
    const ownAvg = await Promise.resolve(opts.ownAvgNightly ?? null).catch(() => null);
    const ref = typeof ownAvg === "number" && ownAvg > 0 ? ownAvg : null;
    const priceGap = (f: Found) => (ref !== null && typeof f.avgNightly === "number" ? Math.abs(f.avgNightly - ref) / ref : Number.POSITIVE_INFINITY);
    const sizeGap = (f: Found) => (ownGuests !== null && f.guests !== null ? Math.abs(f.guests - ownGuests) : 0) + (ownRooms !== null && f.rooms !== null ? Math.abs(f.rooms - ownRooms) * 2 : 0);
    const shift = (f: Found) => Math.abs(Date.parse(f.checkin) - Date.parse(period.checkin)) / 86_400_000 + Math.abs(Date.parse(f.checkout) - Date.parse(period.checkout)) / 86_400_000;
    const sameOwner = found
      .filter((f) => f.tier === "mesmo_proprietario")
      .sort((x, y) => Number(!x.exact) - Number(!y.exact) || shift(x) - shift(y) || sizeGap(x) - sizeGap(y) || priceGap(x) - priceGap(y));
    const others = found
      .filter((f) => f.tier === "outro_proprietario")
      .sort((x, y) => priceGap(x) - priceGap(y) || Number(!x.exact) - Number(!y.exact) || shift(x) - shift(y) || sizeGap(x) - sizeGap(y));
    const strip = ({ channelId: _c, listingId: _l, guests: _g, rooms: _r, ...alt }: Found): PortfolioAlternative => alt;
    return [...sameOwner.slice(0, PORTFOLIO_MAX_ALTERNATIVES), ...others.slice(0, PORTFOLIO_MAX_ALTERNATIVES)].map(strip);
  } catch {
    return null;
  }
}

/** Quantas mensagens recentes do hóspede são lidas para achar datas citadas. */
export const CALENDAR_GUEST_TEXT_MESSAGES = 6;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function fetchPropertyOccupancy(
  turn: ValidatedTurn,
  opts: { today: string; guestTexts?: readonly string[]; inquiryPeriod?: RequestedPeriod | null; partySize?: number | null },
  deps?: { db?: GuestAiDb; prices?: NightlyPriceFetcher | null },
): Promise<PropertyCalendarOccupancy> {
  assertIssued("turn", turn, "data_requires_validated_turn");
  const db = deps?.db ?? (await getGuestAiDb());
  // diárias reais: no banco injetado (teste) só com leitor injetado; em produção, o calendário do Airbnb
  const prices: NightlyPriceFetcher | null = deps?.prices !== undefined ? deps.prices : deps?.db ? null : defaultPrices;

  // 1) estadia da conversa (só se for do MESMO imóvel)
  let stay: { checkin: string; checkout: string } | null = null;
  let stayCancelled = false;
  if (turn.reservationId) {
    const { data, error } = await db.from("property_reservations").select(cols(RESERVATION_COLUMNS)).eq("id", turn.reservationId).maybeSingle();
    if (error) throw new Error("property_calendar_lookup_failed");
    const r = (data ?? null) as CalendarRow | null;
    if (r && r.property_id === turn.propertyId && ISO_DATE.test(r.checkin_date ?? "") && ISO_DATE.test(r.checkout_date ?? "")) {
      stay = { checkin: r.checkin_date!, checkout: r.checkout_date! };
      stayCancelled = !!r.status && !["confirmed", "blocked"].includes(r.status);
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
  // NOVA CONSULTA DE QUEM JÁ TEVE RESERVA (26/11/2026, caso Izabela): hóspede que volta pela mesma conversa pedindo
  // datas novas depois de a estadia acabar (ou de a reserva ser cancelada). A estadia deixa de valer como "estadia":
  // vira consulta (período, datas próximas, portfólio). Com reserva ATIVA, datas diferentes podem ser pedido de
  // alteração (regra própria da plataforma): nada muda.
  const askedText = texts.find((t) => extractMentionedDates(t, opts.today).length > 0);
  const asked = askedText ? extractRequestedPeriod(askedText, opts.today) : null;
  const newInquiry = !!stay && !!asked && asked.checkin >= opts.today && (stay.checkout < opts.today || stayCancelled);
  if (newInquiry) stay = null;
  // Consulta do Airbnb (15/11/2026): o período já escolhido pelo hóspede entra como datas de interesse.
  const inquiryPeriod =
    !stay && opts.inquiryPeriod && ISO_DATE.test(opts.inquiryPeriod.checkin) && ISO_DATE.test(opts.inquiryPeriod.checkout) && opts.inquiryPeriod.checkout > opts.inquiryPeriod.checkin
      ? opts.inquiryPeriod
      : null;
  const mentionedDates = [
    ...new Set([...texts.flatMap((t) => extractMentionedDates(t, opts.today)), ...(inquiryPeriod ? [inquiryPeriod.checkin, inquiryPeriod.checkout] : [])]),
  ].sort();

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

  // 3b) COM ESTADIA (16/11/2026, caso Marcela: pediu para antecipar uma noite e a IA não olhou o portfólio): a noite
  //     anterior à entrada e a noite da saída. Se aqui estiver ocupada, os imóveis do anfitrião livres nessa noite
  //     entram como alternativa (inclusive abaixo do mínimo de noites, sinalizado: a liberação fica com a equipe).
  if (stay) {
    const edge = async (checkin: string): Promise<StayEdgeNight | null> => {
      if (checkin < opts.today) return null;
      const night: RequestedPeriod = { checkin, checkout: addDaysSafe(checkin, 1), nights: 1 };
      const freeHere = !isNightOccupied(occ, checkin);
      const alternatives = freeHere ? null : await fetchPortfolioAlternatives(db, turn, night, opts.today, { allowBelowMinNights: true, partySize: opts.partySize });
      return { checkin: night.checkin, checkout: night.checkout, freeHere, alternatives };
    };
    try {
      const [before, after] = await Promise.all([edge(addDaysSafe(stay.checkin, -1)), edge(stay.checkout)]);
      return { ...occ, stayEdges: { before, after } };
    } catch {
      return occ;
    }
  }

  // 4) CONSULTA DE DATAS (sem estadia na conversa): o período da mensagem mais recente que cita datas, avaliado com
  //    o mínimo de noites do anúncio; se aqui não der para reservar, o portfólio do anfitrião (12/11/2026, caso Tais)
  if (stay) return occ;
  const period = asked ?? inquiryPeriod;
  if (!period) return newInquiry ? { ...occ, newInquiry: true } : occ;
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
  // Datas iguais às da consulta do Airbnb: a plataforma já validou as regras de estadia (inclusive as condicionais).
  const platformAccepted = !!inquiryPeriod && period.checkin === inquiryPeriod.checkin && period.checkout === inquiryPeriod.checkout;
  const requested: PeriodAssessment = assessPeriod(periodOcc, period, ownRules, { platformAccepted });
  if (requested.bookable === "sim") return { ...occ, requested, alternatives: null, ...(newInquiry ? { newInquiry: true } : {}) };
  // NÃO CABE AQUI (16/11/2026, caso José): datas do mesmo tamanho mais próximas NESTE imóvel (oferecidas primeiro) e,
  // em paralelo, o portfólio no período pedido (para quando o hóspede não aceitar mudar as datas).
  const nearest = async (): Promise<RequestedPeriod[] | null> => {
    if (!ownRules) return null;
    const from = addDaysSafe(period.checkin, -NEAREST_WINDOW_MAX_SHIFT_DAYS);
    const to = addDaysSafe(period.checkout, NEAREST_WINDOW_MAX_SHIFT_DAYS);
    const nr = await db
      .from("property_reservations")
      .select(cols(RESERVATION_COLUMNS))
      .eq("property_id", turn.propertyId)
      .in("status", ["confirmed", "blocked"])
      .gt("checkout_date", from)
      .lt("checkin_date", to)
      .limit(300);
    if (nr.error) return null;
    const near = buildOccupancy((nr.data ?? []) as CalendarRow[], { propertyId: turn.propertyId, today: opts.today, windowStart: from, windowEnd: to });
    return nearestBookableWindows(near, period, ownRules);
  };
  // o mais parecido NESTE imóvel com noites em comum (ex.: pediu 27→01, aqui há 29→01) e a diária real daqui, que
  // é a referência de preço para comparar o portfólio
  const approximateHere = (() => {
    if (!ownRules) return null;
    try {
      return approximateBookableWindow(periodOcc, period, ownRules);
    } catch {
      return null;
    }
  })();
  // diária real daqui em paralelo com a busca do portfólio (o tempo da resposta não soma as duas leituras)
  const ownAvgPromise: Promise<number | null> = prices
    ? ownListingIds(db, turn.propertyId)
        .then((l) => (l ? prices(l, period.checkin, addDaysSafe(period.checkout, -1)) : null))
        .then((m) => averageNightly(m, period))
        .catch(() => null)
    : Promise.resolve(null);
  const [nearestWindows, alternatives, ownAvgNightly] = await Promise.all([
    nearest().catch(() => null),
    fetchPortfolioAlternatives(db, turn, period, opts.today, { partySize: opts.partySize, prices, ownAvgNightly: ownAvgPromise }),
    ownAvgPromise,
  ]);
  return {
    ...occ,
    requested,
    alternatives,
    nearestWindows,
    approximateHere,
    ownAvgNightly,
    ...(newInquiry ? { newInquiry: true } : {}),
  };
}

/** Anúncio ativo do imóvel da conversa (para ler as diárias reais). */
async function ownListingIds(db: GuestAiDb, propertyId: string): Promise<{ channelId: string; listingId: string } | null> {
  try {
    const lr = await db.from("property_listing_raw_data").select(cols(LISTING_STAY_RULE_COLUMNS)).eq("property_id", propertyId).limit(5);
    if (lr.error) return null;
    const row = ((lr.data ?? []) as ListingRuleRow[]).find((r) => r.property_id === propertyId && !r.sync_paused_at && !r.not_found_at);
    return row?.channex_channel_id && row.airbnb_listing_id ? { channelId: row.channex_channel_id, listingId: row.airbnb_listing_id } : null;
  } catch {
    return null;
  }
}

function addDaysSafe(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
