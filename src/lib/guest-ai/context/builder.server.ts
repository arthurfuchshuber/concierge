/**
 * GUEST CONTEXT BUILDER — recupera e ORGANIZA; não decide permissões (isso é do
 * Policy Engine) e não usa LLM.
 *
 * Ordem (seção 6.6 do documento):
 *  1. valida identidade/escopo do turno;
 *  2. recupera o estado operacional;
 *  3. avalia a D9;
 *  4. se NEGADO, nenhuma consulta de credenciais é executada;
 *  5. se PERMITIDO, REAVALIA os vetos com o estado atualizado, imediatamente antes da entrega;
 *  6. só então recupera as credenciais pelo módulo protegido (com o grant);
 *  7. monta o contexto autorizado.
 * Qualquer falha ao comprovar = sem credenciais.
 */
import type {
  AccessPolicyResult,
  CredentialPolicyInput,
  GuestAudience,
  GuestContext,
  GuestCredentials,
  InquiryDetails,
  OpenCase,
  StayPhase,
  ValidatedTurn,
} from "@/lib/guest-ai/types";
import { canReleaseCredentials } from "@/lib/guest-ai/policy/credential-policy";
import { decideAudiences } from "@/lib/guest-ai/policy/engine";
import { issueCredentialGrant, type CredentialGrant } from "@/lib/guest-ai/policy/grants";
import { deriveStayPhase } from "@/lib/guest-ai/policy/phase";
import { parseInstant, wallClockToInstant, isValidIanaTimezone } from "@/lib/guest-ai/policy/wall-clock";
import { validateTurnScope, GuestAiScopeError, type TurnInput } from "@/lib/guest-ai/data/scope.server";
import type { GuestAiDb } from "@/lib/guest-ai/data/client.server";
import { abortableDb, getGuestAiDb, throwIfAborted } from "@/lib/guest-ai/data/client.server";
import { fetchListingFacts, detectListingConflicts } from "@/lib/guest-ai/data/listing.server";
import { fetchDossierKnowledge } from "@/lib/guest-ai/data/dossier.server";
import { fetchReservationState, type ReservationLookup } from "@/lib/guest-ai/data/reservation.server";
import { fetchCancellationTerms } from "@/lib/guest-ai/data/cancellation-terms.server";
import { fetchPropertyOccupancy } from "@/lib/guest-ai/data/property-calendar.server";
import { localDate, type CalendarFact } from "@/lib/guest-ai/calendar-occupancy";
import { freeCancellationStatus } from "@/lib/guest-ai/playbooks/airbnb-cancellation";
import { emptyReservationState, type ReservationState } from "@/lib/guest-ai/data/reservation-facts";
import { fetchSensitiveCredentials, fetchAccessMethod, type AccessMethod } from "@/lib/guest-ai/data/credentials.server";
import { PROPERTY_SCOPE_COLUMNS, cols } from "@/lib/guest-ai/data/projections";
import { propertyTimeZoneOrNull } from "@/lib/property-timezone";
import { publicPropertyTitle } from "@/lib/guest-ai/data/public-title";
import type { IncidentView } from "@/lib/guest-ai-incidents/contracts";

type PropertyScopeRow = {
  name: string | null;
  city: string | null;
  country: string | null;
  checkin_time: string | null;
  checkout_time: string | null;
};

/** Dependências injetáveis (testes). Em produção tudo vem dos módulos reais. */
export interface BuilderDeps {
  db?: GuestAiDb;
  now?: () => Date;
  validateTurnScope?: typeof validateTurnScope;
  fetchReservationState?: typeof fetchReservationState;
  fetchCancellationTerms?: typeof fetchCancellationTerms;
  fetchPropertyOccupancy?: typeof fetchPropertyOccupancy;
  fetchListingFacts?: typeof fetchListingFacts;
  fetchDossierKnowledge?: typeof fetchDossierKnowledge;
  fetchSensitiveCredentials?: (grant: CredentialGrant) => Promise<GuestCredentials | null>;
  /** Existência (nunca valor) de credencial de acesso autônomo cadastrada; ausente em testes antigos ⇒ `unknown`. */
  /** Chamados de ocorrência abertos da conversa/reserva; ausente ou com erro ⇒ nenhum. */
  /** Dados da consulta do Airbnb (evento `inquiry`); ausente ⇒ leitura real. */
  fetchInquiryDetails?: (turn: ValidatedTurn, db: GuestAiDb) => Promise<InquiryDetails | null>;
  fetchOpenIncidents?: (turn: ValidatedTurn, db: GuestAiDb) => Promise<IncidentView[]>;
  fetchAccessMethod?: (turn: ValidatedTurn, deps: { db: GuestAiDb }) => Promise<AccessMethod>;
  loadPropertyScope?: (turn: ValidatedTurn, db: GuestAiDb) => Promise<PropertyScopeRow | null>;
  /**
   * F2-B: `"skip"` = avalia a D9 (decisão e motivo) mas NUNCA busca credenciais — nem revalida
   * para entrega, nem emite grant. Usado pelo Orchestrator (o modelo nunca recebe credenciais).
   * Padrão `"fetch"` preserva o comportamento F1.
   */
  credentials?: "fetch" | "skip";
  /**
   * F2-B: cancelamento do turno. Propagado a TODAS as consultas (via `abortableDb`) e conferido
   * entre as etapas: depois do cancelamento nenhuma consulta nova é aberta.
   */
  signal?: AbortSignal;
}

