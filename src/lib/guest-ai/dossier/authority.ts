/**
 * F2-B · B2.4 — AUTORIDADE POR DOMÍNIO e RESOLUÇÃO DE CONFLITOS entre fontes (pura).
 *
 * Não existe hierarquia universal: a autoridade depende do DOMÍNIO da informação. Cada domínio
 * declara camadas de autoridade (`tiers`, da mais forte para a mais fraca; fontes da mesma camada
 * têm autoridade EQUIVALENTE) e fontes apenas INFORMATIVAS (nunca decidem: avaliações, mensagens
 * da equipe sem registro formal, mensagens do hóspede, precedentes).
 *
 * Resolução (diretriz B2.4 §3.4): domínio → fontes → autoridade → vigência → substituição formal →
 * evidência. Sem evidência suficiente o conflito é PRESERVADO. Nada aqui escolhe a informação "mais
 * recente" ou "mais favorável": recência não é autoridade.
 *
 * Fontes REAIS (inventário de 03/11/2026; ver relatório B2.4 §B):
 *  - `official_property_record`: colunas operacionais de `properties` (`checkin_time`, `checkout_time`,
 *    `house_rules`…), mantidas pela equipe no sistema;
 *  - `official_reservation`: `reservations` + cartões `guest_arrival_status` (estado da estadia);
 *  - `formal_authorization`: autorizações gravadas por gatilho com autor e momento (R6; D9 para acesso);
 *  - `listing_sync_copy`: cópias do anúncio salvas em `properties.airbnb_*` (NÃO são cadastro operacional);
 *  - `listing_public`: anúncio normalizado (Channex) e página pública;
 *  - `dossier_playbook`: linhas aprovadas do Dossiê (`buildPlaybook`), derivadas das fontes acima;
 *  - informativas: `guest_review`, `precedent`, `staff_message`, `guest_message`.
 * Não há coluna operacional de capacidade máxima: capacidade só tem fontes do anúncio (autoridade
 * equivalente entre si) — "confirmada" ali significa "anúncio coerente", e isso fica registrado.
 */
import type { Known } from "./contracts";

export const AUTHORITY_VERSION = "authority.2026-11-03.1";

export const SOURCE_CLASSES = [
  "official_property_record",
  "official_reservation",
  "formal_authorization",
  "dossier_playbook",
  "listing_public",
  "listing_sync_copy",
  "guest_review",
  "precedent",
  "staff_message",
  "guest_message",
] as const;
export type SourceClass = (typeof SOURCE_CLASSES)[number];

/** Categorias da diretriz (A–F) para cada classe de fonte. */
export const SOURCE_CATEGORY: Readonly<Record<SourceClass, "A" | "B" | "C" | "D" | "E" | "F">> = Object.freeze({
  official_property_record: "A",
  official_reservation: "A",
  formal_authorization: "A",
  dossier_playbook: "C",
  listing_public: "D",
  listing_sync_copy: "D",
  guest_review: "E",
  precedent: "E",
  staff_message: "F",
  guest_message: "F",
});

export const FACT_DOMAINS = [
  "reservation_status",
  "max_guests",
  "checkin_time_standard",
  "checkout_time_standard",
  "early_checkin",
  "late_checkout",
  "credentials",
  "amenities",
  "house_rules",
  "reviews",
  "precedents",
] as const;
export type FactDomain = (typeof FACT_DOMAINS)[number];

export interface DomainAuthority {
  /** Camadas de autoridade (mais forte primeiro). Mesma camada = autoridade equivalente. */
  tiers: readonly (readonly SourceClass[])[];
  /** Fontes que informam mas NUNCA decidem o domínio. */
  informative: readonly SourceClass[];
}

