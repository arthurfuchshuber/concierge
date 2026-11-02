/**
 * Contratos do núcleo do ConciergeIA Guest (F0 + F1).
 *
 * Nada aqui acessa banco, rede, relógio ou LLM. Ver `AGENTS.md` desta pasta.
 */

/** Canal de entrada da mensagem do hóspede. Validado no backend contra a conversa e a mensagem. */
export type GuestSurface = "guide_chat" | "whatsapp" | "airbnb";
export const GUEST_SURFACES: readonly GuestSurface[] = ["guide_chat", "whatsapp", "airbnb"];

/** Audiências do Dossiê (ver `lib/playbook-catalog.ts`): P = Público, G = Reserva Ativa, I = Equipe Interna. */
export type GuestAudience = "P" | "G" | "I";

/**
 * Fase da hospedagem, SEMPRE derivada no servidor a partir de dados confiáveis.
 * Refinamento do tipo do documento: `no_show` existe no banco como estado real
 * (`guest_arrival_status.status = 'no_show'`), então ganhou fase própria.
 */
export type StayPhase =
  | "inquiry"
  | "pre_stay"
  | "in_stay"
  | "post_checkout"
  | "cancelled"
  | "no_show"
  | "unknown";

/**
 * Turno validado no backend (conversa, mensagem, associação, canal, imóvel e conta).
 * Só `data/scope.server.ts` emite; o registro de confiança (`trust.ts`) recusa forjados.
 */
export interface ValidatedTurn {
  readonly surface: GuestSurface;
  readonly conversationId: string;
  readonly messageId: string;
  readonly propertyId: string;
  /** Conta/proprietário dono do imóvel (`properties.owner_id`). */
  readonly tenantId: string;
  /** `property_chat_conversations.guest_session_id`: identificador opaco do interlocutor. */
  readonly guestSessionId: string;
  readonly conversationStatus: string | null;
  /** Vínculo declarado na conversa (`reservation_id`). Ainda NÃO provado: ver `fetchReservationState`. */
  readonly reservationId: string | null;
  readonly messageCreatedAt: string | null;
}

// ─────────────────────────── D9 — política de credenciais ───────────────────────────

export type AccessPolicyDecision = "allow" | "deny";

export type AccessPolicyReason =
  | "reservation_invalid"
  | "reservation_cancelled"
  | "no_show"
  | "checkout_confirmed"
  | "checkout_expired"
  | "within_release_window"
  | "manual_release"
  | "outside_release_window"
  | "missing_checkin_time"
  | "missing_timezone"
  | "invalid_operational_state";

export interface AccessPolicyResult {
  decision: AccessPolicyDecision;
  allowed: boolean;
  reason: AccessPolicyReason;
  /** Instante da avaliação (o `now` recebido por parâmetro, nunca o relógio do sistema). */
  evaluatedAt: string;
  /** Diagnóstico sem segredo: início da janela de liberação (ISO), quando calculável. */
  releaseAt?: string;
  /** Diagnóstico sem segredo: corte efetivo de checkout (ISO), quando calculável. */
  closeAt?: string;
}

/**
 * Entrada da política D9. Diferença deliberada em relação ao esboço do
 * documento: o modelo real guarda DATA (`checkin_date`) e HORÁRIO (`checkin_time`)
 * separados, no fuso do imóvel. A função deriva os instantes absolutos aqui
 * dentro (pura), em vez de aceitar instantes já prontos de quem chama.
 */
export interface CredentialPolicyInput {
  reservation: {
    exists: boolean;
    status: string | null;
    noShow: boolean;
    /** YYYY-MM-DD (data local do imóvel). */
    checkInDate: string | null;
    /** YYYY-MM-DD (data local do imóvel). */
    checkOutDate: string | null;
    /** Checkout confirmado no sistema (cartão de saída concluído). */
    checkoutConfirmed: boolean;
    /** Quando o checkout foi confirmado, se registrado. */
    confirmedCheckoutAt: string | null;
  };
  property: {
    /** Identificador IANA (ex.: America/Sao_Paulo). `null` = não comprovado → nega. */
    timezone: string | null;
    /** HH:MM oficial de check-in do imóvel. */
    checkInTime: string | null;
    /** HH:MM oficial de check-out do imóvel. */
    officialCheckOutTime: string | null;
  };
  /** Cartão operacional de check-in. `released` = liberado MANUALMENTE pela equipe (registro confiável). */
  checkinCard: { released: boolean; noShow: boolean } | null;
  /**
   * R6: autorização FORMAL de late checkout (guest_arrival_status.late_checkout_time/_approved_at/_by,
   * gravada só pelo gatilho do banco). Prazo efetivo = esta ?? checkout oficial. Nunca supera vetos.
   */
  authorizedLateCheckout?: { date: string; time: string } | null;
  /** Instante atual (ISO 8601 com Z ou offset). Nunca lido do relógio dentro da política. */
  now: string;
}