async function defaultLoadPropertyScope(turn: ValidatedTurn, db: GuestAiDb): Promise<PropertyScopeRow | null> {
  const { data, error } = await db.from("properties").select(cols(PROPERTY_SCOPE_COLUMNS)).eq("id", turn.propertyId).maybeSingle();
  if (error) throw new Error("property_lookup_failed");
  return (data as PropertyScopeRow | null) ?? null;
}

const DENY_INVALID = (now: string): AccessPolicyResult => ({
  decision: "deny",
  allowed: false,
  reason: "invalid_operational_state",
  evaluatedAt: now,
});

function policyInput(state: ReservationState, prop: PropertyScopeRow | null, nowIso: string): CredentialPolicyInput {
  const tz = prop ? propertyTimeZoneOrNull(prop.city, prop.country) : null;
  return {
    reservation: {
      exists: state.exists,
      status: state.status,
      noShow: state.noShow,
      checkInDate: state.checkInDate,
      checkOutDate: state.checkOutDate,
      checkoutConfirmed: state.checkoutConfirmed,
      confirmedCheckoutAt: state.confirmedCheckoutAt,
    },
    property: { timezone: tz, checkInTime: prop?.checkin_time ?? null, officialCheckOutTime: prop?.checkout_time ?? null },
    checkinCard: state.checkinCard,
    authorizedLateCheckout: state.authorizedLateCheckout,
    now: nowIso,
  };
}

function openCasesOf(turn: ValidatedTurn, incidents: readonly IncidentView[] = [], decisions: ReadonlyArray<{ id: string; topic: string }> = []): OpenCase[] {
  // Chamados de ocorrência (15/11/2026, `guest_ai_incidents`) trazem o ASSUNTO; o status da conversa continua sendo
  // evidência de acompanhamento humano sem assunto (`topic: null`). Nenhum dos dois bloqueia a IA globalmente.
  const out: OpenCase[] = incidents.map((x) => ({ id: x.id, source: "incident" as const, topic: x.summary, status: "open", severity: x.severity }));
  for (const d of decisions) out.push({ id: d.id, source: "decision", topic: d.topic, status: "pending" });
  const open = turn.conversationStatus === "needs_human" || turn.conversationStatus === "assigned";
  // se já há chamado com assunto, ele representa o acompanhamento (evita contar o mesmo atendimento duas vezes)
  if (open && out.length === 0) out.push({ id: turn.conversationId, source: "conversation_status", topic: null, status: turn.conversationStatus ?? "" });
  return out;
}