/** Matriz de autoridade por domínio (exaustiva: o compilador exige todos os domínios). */
export const AUTHORITY_MATRIX: Readonly<Record<FactDomain, DomainAuthority>> = Object.freeze({
  reservation_status: { tiers: [["official_reservation"]], informative: ["staff_message", "guest_message", "precedent"] },
  max_guests: { tiers: [["official_property_record"], ["listing_sync_copy", "listing_public"]], informative: ["dossier_playbook", "guest_review", "staff_message", "guest_message"] },
  checkin_time_standard: { tiers: [["official_property_record"], ["listing_public", "listing_sync_copy"]], informative: ["dossier_playbook", "guest_review", "precedent", "staff_message", "guest_message"] },
  checkout_time_standard: { tiers: [["official_property_record"], ["listing_public", "listing_sync_copy"]], informative: ["dossier_playbook", "guest_review", "precedent", "staff_message", "guest_message"] },
  // Exceções de horário só existem com autorização FORMAL; nada mais decide (nem mensagem da equipe).
  early_checkin: { tiers: [["formal_authorization"]], informative: ["staff_message", "guest_message", "precedent", "official_reservation"] },
  late_checkout: { tiers: [["formal_authorization"]], informative: ["staff_message", "guest_message", "precedent", "official_reservation"] },
  credentials: { tiers: [["formal_authorization"]], informative: ["staff_message", "guest_message", "precedent"] },
  amenities: { tiers: [["official_property_record"], ["listing_public", "listing_sync_copy", "dossier_playbook"]], informative: ["guest_review", "staff_message", "guest_message"] },
  house_rules: { tiers: [["official_property_record"], ["dossier_playbook"], ["listing_public", "listing_sync_copy"]], informative: ["guest_review", "precedent", "staff_message", "guest_message"] },
  reviews: { tiers: [], informative: ["guest_review"] },
  precedents: { tiers: [], informative: ["precedent"] },
});

export const RESOLUTION_STATES = ["confirmed", "unknown", "conflict", "stale", "not_applicable"] as const;
export type ResolutionState = (typeof RESOLUTION_STATES)[number];

/** Uma afirmação de uma fonte sobre um domínio, com proveniência. */
export interface FactClaim {
  domain: FactDomain;
  propertyId: string;
  value: string | number;
  source: SourceClass;
  /** Referência do registro original (coluna, id de linha, id de mensagem). */
  sourceRef: string;
  observedAt: string | null;
  /** Fim da vigência, quando a fonte declara (ISO). */
  validUntil: string | null;
  /** `historical` = registro do passado (avaliação, mensagem antiga): nunca decide o estado atual. */
  temporal: "current" | "historical";
  /** Substituído FORMALMENTE por outro registro (sourceRef), quando a fonte declara. */
  supersededBy?: string | null;
}

export type ExclusionReason = "incomplete_provenance" | "other_property" | "historical" | "expired" | "superseded" | "non_authoritative";
export type UncertaintyReason = "no_source" | "only_non_authoritative_sources" | "equivalent_authority_disagree" | "all_authoritative_expired" | "domain_without_authority";

export interface ResolvedFact {
  domain: FactDomain;
  propertyId: string;
  status: ResolutionState;
  /** Presente só em `confirmed`. */
  value?: string | number;
  /** Fonte (classe + ref) que decide, em `confirmed`. */
  authority?: { source: SourceClass; sourceRefs: string[]; tier: number };
  /** Em `conflict`: valores da camada de autoridade que divergem. */
  conflicting?: Array<{ value: string | number; source: SourceClass; sourceRef: string }>;
  /** Fontes válidas que divergem do valor decidido (preservadas, sem promover). */
  divergent: Array<{ value: string | number; source: SourceClass; sourceRef: string }>;
  excluded: Array<{ sourceRef: string; reason: ExclusionReason }>;
  uncertainty: UncertaintyReason | null;
}

const norm = (v: string | number) => (typeof v === "number" ? String(v) : v.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase());
const isClass = (s: unknown): s is SourceClass => typeof s === "string" && (SOURCE_CLASSES as readonly string[]).includes(s);
const validValue = (v: unknown) => (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && v.trim().length > 0);

/**
 * Resolve um domínio a partir das afirmações disponíveis. Pura e determinística.
 * `applicable: false` ⇒ `not_applicable` (ex.: saída tardia numa conversa sem reserva).
 */
