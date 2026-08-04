/**
 * Authorization Runtime Engine (FASE 3.6) — ponto ÚNICO de validação.
 *
 * Modelo:
 *   Subject → Roles / Direct Grants → Permissions → Scope Resolution
 *           → Resource Validation → Decision
 *
 * Toda decisão é padronizada (nunca apenas true/false) e toda negação é
 * registrada em um log interno para diagnóstico.
 *
 * NADA aqui está conectado a rotas, telas, menus ou papéis atuais.
 */
import { permissionEngine } from "./permission.engine";
import { permissionRegistry } from "./permission.registry";
import {
  effectivePermissionsFromSnapshot,
  normalizePermission,
  resolveSubjectSnapshot,
  type ResolveContext,
  type SubjectSnapshot,
} from "./permission.resolve.server";
import { normalizeScope, validateScope } from "./permission.scopes";
import type { AccessLevel, PermissionScope, ScopeType } from "./permission.types";

/* ------------------------------------------------------------------ tipos */

export type AuthorizationContext = ResolveContext & {
  /** Nível exigido (default: READ). */
  required?: AccessLevel;
  /** Escopo explícito da checagem. */
  scope?: Partial<PermissionScope> | null;
  /** Atalhos de escopo — convertidos em `scope` quando informados. */
  propertyId?: string | null;
  clientId?: string | null;
  recordId?: string | null;
  /** Snapshot já carregado (evita novas consultas em validações em lote). */
  snapshot?: SubjectSnapshot;
};

export type AuthorizationDecision = {
  allowed: boolean;
  reason: string;
  permission: string;
  scope: PermissionScope;
  /** Extras de diagnóstico — não substituem os campos padronizados acima. */
  effective: AccessLevel;
  required: AccessLevel;
  source: string;
  subject: { userId: string; tenantId: string; status: string };
};

/* -------------------------------------------------------- log de negativas */

const DENIED_LOG_LIMIT = 200;
const deniedLog: Array<AuthorizationDecision & { at: string }> = [];

function logDenied(decision: AuthorizationDecision): void {
  const entry = { ...decision, at: new Date().toISOString() };
  deniedLog.push(entry);
  if (deniedLog.length > DENIED_LOG_LIMIT) deniedLog.shift();
  console.warn(
    `[authz] negado — usuário=${decision.subject.userId} tenant=${decision.subject.tenantId} ` +
      `permissão=${decision.permission} escopo=${decision.scope.type}:${decision.scope.id ?? "-"} ` +
      `exigido=${decision.required} efetivo=${decision.effective} motivo=${decision.reason}`,
  );
}

/** Últimas decisões negadas (diagnóstico em memória do processo). */
export function readDeniedDecisions(limit = 50) {
  return deniedLog.slice(-limit).reverse();
}

export function clearDeniedDecisions(): void {
  deniedLog.length = 0;
}

/* ------------------------------------------------------------------ helpers */

function contextScope(context: AuthorizationContext): PermissionScope {
  if (context.scope) return normalizeScope(context.scope);
  if (context.recordId) return { type: "RECORD", id: context.recordId };
  if (context.propertyId) return { type: "PROPERTY", id: context.propertyId };
  if (context.clientId) return { type: "CLIENT", id: context.clientId };
  return normalizeScope(null);
}

function decide(
  base: Omit<AuthorizationDecision, "allowed" | "reason">,
  allowed: boolean,
  reason: string,
): AuthorizationDecision {
  const decision: AuthorizationDecision = { ...base, allowed, reason };
  if (!allowed) logDenied(decision);
  return decision;
}

/* ------------------------------------------------------- avaliação (pura) */

/**
 * Núcleo determinístico: decide a partir de um snapshot já resolvido.
 * Exposto para os testes internos e para validações em lote.
 */
