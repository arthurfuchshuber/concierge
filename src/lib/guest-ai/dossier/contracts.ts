/**
 * F2-B · B2.2 — CONTRATOS do Dossiê multipropriedade (puros).
 *
 * Um `PropertyDossier` representa UM imóvel identificado (propriedade + tenant), no papel de
 * imóvel PRINCIPAL (o da reserva/atendimento) ou de CANDIDATO alternativo do mesmo tenant. A mesma
 * estrutura serve aos dois papéis; nunca se misturam: cada entrada carrega o imóvel a que pertence
 * (pelo próprio dossiê), a fonte e a natureza (fato, regra, descrição comercial, avaliação…).
 *
 * O dossiê descreve CARACTERÍSTICAS. Ele NÃO é fonte de disponibilidade: `availability` começa
 * sempre como `not_consulted` e só pode ser ligada a um estado consultado do MESMO imóvel
 * (`bindAvailability`). Nesta etapa (B2.2) nenhuma fonte de calendário existe: só o contrato.
 */

import type { ResolvedFact } from "./authority";

export type PropertyRole = "primary" | "candidate";
export type DossierAudience = "P" | "G";
export type DossierPurpose = "reservation_context" | "guest_alternative_consultation";

export const DOSSIER_SOURCES = [
  "playbook",
  "listing_channex",
  "listing_public_page",
  "property_faqs",
  "property_manual_items",
  "property_recommendations",
  "city_references",
] as const;
export type DossierSource = (typeof DOSSIER_SOURCES)[number];

export const DOSSIER_ENTRY_KINDS = [
  "fact",
  "rule",
  "faq",
  "instruction",
  "amenity",
  "amenity_unavailable",
  "safety",
  "commercial_description",
  "guest_review",
  "host_reply",
] as const;
export type DossierEntryKind = (typeof DOSSIER_ENTRY_KINDS)[number];

export interface DossierEntry {
  /** Id estável dentro do imóvel (`f:<campo>`, `faq:<id>`, `listing:fact:<chave>`…). */
  id: string;
  label: string;
  value: string;
  kind: DossierEntryKind;
  source: DossierSource;
  audience: DossierAudience;
  note: string | null;
  /** `historical` = registro datado do passado (ex.: avaliação); não é estado atual. */
  temporal: "current" | "historical";
  observedAt: string | null;
  /** Outras fontes que trouxeram EXATAMENTE o mesmo conteúdo (duplicata unificada, procedência mantida). */
  alsoIn: DossierSource[];
}

/** Valor com procedência: confirmado (uma ou mais fontes concordam), em conflito ou desconhecido. */
export type Known<T> =
  | { status: "confirmed"; value: T; sources: string[] }
  | { status: "conflict"; values: Array<{ value: T; source: string }> }
  | { status: "unknown" };

export interface CapacityFacts {
  guests: Known<number>;
  bedrooms: Known<number>;
  beds: Known<number>;
  bathrooms: Known<number>;
}

/**
 * Recomendação do Explorar do Guia Digital (Pilar 1, 06/11/2026). FONTE DA VERDADE: Google Maps / Google Meu
 * Negócio — nome, categoria, nota e total de avaliações do Google, horários vigentes e link oficial do Maps.
 * `scope`: `nearby` ("Aqui pertinho" do imóvel) ou `city` (referências da cidade do guia). Não faz parte da
 * estrutura física do imóvel: o composer a apresenta FORA do Dossiê.
 */
export interface GuidePlace {
  id: string;
  scope: "nearby" | "city";
  name: string;
  category: string | null;
  type: string | null;
  rating: number | null;
  ratingsTotal: number | null;
  openingHours: string[] | null;
  note: string | null;
  /** Link oficial do Google Maps (só hosts do Google; qualquer outro vira null). */
  mapsUrl: string | null;
  /**
   * Distância de TRAJETO medida pelo servidor no Google Maps (`distance_kind = 'route'`). Sem rota confirmada
   * (linha reta, valor do aparelho, referência da cidade) ⇒ null: a IA não informa distância nem tempo.
   */
  route: { meters: number; walkMinutes: number | null; driveMinutes: number | null } | null;
}

export interface DossierManual {
  id: string;
  title: string;
  description: string | null;
  body: string | null;
  /** Referências visuais (URLs) como estão no cadastro. Nada é baixado ou interpretado. */
  imageRefs: string[];
}

