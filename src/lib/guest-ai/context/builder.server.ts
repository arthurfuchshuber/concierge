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
import { getGuestAiDb } from "@/lib/guest-ai/data/client.server";
import { fetchListingFacts, detectListingConflicts } from "@/lib/guest-ai/data/listing.server";
import { fetchDossierKnowledge } from "@/lib/guest-ai/data/dossier.server";
import { fetchReservationState, type ReservationLookup } from "@/lib/guest-ai/data/reservation.server";
import { emptyReservationState, type ReservationState } from "@/lib/guest-ai/data/reservation-facts";
import { fetchSensitiveCredentials } from "@/lib/guest-ai/data/credentials.server";
import { PROPERTY_SCOPE_COLUMNS, cols } from "@/lib/guest-ai/data/projections";
import { propertyTimeZoneOrNull } from "@/lib/property-timezone";
import { publicPropertyTitle } from "@/lib/guest-ai/data/public-title";

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
  fetchListingFacts?: typeof fetchListingFacts;
  fetchDossierKnowledge?: typeof fetchDossierKnowledge;
  fetchSensitiveCredentials?: (grant: CredentialGrant) => Promise<GuestCredentials | null>;
  loadPropertyScope?: (turn: ValidatedTurn, db: GuestAiDb) => Promise<PropertyScopeRow | null>;
  /**
   * F2-B: `"skip"` = avalia a D9 (decisão e motivo) mas NUNCA busca credenciais — nem revalida
   * para entrega, nem emite grant. Usado pelo Orchestrator (o modelo nunca recebe credenciais).
   * Padrão `"fetch"` preserva o comportamento F1.
   */
  credentials?: "fetch" | "skip";
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

function openCasesOf(turn: ValidatedTurn): OpenCase[] {
  // Não existe tabela de chamados (ai_guest_cases é só proposta). A única evidência hoje é o status da conversa.
  // `topic: null` = assunto desconhecido; o Policy Engine nunca trata isso como bloqueio global.
  const open = turn.conversationStatus === "needs_human" || turn.conversationStatus === "assigned";
  return open ? [{ id: turn.conversationId, source: "conversation_status", topic: null, status: turn.conversationStatus ?? "" }] : [];
}

export async function buildGuestContext(input: TurnInput, deps: BuilderDeps = {}): Promise<GuestContext> {
  const db = deps.db ?? (await getGuestAiDb());
  const clock = deps.now ?? (() => new Date());
  const scope = deps.validateTurnScope ?? validateTurnScope;
  const getReservation = deps.fetchReservationState ?? fetchReservationState;
  const getListing = deps.fetchListingFacts ?? fetchListingFacts;
  const getDossier = deps.fetchDossierKnowledge ?? fetchDossierKnowledge;
  const getCredentials = deps.fetchSensitiveCredentials ?? ((g: CredentialGrant) => fetchSensitiveCredentials(g, { db }));
  const loadProp = deps.loadPropertyScope ?? defaultLoadPropertyScope;

  const uncertainties: string[] = [];
  const conflicts: string[] = [];

  // 1) identidade e escopo (lança GuestAiScopeError em qualquer divergência)
  const turn = await scope(input, { db });

  // 2) estado operacional + imóvel
  const prop = await loadProp(turn, db);
  let lookup: ReservationLookup;
  try {
    lookup = await getReservation(turn, { db });
  } catch {
    lookup = { kind: "state", state: emptyReservationState() };
    uncertainties.push("reservation_state_unavailable");
  }
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
  const [listing, dossier] = await Promise.all([
    getListing(turn, { includeAddress }, { db }),
    getDossier(turn, audienceSet, { db }),
  ]);
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
    stay: state.exists
      ? {
          reservationId: String(state.reservationId),
          phase,
          status: state.status,
          checkInAt: checkInAt ? checkInAt.toISOString() : null,
          checkOutAt: closeAt ? closeAt.toISOString() : null,
          timezone,
        }
      : null,
    audiences,
    access: { credentialsAllowed: policy.allowed && credentials !== null, policyResult: policy },
    credentials,
    openCases: openCasesOf(turn),
    uncertainties,
    conflicts,
  };
}

export { GuestAiScopeError };