export function evaluateWithSnapshot(
  snapshot: SubjectSnapshot,
  permission: string,
  context: AuthorizationContext = {},
): AuthorizationDecision {
  const slug = normalizePermission(permission);
  const required: AccessLevel = context.required ?? "READ";
  const scope = contextScope(context);

  const base: Omit<AuthorizationDecision, "allowed" | "reason"> = {
    permission: slug,
    scope,
    effective: "NONE",
    required,
    source: "default",
    subject: {
      userId: snapshot.subject.userId,
      tenantId: snapshot.subject.tenantId,
      status: snapshot.status,
    },
  };

  // 1) Sujeito precisa estar ativo no tenant.
  if (snapshot.status === "revoked" || snapshot.status === "pending") {
    return decide(
      { ...base, source: "subject_status" },
      false,
      snapshot.status === "pending"
        ? "Convite ainda não aceito: o acesso permanece pendente."
        : "Acesso revogado para este usuário na conta.",
    );
  }

  // 2) Escopo precisa ser coerente com o modelo operacional.
  const scopeCheck = validateScope({
    nodeSlug: slug,
    scope,
    context: snapshot.subject.systemRoles?.includes("ADMIN_SAAS") ? "saas" : "account",
  });
  if (!scopeCheck.ok) {
    return decide({ ...base, source: "scope" }, false, scopeCheck.errors.join(" "));
  }

  // 3) Resource validation — escopo PROPERTY exige vínculo ativo.
  const isOwner = permissionEngine.isOwner(snapshot.subject);
  const bypass =
    isOwner ||
    (snapshot.subject.systemRoles ?? []).some((r) =>
      ["SYSTEM", "ADMIN_SAAS", "CRON"].includes(r),
    );

  if (scope.type === "PROPERTY" && !bypass && !snapshot.properties.includes(scope.id ?? "")) {
    return decide(
      { ...base, source: "property_assignment" },
      false,
      "O usuário não possui vínculo ativo com a residência informada.",
    );
  }

  // 4) Nó precisa existir e ser permissionável.
  const node = permissionRegistry.get(slug);
  if (!node) {
    return decide(
      { ...base, source: "unknown_node" },
      false,
      `Recurso "${slug}" não está registrado no Permission Registry.`,
    );
  }
  if (node.isPermissionable === false && !bypass) {
    return decide(
      { ...base, source: "unknown_node" },
      false,
      `Recurso "${slug}" é público/estrutural e não participa da árvore de permissões.`,
    );
  }

  // 5) Permissões: grants diretos + herança + feature gating + níveis.
  const engineDecision = permissionEngine.evaluate({
    subject: snapshot.subject,
    nodeSlug: slug,
    required,
    scope,
    assignments: snapshot.assignments,
    nodeIdBySlug: snapshot.nodeIdBySlug,
  });

  return decide(
    { ...base, effective: engineDecision.effective, source: engineDecision.source },
    engineDecision.allowed,
    engineDecision.reason,
  );
}

/* --------------------------------------------------------------- API pública */

/** `can` — o sujeito pode exercer a permissão neste contexto? */
export async function can(
  subjectId: string,
  permission: string,
  context: AuthorizationContext = {},
): Promise<AuthorizationDecision> {
  const snapshot = context.snapshot ?? (await resolveSubjectSnapshot(subjectId, context));
  return evaluateWithSnapshot(snapshot, permission, { ...context, snapshot });
}

/**
 * `canAccess` — variante orientada a recurso + ação.
 * A ação é traduzida para o nível exigido (read/view → READ; demais → WRITE).
 */
export async function canAccess(
  subjectId: string,
  resource: string,
  action: string,
  context: AuthorizationContext = {},
): Promise<AuthorizationDecision> {
  const readActions = ["read", "view", "list", "get", "ver", "listar"];
  const required: AccessLevel = readActions.includes(action.toLowerCase()) ? "READ" : "WRITE";
  return can(subjectId, resource, { ...context, required });
}

export class AuthorizationError extends Error {
  readonly decision: AuthorizationDecision;
  constructor(decision: AuthorizationDecision) {
    super(decision.reason);
    this.name = "AuthorizationError";
    this.decision = decision;
  }
}

/** `requirePermission` — lança `AuthorizationError` quando negado. */
export async function requirePermission(
  subjectId: string,
  permission: string,
  context: AuthorizationContext = {},
): Promise<AuthorizationDecision> {
  const decision = await can(subjectId, permission, context);
  if (!decision.allowed) throw new AuthorizationError(decision);
  return decision;
}

/** Permissões efetivas do sujeito (usado por diagnóstico e futuras telas). */
export async function listEffectivePermissions(
  subjectId: string,
  context: AuthorizationContext = {},
): Promise<Record<string, AccessLevel>> {
  const snapshot = context.snapshot ?? (await resolveSubjectSnapshot(subjectId, context));
  return effectivePermissionsFromSnapshot(snapshot, contextScope(context));
}

export type { ScopeType };

export const authorizationGuard = {
  can,
  canAccess,
  requirePermission,
  listEffectivePermissions,
  evaluateWithSnapshot,
  readDeniedDecisions,
  clearDeniedDecisions,
};