export type AvailabilityState =
  | { status: "not_consulted" }
  | {
      status: "confirmed_available" | "confirmed_unavailable";
      /** Imóvel a que a consulta se refere — tem de ser o do dossiê. */
      propertyId: string;
      checkIn: string;
      checkOut: string;
      source: string;
      consultedAt: string;
    };

export interface DossierCompleteness {
  sourcesPresent: DossierSource[];
  sourcesMissing: DossierSource[];
  /** Linhas retidas por política (audiência não concedida, campo secreto/credencial), sem dizer quais. */
  withheldByPolicy: number;
}

export interface PropertyDossier {
  version: 1;
  propertyId: string;
  tenantId: string;
  role: PropertyRole;
  publicName: string | null;
  audiences: readonly DossierAudience[];
  retrievedAt: string;
  capacity: CapacityFacts;
  entries: DossierEntry[];
  manuals: DossierManual[];
  /** Recomendações do guia (Google Maps). Não são estrutura física: ficam fora do bloco do Dossiê no prompt. */
  places: GuidePlace[];
  mediaRefs: Array<{ id: string; url: string; source: DossierSource }>;
  /** Divergências objetivas entre fontes (sem escolher uma). */
  conflicts: string[];
  /** O que se sabe que NÃO se sabe (ex.: `capacity.beds`). */
  unknown: string[];
  completeness: DossierCompleteness;
  availability: AvailabilityState;
  /**
   * B2.4: fatos resolvidos por AUTORIDADE DE DOMÍNIO (`dossier/authority.ts`): horários padrão,
   * capacidade e regras da casa, com proveniência, divergências preservadas e estado
   * (`confirmed | unknown | conflict | stale | not_applicable`). Nunca promove fonte sem autoridade.
   */
  resolved: ResolvedFact[];
}

export class DossierError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "DossierError";
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Valida um estado de disponibilidade PARA UM imóvel. Disponibilidade de um imóvel nunca serve a
 * outro: `propertyId` diferente ⇒ erro. Não consulta nada; quem consulta é uma fonte futura.
 */
export function assertAvailabilityFor(dossier: Pick<PropertyDossier, "propertyId">, state: AvailabilityState): AvailabilityState {
  if (!state || typeof state !== "object") throw new DossierError("availability_invalid");
  if (state.status === "not_consulted") return { status: "not_consulted" };
  if (state.status !== "confirmed_available" && state.status !== "confirmed_unavailable") throw new DossierError("availability_invalid");
  if (state.propertyId !== dossier.propertyId) throw new DossierError("availability_property_mismatch");
  if (!ISO_DATE.test(state.checkIn) || !ISO_DATE.test(state.checkOut) || state.checkIn >= state.checkOut) throw new DossierError("availability_invalid");
  if (typeof state.source !== "string" || !state.source || typeof state.consultedAt !== "string" || !state.consultedAt) throw new DossierError("availability_invalid");
  return { ...state };
}

// ───────────────────────── avaliação de compatibilidade (contrato futuro) ─────────────────────────

/** Resultado de uma necessidade do hóspede contra o dossiê: nunca inferido além do que está confirmado. */
export type NeedAssessment =
  | { status: "confirmed"; evidence: string[] }
  | { status: "incompatible"; evidence: string[] }
  | { status: "unknown"; reason: "not_informed" | "conflicting_sources" };

/** Capacidade de hóspedes: só decide com valor CONFIRMADO; desconhecido/conflito continuam desconhecidos. */
export function assessGuestCapacity(capacity: CapacityFacts, guests: number): NeedAssessment {
  if (!Number.isInteger(guests) || guests < 1) throw new DossierError("need_invalid");
  const g = capacity.guests;
  if (g.status === "unknown") return { status: "unknown", reason: "not_informed" };
  if (g.status === "conflict") return { status: "unknown", reason: "conflicting_sources" };
  return guests <= g.value ? { status: "confirmed", evidence: [...g.sources] } : { status: "incompatible", evidence: [...g.sources] };
}

/** Avaliação de um candidato: características e disponibilidade são dimensões SEPARADAS. */
export interface CandidateEvaluation {
  propertyId: string;
  needs: Array<{ need: string; assessment: NeedAssessment }>;
  availability: AvailabilityState["status"];
}