// ─────────────────────────── Policy Engine — resultados ───────────────────────────

export type PolicyOutcome<T = void> =
  | { kind: "allowed"; value: T }
  | { kind: "denied"; reason: string }
  | { kind: "needs_human_authorization"; reason: string }
  | { kind: "insufficient_context"; reason: string }
  | { kind: "inconsistent_context"; reason: string };

export type CaseRelation = "related" | "independent" | "ambiguous" | "new";

export interface OpenCase {
  id: string;
  /** De onde veio a informação do chamado. Hoje só o status da conversa (não há tabela de chamados). */
  source: "conversation_status";
  /** Assunto do chamado, quando conhecido. `null` = desconhecido. */
  topic: string | null;
  status: string;
}

// ─────────────────────────── Contexto do hóspede ───────────────────────────

export interface ListingFacts {
  name: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  shortDescription: string | null;
  /** Rua e número: só presente quando a audiência `G` foi concedida. */
  address: string | null;
  /**
   * Conhecimento integral de `property_listing_raw_data.normalized` (ver `data/listing-normalized.ts`):
   * todos os fatos (inclusive `identificacao`, com o prefixo interno isolado), reviews públicos e a
   * página pública processada. Fora: "Private feedback" dos reviews e `cohosts` (repasse interno).
   */
  normalized: {
    facts: Array<{ key: string; title: string; content: string }>;
    houseRules: unknown;
    checkoutTime: string | null;
    checkinWindow: { start: string | null; end: string | null } | null;
    cancellationPolicyLabel: string | null;
    cancellationPolicyDefault: unknown;
    instantBookingEnabled: boolean | null;
    instantBookingCategory: string | null;
    publicListing: Record<string, unknown> | null;
    publicCheckedAt: string | null;
    reviews: Array<{ score: number | null; receivedAt: string | null; text: string; hostReply: string | null }>;
  } | null;
  syncedAt: string | null;
}

export interface DossierItem {
  /** `f:<campo>` · `faq:<id>` · `custom:<id>` — mesmo id estável do Playbook. */
  id: string;
  label: string;
  value: string;
  audience: GuestAudience;
  /** Nota do anfitrião da linha; herda a audiência da linha. */
  note: string | null;
}

export interface DossierKnowledge {
  items: DossierItem[];
  manuals: Array<{ title: string; body: string }>;
  /** Quantas linhas existiam e foram retidas por política (sem revelar quais). */
  withheldByPolicy: number;
}

export interface GuestCredentials {
  lockCode?: string | null;
  gateCode?: string | null;
  pinCode?: string | null;
  wifiPassword?: string | null;
  accessInstructions?: string | null;
}

export interface GuestContext {
  version: 1;
  interlocutor: {
    /** Identificador opaco da sessão do hóspede na conversa (não existe tabela de hóspedes). */
    guestId: string;
    conversationId: string;
    messageId: string;
    surface: GuestSurface;
  };
  property: {
    id: string;
    tenantId: string;
    name: string | null;
    timezone: string | null;
    listingFacts: ListingFacts | null;
    dossierKnowledge: DossierKnowledge | null;
  };
  /** Fase calculada pelo servidor. `inquiry` quando não há reserva vinculada. */
  phase: StayPhase;
  stay: {
    reservationId: string;
    phase: StayPhase;
    status: string | null;
    checkInAt: string | null;
    checkOutAt: string | null;
    timezone: string | null;
  } | null;
  audiences: GuestAudience[];
  access: {
    credentialsAllowed: boolean;
    policyResult: AccessPolicyResult;
  };
  /** `null` quando não há autorização positiva e atualizada. Nunca contém chaves de senha quando nulo. */
  credentials: GuestCredentials | null;
  openCases: OpenCase[];
  uncertainties: string[];
  conflicts: string[];
}
