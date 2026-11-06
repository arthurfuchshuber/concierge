/**
 * F2-B · B2.2 — Registro de confiança do Dossiê (mesmo padrão de `trust.ts`).
 *
 * - `DossierTarget`: autorização para carregar o dossiê de UM imóvel. Só é emitido por
 *   `data/property-access.server.ts` (principal = imóvel do turno validado; candidato = mesmo tenant,
 *   validado individualmente no banco). Objeto forjado ou copiado é recusado.
 * - `PropertyDossier`: só os dossiês montados pelo loader (`data/property-dossier.server.ts`) a partir
 *   de um alvo emitido são aceitos pelo compositor. Emitidos congelados (profundo).
 */
import { DossierError, assertAvailabilityFor, type AvailabilityState, type DossierAudience, type DossierPurpose, type PropertyDossier, type PropertyRole } from "./contracts";

export interface DossierTarget {
  readonly propertyId: string;
  readonly tenantId: string;
  readonly role: PropertyRole;
  readonly audiences: readonly DossierAudience[];
  readonly purpose: DossierPurpose;
}

const targets = new WeakSet<object>();
const dossiers = new WeakSet<object>();

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

export function issueDossierTarget(t: DossierTarget): Readonly<DossierTarget> {
  const frozen = deepFreeze({ ...t, audiences: [...t.audiences] });
  targets.add(frozen);
  return frozen;
}

export function isIssuedDossierTarget(value: unknown): value is DossierTarget {
  return typeof value === "object" && value !== null && targets.has(value);
}

export function issuePropertyDossier(d: PropertyDossier): Readonly<PropertyDossier> {
  const frozen = deepFreeze(structuredClone(d));
  dossiers.add(frozen);
  return frozen;
}

export function isIssuedPropertyDossier(value: unknown): value is PropertyDossier {
  return typeof value === "object" && value !== null && dossiers.has(value);
}

/**
 * Liga um estado de disponibilidade a um dossiê emitido — só do MESMO imóvel (nunca reaproveita
 * a disponibilidade de outro). Devolve um NOVO dossiê emitido; o original não muda.
 */
export function withAvailability(dossier: PropertyDossier, state: AvailabilityState): Readonly<PropertyDossier> {
  if (!isIssuedPropertyDossier(dossier)) throw new DossierError("dossier_not_issued");
  const availability = assertAvailabilityFor(dossier, state);
  return issuePropertyDossier({ ...structuredClone(dossier), availability });
}
