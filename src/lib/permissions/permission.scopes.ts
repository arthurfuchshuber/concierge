/**
 * Permission Scopes — validação de escopo operacional (FASE 3.5).
 *
 * Prepara o suporte real a GLOBAL, TENANT, CLIENT, PROPERTY e RECORD.
 * Nenhuma autorização é aplicada nesta fase: o objetivo é garantir que toda
 * gravação/consulta futura de permissão informe um escopo coerente.
 *
 * REGRA: um imóvel NUNCA vira nó da árvore de permissões. O imóvel é sempre
 * um ESCOPO (`scope_type = 'PROPERTY'`, `scope_id = <property_id>`) aplicado
 * sobre um nó existente.
 */
import type { PermissionScope, ScopeType } from "./permission.types";

/** Escopos que exigem um identificador concreto em `scope_id`. */
export const SCOPES_REQUIRING_ID: ScopeType[] = ["CLIENT", "PROPERTY", "RECORD"];

/** Amplitude relativa — quanto maior, mais específico. */
export const SCOPE_SPECIFICITY: Record<ScopeType, number> = {
  GLOBAL: 0,
  TENANT: 1,
  CLIENT: 2,
  PROPERTY: 3,
  RECORD: 4,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ScopeValidation = {
  ok: boolean;
  scope: PermissionScope;
  errors: string[];
};

/** Escopo padrão de uma atribuição da conta do cliente. */
export const DEFAULT_SCOPE: PermissionScope = { type: "TENANT", id: null };

/** Normaliza um escopo parcial em um escopo completo. */
export function normalizeScope(scope?: Partial<PermissionScope> | null): PermissionScope {
  return {
    type: (scope?.type as ScopeType) ?? DEFAULT_SCOPE.type,
    id: scope?.id ?? null,
  };
}

/**
 * Valida a combinação permissão + escopo.
 * `GLOBAL` é reservado à plataforma; escopos específicos exigem `scope_id`.
 */
export function validateScope(args: {
  nodeSlug: string;
  scope?: Partial<PermissionScope> | null;
  /** Contexto: `saas` permite GLOBAL; `account` não. */
  context?: "account" | "saas";
}): ScopeValidation {
  const scope = normalizeScope(args.scope);
  const errors: string[] = [];

  if (SCOPE_SPECIFICITY[scope.type] === undefined) {
    errors.push(`Escopo "${scope.type}" não é suportado.`);
  }

  if (scope.type === "GLOBAL" && (args.context ?? "account") !== "saas") {
    errors.push("O escopo GLOBAL é exclusivo da administração da plataforma.");
  }

  if (SCOPES_REQUIRING_ID.includes(scope.type)) {
    if (!scope.id) {
      errors.push(`O escopo ${scope.type} exige a identificação do alvo.`);
    } else if (scope.type !== "RECORD" && !UUID_RE.test(scope.id)) {
      errors.push(`Identificador de escopo inválido para ${scope.type}.`);
    }
  }

  if (!SCOPES_REQUIRING_ID.includes(scope.type) && scope.id) {
    errors.push(`O escopo ${scope.type} não aceita um identificador específico.`);
  }

  if (!args.nodeSlug) errors.push("Recurso não informado.");

  return { ok: errors.length === 0, scope, errors };
}

/** Um escopo cobre outro quando é igual ou mais amplo. */
export function scopeCovers(broader: PermissionScope, narrower: PermissionScope): boolean {
  if (broader.type === narrower.type) {
    return (broader.id ?? null) === (narrower.id ?? null);
  }
  return SCOPE_SPECIFICITY[broader.type] < SCOPE_SPECIFICITY[narrower.type];
}

/** Chave estável usada para deduplicar atribuições por escopo. */
export function scopeKey(scope: PermissionScope): string {
  return `${scope.type}:${scope.id ?? ""}`;
}

export const permissionScopes = {
  validateScope,
  normalizeScope,
  scopeCovers,
  scopeKey,
  DEFAULT_SCOPE,
};