export async function buildGuestContext(input: TurnInput, deps: BuilderDeps = {}): Promise<GuestContext> {
  const signal = deps.signal;
  // Pontos de checagem do cancelamento: S0 início · S1 após o escopo · S2 após o imóvel · S3 após a
  // reserva (antes da D9 e do conhecimento) · S4 após anúncio/Dossiê (não devolve contexto cancelado).
  // Entre eles, `abortableDb` impede qualquer consulta nova e aborta as em andamento.
  throwIfAborted(signal); // S0
  const db = abortableDb(deps.db ?? (await getGuestAiDb()), signal);
  const clock = deps.now ?? (() => new Date());
  const scope = deps.validateTurnScope ?? validateTurnScope;
  const getReservation = deps.fetchReservationState ?? fetchReservationState;
  const getListing = deps.fetchListingFacts ?? fetchListingFacts;
  const getDossier = deps.fetchDossierKnowledge ?? fetchDossierKnowledge;
  // O grant é emitido com o relógio do builder (`clock`); a validade (TTL de 30 s) tem de ser conferida pelo
  // MESMO relógio, nunca por `Date.now()` solto. Em produção os dois são o relógio real; em teste, o relógio
  // injetado — sem isso a fixture com instante fixo "vence" quando a data real passa dela (achado T-1).
  const getCredentials =
    deps.fetchSensitiveCredentials ?? ((g: CredentialGrant) => fetchSensitiveCredentials(g, { db, nowMs: clock().getTime() }));
  const loadProp = deps.loadPropertyScope ?? defaultLoadPropertyScope;

  const uncertainties: string[] = [];
  const conflicts: string[] = [];

  // 1) identidade e escopo (lança GuestAiScopeError em qualquer divergência)
  const turn = await scope(input, { db });

  // 2) estado operacional + imóvel
  throwIfAborted(signal); // S1
  const prop = await loadProp(turn, db);
  throwIfAborted(signal); // S2
  let lookup: ReservationLookup;
  try {
    lookup = await getReservation(turn, { db });
  } catch {
    lookup = { kind: "state", state: emptyReservationState() };
    uncertainties.push("reservation_state_unavailable");
  }
  throwIfAborted(signal); // S3: cancelamento não vira "estado indisponível" — interrompe o turno
  let state: ReservationState = emptyReservationState();
  if (lookup.kind === "state") state = lookup.state;
  else if (lookup.kind === "conflict") conflicts.push(lookup.code);
  else uncertainties.push("no_reservation_link");

  const timezone = prop ? propertyTimeZoneOrNull(prop.city, prop.country) : null;
  if (!timezone) uncertainties.push("property_timezone_unproven");

  // 3) D9
  const t0 = clock();
  const nowIso = t0.toISOString();
  const first = canReleaseCredentials(policyInput(state, prop, nowIso));

  // Fase (a partir do MESMO estado e dos MESMOS instantes da política)
  const tzOk = isValidIanaTimezone(timezone);
  const checkInAt = tzOk ? wallClockToInstant(state.checkInDate, prop?.checkin_time, timezone, "later") : null;
  const closeAt = tzOk ? wallClockToInstant(state.checkOutDate, prop?.checkout_time, timezone, "earlier") : null;
  const phase: StayPhase = deriveStayPhase({
    exists: state.exists,
    status: state.status,
    noShow: state.noShow,
    checkoutConfirmed: state.checkoutConfirmed,
    checkInAt,
    closeAt,
    now: parseInstant(nowIso),
  });
  // Playbook de cancelamento (10/11/2026): prazo sem custo DA RESERVA, calculado aqui (nunca pelo modelo).
  // Falha de leitura ou modalidade não reconhecida ⇒ `unknown` (a IA não presume).
  let freeCancellation: { status: "open" | "closed" | "unknown"; until: string | null; policyLabel: string | null } = {
    status: "unknown",
    until: null,
    policyLabel: null,
  };
  let guests: { adults: number; children: number; infants: number } | null = null;
  if (state.exists) {
    try {
      const terms = await (deps.fetchCancellationTerms ?? fetchCancellationTerms)(turn, { db });
      if (terms) {
        guests = terms.guests ?? null;
        const fc = freeCancellationStatus({
          category: terms.category,
          isNonRefundable: terms.isNonRefundable,
          checkInAt,
          nights: terms.nights,
          bookedAt: terms.bookedAt ? parseInstant(terms.bookedAt) : null,
          now: parseInstant(nowIso)!,
        });
        freeCancellation = { status: fc.status, until: fc.until ? fc.until.toISOString() : null, policyLabel: fc.policyLabel };
      }
    } catch {
      /* desconhecido */
    }
    throwIfAborted(signal);
  }
  // Consulta do Airbnb (15/11/2026, caso Lauriete): sem reserva vinculada, o período/hóspedes/valor vêm do evento
  // `inquiry` da Channex. Melhor esforço; ausência ⇒ null (a IA nunca presume o período).
  let inquiry: InquiryDetails | null = null;
  if (!state.exists) {
    try {
      inquiry = deps.fetchInquiryDetails
        ? await deps.fetchInquiryDetails(turn, db)
        : await (await import("@/lib/guest-ai-inquiry/store.server")).loadInquiryDetails(db, turn.guestSessionId);
    } catch {
      inquiry = null;
    }
    throwIfAborted(signal);
  }
  // Calendário do imóvel (11/11/2026): só datas de outras reservas e bloqueios; falha ⇒ indisponível (nunca presume livre).
  let calendar: CalendarFact = { status: "unavailable" };
  const today = localDate(nowIso, timezone);
  if (today) {
    try {
      const occ = await (deps.fetchPropertyOccupancy ?? fetchPropertyOccupancy)(turn, { today, partySize: partySizeOf(inquiry, guests), inquiryPeriod: inquiry ? { checkin: inquiry.checkinDate, checkout: inquiry.checkoutDate, nights: Math.round((Date.parse(inquiry.checkoutDate) - Date.parse(inquiry.checkinDate)) / 86_400_000) } : null }, { db });
      calendar = { status: "available", ...occ };
    } catch {
      /* indisponível */
    }
    throwIfAborted(signal);
  }
  // Chamados de ocorrência abertos (15/11/2026): leitura de melhor esforço, nunca derruba o contexto.
  let incidents: IncidentView[] = [];
  try {
    incidents = deps.fetchOpenIncidents
      ? await deps.fetchOpenIncidents(turn, db)
      : await (await import("@/lib/guest-ai-incidents/store.server")).loadOpenIncidents(db, {
          id: turn.conversationId, propertyId: turn.propertyId, reservationId: turn.reservationId, guestName: turn.guestName,
        });
  } catch {
    incidents = [];
  }
  // Decisões humanas pendentes: assunto aberto, nunca silêncio da conversa (15/11/2026).
  let pendingDecisions: Array<{ id: string; topic: string }> = [];
  try {
    pendingDecisions = await (await import("@/lib/guest-ai-incidents/store.server")).loadPendingDecisionCases(db, turn.conversationId);
  } catch {
    pendingDecisions = [];
  }
  throwIfAborted(signal);
  const { audiences } = decideAudiences({ stayExists: state.exists, status: state.status, phase, noShow: state.noShow });
  const audienceSet = new Set<GuestAudience>(audiences);

  // 4–6) credenciais: só se permitido, e só após REAVALIAR com estado atualizado
  let policy: AccessPolicyResult = first;
  let credentials: GuestCredentials | null = null;
  if (deps.credentials !== "skip" && first.allowed && state.reservationId) {
    try {
      const second = await getReservation(turn, { db });
      const t1 = clock();
      const fresh = second.kind === "state" ? second.state : emptyReservationState();
      const again = canReleaseCredentials(policyInput(fresh, prop, t1.toISOString()));
      policy = again;
      if (again.allowed && fresh.reservationId === state.reservationId) {
        const grant = issueCredentialGrant(turn, fresh.reservationId, again, t1.getTime());
        credentials = await getCredentials(grant);
        if (!credentials) uncertainties.push("credentials_unavailable");
      }
    } catch {
      // Qualquer falha ao revalidar ou ao buscar = bloqueio. Mensagem fixa: nunca ecoa dados.
      policy = DENY_INVALID(nowIso);
      credentials = null;
      uncertainties.push("credentials_revalidation_failed");
    }
  }
  // Defesa final: política negada ⇒ nenhuma credencial, em hipótese alguma.
  if (!policy.allowed) credentials = null;

  // Conhecimento e fatos (audiência já decidida)
  const includeAddress = audienceSet.has("G");
  const [listing, dossier, accessMethod] = await Promise.all([
    getListing(turn, { includeAddress }, { db }),
    getDossier(turn, audienceSet, { db }),
    // como se entra no imóvel (só existência de credencial, nunca valor); falha ⇒ `unknown`, nunca presume
    (deps.fetchAccessMethod ?? fetchAccessMethod)(turn, { db }).catch((): AccessMethod => "unknown"),
  ]);
  throwIfAborted(signal); // S4
  if (listing.multipleListingRows) uncertainties.push("multiple_listing_rows");
  conflicts.push(
    ...detectListingConflicts(listing.facts.normalized, {
      checkInTime: prop?.checkin_time ?? null,
      checkOutTime: prop?.checkout_time ?? null,
    }),
  );

  return {
    version: 1,
    interlocutor: {
      guestId: turn.guestSessionId,
      conversationId: turn.conversationId,
      messageId: turn.messageId,
      surface: turn.surface,
      guestName: turn.guestName,
    },
    property: {
      id: turn.propertyId,
      tenantId: turn.tenantId,
      name: publicPropertyTitle(prop?.name) ?? listing.facts.name,
      timezone,
      listingFacts: listing.facts,
      dossierKnowledge: dossier,
    },
    phase,
    inquiry: state.exists ? null : inquiry,
    stay: state.exists
      ? {
          reservationId: String(state.reservationId),
          phase,
          status: state.status,
          checkInAt: checkInAt ? checkInAt.toISOString() : null,
          checkOutAt: closeAt ? closeAt.toISOString() : null,
          timezone,
          freeCancellation,
          guests,
        }
      : null,
    calendar,
    audiences,
    access: { credentialsAllowed: policy.allowed && credentials !== null, policyResult: policy, accessMethod },
    credentials,
    openCases: openCasesOf(turn, incidents, pendingDecisions),
    uncertainties,
    conflicts,
  };
}

export { GuestAiScopeError };

/** Tamanho do grupo que ocupa camas (adultos + crianças; bebês não contam na capacidade do anúncio). `null` = desconhecido. */
export function partySizeOf(
  inquiry: { guests: number | null; adults: number | null; children: number | null } | null | undefined,
  stayGuests: { adults: number; children: number } | null | undefined,
): number | null {
  if (inquiry) {
    if (typeof inquiry.adults === "number" && inquiry.adults > 0) return inquiry.adults + (inquiry.children ?? 0);
    if (typeof inquiry.guests === "number" && inquiry.guests > 0) return inquiry.guests;
  }
  if (stayGuests && stayGuests.adults > 0) return stayGuests.adults + stayGuests.children;
  return null;
}
