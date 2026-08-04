/**
 * Permission Guard — middleware central de validação.
 *
 * FASE 1: interface pronta, NÃO conectada a nenhuma rota, server function
 * ou tela. As rotas continuam exatamente com as regras de hoje.
 */
import { featureAccess } from "./feature.access";
import { permissionEngine } from "./permission.engine";
import { permissionRegistry } from "./permission.registry";
import type {
  AccessLevel,
  PermissionDecision,
  PermissionScope,
  PermissionSubject,
  ScopeType,
  SystemRole,
} from "./permission.types";

export class PermissionDeniedError extends Error {
  readonly decision: PermissionDecision;
  constructor(decision: PermissionDecision) {
    super(decision.reason);
    this.name = "PermissionDeniedError";
    this.decision = decision;
  }
}

/** Valida se o subject possui o nível exigido em um nó. */
export async function validatePermission(args: {
  subject: PermissionSubject;
  nodeSlug: string;
  required: AccessLevel;
  scope?: PermissionScope;
  /** Quando true, lança PermissionDeniedError em vez de retornar a decisão. */
  throwOnDeny?: boolean;
}): Promise<PermissionDecision> {
  const { checkPermission } = await import("./permission.service.server");
  const decision = await checkPermission(args);
  if (!decision.allowed && args.throwOnDeny) throw new PermissionDeniedError(decision);
  return decision;
}

/** Valida se o escopo informado é coerente (tipo conhecido e id quando exigido). */
export function validateScope(scope: PermissionScope | undefined, allowed?: ScopeType[]): boolean {
  if (!scope) return true;
  const known: ScopeType[] = allowed ?? ["GLOBAL", "TENANT", "CLIENT", "PROPERTY", "RECORD"];
  if (!known.includes(scope.type)) return false;
  const needsId: ScopeType[] = ["CLIENT", "PROPERTY", "RECORD"];
  if (needsId.includes(scope.type) && !scope.id) return false;
  return true;
}

/** Valida disponibilidade de uma funcionalidade para o plano do tenant. */
export function validateFeature(feature: string | null, plan: string | null | undefined) {
  return featureAccess.check(feature, plan ?? null);
}

/** Valida se o subject possui um dos papéis internos exigidos. */
export function validateSystemRole(subject: PermissionSubject, roles: SystemRole[]): boolean {
  if (!roles.length) return true;
  return roles.some((role) => permissionEngine.hasSystemRole(subject, role));
}

/** Verificação combinada — usada pelas fases seguintes nas rotas. */
export async function guard(args: {
  subject: PermissionSubject;
  nodeSlug: string;
  required: AccessLevel;
  scope?: PermissionScope;
  systemRoles?: SystemRole[];
}): Promise<PermissionDecision> {
  if (args.systemRoles?.length && validateSystemRole(args.subject, args.systemRoles)) {
    return {
      allowed: true,
      effective: "WRITE",
      reason: "Papel interno autorizado.",
      source: "system_role",
    };
  }
  if (!validateScope(args.scope)) {
    const decision: PermissionDecision = {
      allowed: false,
      effective: "NONE",
      reason: "Escopo inválido para a checagem solicitada.",
      source: "default",
    };
    throw new PermissionDeniedError(decision);
  }
  const feature = permissionRegistry.requiredFeature(args.nodeSlug);
  const featureDecision = validateFeature(feature, args.subject.plan ?? null);
  if (!featureDecision.allowed) {
    throw new PermissionDeniedError({
      allowed: false,
      effective: "NONE",
      reason: featureDecision.reason,
      source: "feature",
    });
  }
  return validatePermission({ ...args, throwOnDeny: true });
}

export const permissionGuard = {
  validatePermission,
  validateScope,
  validateFeature,
  validateSystemRole,
  guard,
};
