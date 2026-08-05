/**
 * Permission Engine — avaliação pura (sem I/O, sem banco, sem telas).
 *
 * FASE 1: implementado e testável, porém NÃO conectado a nenhuma rota,
 * página ou fluxo existente.
 */
import { featureAccess } from "./feature.access";
import { permissionRegistry } from "./permission.registry";
import {
  ACCESS_LEVEL_WEIGHT,
  BYPASS_SYSTEM_ROLES,
  type AccessLevel,
  type PermissionAssignment,
  type PermissionDecision,
  type PermissionRequest,
  type PermissionScope,
  type PermissionSubject,
  type ScopeType,
  type SystemRole,
} from "./permission.types";

/** Especificidade do escopo — o mais específico vence em caso de empate. */
const SCOPE_SPECIFICITY: Record<ScopeType, number> = {
  GLOBAL: 0,
  TENANT: 1,
  CLIENT: 2,
  PROPERTY: 3,
  RECORD: 4,
};

export function meetsLevel(effective: AccessLevel, required: AccessLevel): boolean {
  return ACCESS_LEVEL_WEIGHT[effective] >= ACCESS_LEVEL_WEIGHT[required];
}

export function highestLevel(a: AccessLevel, b: AccessLevel): AccessLevel {
  return ACCESS_LEVEL_WEIGHT[a] >= ACCESS_LEVEL_WEIGHT[b] ? a : b;
}

export function capLevel(level: AccessLevel, cap: AccessLevel): AccessLevel {
  return ACCESS_LEVEL_WEIGHT[level] <= ACCESS_LEVEL_WEIGHT[cap] ? level : cap;
}

export function hasSystemRole(subject: PermissionSubject, role: SystemRole): boolean {
  return (subject.systemRoles ?? []).includes(role);
}

/**
 * REGRA DO OWNER: acesso total ao que estiver disponível para o tenant e
 * permissões nunca editáveis. Documentada e centralizada aqui.
 */
export function isOwner(subject: PermissionSubject): boolean {
  return hasSystemRole(subject, "OWNER") || subject.userId === subject.tenantId;
}

/** Assignments do OWNER nunca podem ser gravados/alterados. */
export function assignmentsAreImmutable(subject: PermissionSubject): boolean {
  return isOwner(subject);
}

function scopeMatches(
  assignment: PermissionAssignment,
  scope: PermissionScope | undefined,
): boolean {
  if (assignment.scope_type === "GLOBAL") return true;
  if (assignment.scope_type === "TENANT") return !assignment.scope_id;
  if (!scope) return false;
  if (assignment.scope_type !== scope.type) return false;
  if (!assignment.scope_id) return true;
  return assignment.scope_id === (scope.id ?? null);
}

/** Entrada de avaliação: o subject, o pedido e os assignments já carregados. */
export type EvaluationInput = PermissionRequest & {
  assignments: PermissionAssignment[];
  /** Mapa slug → id do nó, necessário para casar assignments com o registry. */
  nodeIdBySlug?: Record<string, string>;
};

/**
 * Avalia um pedido de permissão de forma determinística.
 *
 * Ordem: OWNER → papéis de bypass → feature gating → assignment direto →
 * herança pelos ancestrais → negação padrão.
 */
export function evaluate(input: EvaluationInput): PermissionDecision {
  const { subject, nodeSlug, required, scope, assignments, nodeIdBySlug = {} } = input;

  if (isOwner(subject)) {
    return {
      allowed: true,
      effective: "WRITE",
      reason: "OWNER possui acesso total ao tenant e permissões não editáveis.",
      source: "owner",
    };
  }

  for (const role of BYPASS_SYSTEM_ROLES) {
    if (hasSystemRole(subject, role)) {
      return {
        allowed: true,
        effective: "WRITE",
        reason: `Papel de sistema "${role}" ignora checagem granular.`,
        source: "system_role",
      };
    }
  }

  if (!permissionRegistry.has(nodeSlug)) {
    return {
      allowed: false,
      effective: "NONE",
      reason: `Nó "${nodeSlug}" não está registrado no Permission Registry.`,
      source: "unknown_node",
    };
  }

  const feature = permissionRegistry.requiredFeature(nodeSlug);
  const featureDecision = featureAccess.check(feature, subject.plan ?? null);
  if (!featureDecision.allowed) {
    return {
      allowed: false,
      effective: "NONE",
      reason: featureDecision.reason,
      source: "feature",
    };
  }

  const chain = permissionRegistry.ancestors(nodeSlug);
  let effective: AccessLevel = "NONE";
  let source: PermissionDecision["source"] = "default";
  let bestSpecificity = -1;
  /** Atribuição direta com nível NONE = negação explícita (vence a herança). */
  let explicitDeny = false;

  chain.forEach((node, depth) => {
    const nodeId = nodeIdBySlug[node.slug];
    if (!nodeId) return;
    for (const assignment of assignments) {
      if (assignment.permission_node_id !== nodeId) continue;
      if (assignment.user_id !== subject.userId) continue;
      if (assignment.tenant_id !== subject.tenantId) continue;
      if (!scopeMatches(assignment, scope)) continue;
      if (depth === 0 && assignment.access_level === "NONE") {
        explicitDeny = true;
        continue;
      }
      const specificity = SCOPE_SPECIFICITY[assignment.scope_type] - depth * 0.1;
      if (specificity < bestSpecificity) continue;
      bestSpecificity = specificity;
      effective = highestLevel(effective, assignment.access_level);
      source = depth === 0 ? "assignment" : "inherited";
    }
  });

  if (explicitDeny) {
    effective = "NONE";
    source = "assignment";
  }

  effective = capLevel(effective, permissionRegistry.maxAccessLevel(nodeSlug));

  const allowed = meetsLevel(effective, required);

  return {
    allowed,
    effective,
    reason: allowed
      ? `Nível efetivo "${effective}" atende ao exigido "${required}".`
      : `Nível efetivo "${effective}" é insuficiente para "${required}".`,
    source: effective === "NONE" ? "default" : source,
  };
}

export const permissionEngine = {
  evaluate,
  meetsLevel,
  highestLevel,
  capLevel,
  isOwner,
  hasSystemRole,
  assignmentsAreImmutable,
};