export function resolveDomain(domain: FactDomain, propertyId: string, claims: readonly FactClaim[], now: string, applicable = true): ResolvedFact {
  const base: ResolvedFact = { domain, propertyId, status: "unknown", divergent: [], excluded: [], uncertainty: null };
  if (!applicable) return { ...base, status: "not_applicable" };
  const matrix = AUTHORITY_MATRIX[domain];
  const nowMs = Date.parse(now);
  const tierOf = (s: SourceClass) => matrix.tiers.findIndex((t) => t.includes(s));

  // 1) Proveniência, propriedade, temporalidade e vigência.
  const current: FactClaim[] = [];
  const expiredAuthoritative: FactClaim[] = [];
  const informative: FactClaim[] = [];
  const all = (claims ?? []).filter((c) => c && c.domain === domain);
  const refs = new Set(all.map((c) => c.sourceRef));
  for (const c of all) {
    if (!isClass(c.source) || typeof c.sourceRef !== "string" || !c.sourceRef || !validValue(c.value) || (c.temporal !== "current" && c.temporal !== "historical")) {
      base.excluded.push({ sourceRef: typeof c.sourceRef === "string" ? c.sourceRef : "", reason: "incomplete_provenance" });
      continue;
    }
    if (c.propertyId !== propertyId) { base.excluded.push({ sourceRef: c.sourceRef, reason: "other_property" }); continue; }
    if (c.temporal === "historical") { base.excluded.push({ sourceRef: c.sourceRef, reason: "historical" }); continue; }
    // Substituição só vale se o registro substituto estiver presente (formalmente identificado).
    if (c.supersededBy && refs.has(c.supersededBy)) { base.excluded.push({ sourceRef: c.sourceRef, reason: "superseded" }); continue; }
    const tier = tierOf(c.source);
    if (tier < 0) { informative.push(c); base.excluded.push({ sourceRef: c.sourceRef, reason: "non_authoritative" }); continue; }
    if (c.validUntil !== null) {
      const until = Date.parse(c.validUntil);
      if (!Number.isFinite(until) || !Number.isFinite(nowMs) || until < nowMs) {
        expiredAuthoritative.push(c);
        base.excluded.push({ sourceRef: c.sourceRef, reason: "expired" });
        continue;
      }
    }
    current.push(c);
  }

  // 2) A camada de autoridade mais forte com afirmações válidas decide; divergência na mesma camada = conflito.
  for (let t = 0; t < matrix.tiers.length; t++) {
    const inTier = current.filter((c) => tierOf(c.source) === t);
    if (inTier.length === 0) continue;
    const values = new Set(inTier.map((c) => norm(c.value)));
    if (values.size > 1) {
      return { ...base, status: "conflict", conflicting: inTier.map((c) => ({ value: c.value, source: c.source, sourceRef: c.sourceRef })), uncertainty: "equivalent_authority_disagree" };
    }
    const decided = norm(inTier[0]!.value);
    const divergent = [...current, ...informative].filter((c) => norm(c.value) !== decided).map((c) => ({ value: c.value, source: c.source, sourceRef: c.sourceRef }));
    return { ...base, status: "confirmed", value: inTier[0]!.value, authority: { source: inTier[0]!.source, sourceRefs: inTier.map((c) => c.sourceRef), tier: t }, divergent };
  }

  // 3) Nenhuma fonte com autoridade vigente.
  if (matrix.tiers.length === 0) return { ...base, uncertainty: "domain_without_authority", divergent: informative.map((c) => ({ value: c.value, source: c.source, sourceRef: c.sourceRef })) };
  if (expiredAuthoritative.length > 0) return { ...base, status: "stale", uncertainty: "all_authoritative_expired" };
  if (informative.length > 0) return { ...base, uncertainty: "only_non_authoritative_sources", divergent: informative.map((c) => ({ value: c.value, source: c.source, sourceRef: c.sourceRef })) };
  return { ...base, uncertainty: "no_source" };
}

/** Compatibilidade com `Known<T>` (B2.2): só `confirmed` vira valor; o resto é conflito/desconhecido. */
export function toKnown(r: ResolvedFact): Known<string | number> {
  if (r.status === "confirmed" && r.value !== undefined && r.authority) return { status: "confirmed", value: r.value, sources: [...r.authority.sourceRefs] };
  if (r.status === "conflict" && r.conflicting) return { status: "conflict", values: r.conflicting.map((c) => ({ value: c.value, source: c.sourceRef })) };
  return { status: "unknown" };
}
