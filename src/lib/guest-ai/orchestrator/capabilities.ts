/**
 * F2-B · B1 — Contratos das CAPACIDADES futuras do Guest AI (F2-C).
 *
 * Só declarações: nenhuma capacidade tem implementação, nenhuma é executada e não há tool
 * calling nesta fase. O modelo pode apenas DECLARAR que uma delas teria ajudado
 * (`ModelDecision.capabilityNeeds`), para orientar o desenho da F2-C com evidência.
 */

export const CAPABILITY_IDS = [
  "portfolio_search",
  "property_availability",
  "local_places",
  "distance",
  "route_estimate",
  "dossier_section_lookup",
] as const;
export type CapabilityId = (typeof CAPABILITY_IDS)[number];

export interface CapabilitySpec {
  id: CapabilityId;
  description: string;
  /** Escopo de dados que a capacidade exigirá quando existir (verificado no backend, nunca no prompt). */
  requiredScope: "tenant_portfolio" | "property_calendar" | "external_places" | "geo" | "dossier";
  /** Distância/tempo precisam de fonte confiável; nunca inventados. */
  requiresTrustedSource: boolean;
  /** SEMPRE false na F2-B (o tipo literal impede habilitar sem mudar o contrato). */
  enabled: false;
}

export const CAPABILITIES: Readonly<Record<CapabilityId, CapabilitySpec>> = Object.freeze({
  portfolio_search: { id: "portfolio_search", description: "Buscar e comparar outros imóveis do portfólio da mesma conta.", requiredScope: "tenant_portfolio", requiresTrustedSource: false, enabled: false },
  property_availability: { id: "property_availability", description: "Consultar disponibilidade/calendário de imóveis da mesma conta (extensão, alternativas).", requiredScope: "property_calendar", requiresTrustedSource: true, enabled: false },
  local_places: { id: "local_places", description: "Recomendações locais (restaurantes, mercados, farmácias, atrações, serviços).", requiredScope: "external_places", requiresTrustedSource: true, enabled: false },
  distance: { id: "distance", description: "Distância em linha reta entre pontos conhecidos.", requiredScope: "geo", requiresTrustedSource: true, enabled: false },
  route_estimate: { id: "route_estimate", description: "Rota e tempo estimado de deslocamento (distinto de linha reta).", requiredScope: "geo", requiresTrustedSource: true, enabled: false },
  dossier_section_lookup: { id: "dossier_section_lookup", description: "Recuperação complementar de seção do Dossiê (quando o contexto exceder o orçamento).", requiredScope: "dossier", requiresTrustedSource: false, enabled: false },
} satisfies Record<CapabilityId, CapabilitySpec>);

export function isCapabilityId(v: unknown): v is CapabilityId {
  return typeof v === "string" && (CAPABILITY_IDS as readonly string[]).includes(v);
}

/** Nenhuma capacidade está habilitada na F2-B. */
export function enabledCapabilities(): CapabilityId[] {
  return CAPABILITY_IDS.filter((id) => (CAPABILITIES[id].enabled as boolean) === true);
}
