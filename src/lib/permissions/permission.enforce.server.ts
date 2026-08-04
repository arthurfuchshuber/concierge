/**
 * Permission Enforcement Layer (FASE 3.7).
 *
 * Camada ÚNICA de aplicação das decisões produzidas pelo
 * `permission.guard.server.ts`. Nenhuma validação paralela é criada aqui:
 * toda decisão continua vindo de `can()` / `evaluateWithSnapshot()`.
 *
 * Modos de aplicação
 * ------------------
 * O ConciergeIA ainda opera com o modelo legado (owner + account_members +
 * member_permissions). Para preservar 100% dos fluxos atuais, o enforcement
 * roda em modo "progressivo":
 *
 *   - OWNER / ADMIN_SAAS / SYSTEM / CRON  → sempre autorizados (regra imutável).
 *   - Sujeito revogado ou pendente        → SEMPRE bloqueado.
 *   - Tenant que já possui atribuições na nova árvore → decisão do guard vale.
 *   - Tenant SEM nenhuma atribuição (ainda não migrado) → a decisão negativa é
 *     registrada no diagnóstico (shadow) e a operação segue, exatamente como
 *     hoje. Assim nenhuma conta perde acesso antes da migração da Fase 4.
 *
 * A troca para o modo estrito é apenas uma constante (`ENFORCEMENT_MODE`).
 */
import { can, type AuthorizationContext, type AuthorizationDecision } from "./permission.guard.server";
import { resolveSubjectSnapshot, type SubjectSnapshot } from "./permission.resolve.server";
import { protectedOperation, type ProtectedOperationKey } from "./permission.operations";
import type { AccessLevel, PermissionScope } from "./permission.types";

/* --------------------------------------------------------------- contratos */

export type EnforcementMode = "strict" | "progressive";

/** Modo atual. `progressive` preserva os fluxos legados (ver cabeçalho). */
export const ENFORCEMENT_MODE: EnforcementMode = "progressive";

/** Erro padronizado de negação. */
export type PermissionDeniedPayload = {
  code: "PERMISSION_DENIED";
  permission: string;
  reason: string;
  scope: PermissionScope;
};

export class PermissionEnforcementError extends Error {
  readonly code = "PERMISSION_DENIED" as const;
  readonly permission: string;
  readonly scope: PermissionScope;
  readonly decision: AuthorizationDecision;

  constructor(decision: AuthorizationDecision) {
    super(decision.reason);
    this.name = "PermissionEnforcementError";
    this.permission = decision.permission;
    this.scope = decision.scope;
    this.decision = decision;
  }

  toJSON(): PermissionDeniedPayload {
    return {
      code: "PERMISSION_DENIED",
      permission: this.permission,
      reason: this.message,
      scope: this.scope,
    };
  }
}

export function permissionDeniedPayload(decision: AuthorizationDecision): PermissionDeniedPayload {
  return {
    code: "PERMISSION_DENIED",
    permission: decision.permission,
    reason: decision.reason,
    scope: decision.scope,
  };
}

export type EnforceContext = AuthorizationContext & {
  /** Identificação da operação para o diagnóstico (ex.: "properties.upsert"). */
  operation?: string;
  /** Recurso alvo (id do imóvel, stakeholder, membro, documento...). */
  resource?: string | null;
};

export type EnforcementOutcome = {
  allowed: boolean;
  enforced: boolean;
  decision: AuthorizationDecision;
};

/* ------------------------------------------------------- log de diagnóstico */

export type EnforcementLogEntry = {
  at: string;
  operation: string;
  userId: string;
  tenantId: string;
  resource: string | null;
  permission: string;
  required: AccessLevel;
  effective: AccessLevel;
  scope: PermissionScope;
  reason: string;
  /** `blocked` = operação interrompida; `shadow` = negada mas tolerada (legado). */
  outcome: "blocked" | "shadow";
};

const LOG_LIMIT = 300;
const enforcementLog: EnforcementLogEntry[] = [];

function record(entry: EnforcementLogEntry): void {
  enforcementLog.push(entry);
  if (enforcementLog.length > LOG_LIMIT) enforcementLog.shift();
  const tag = entry.outcome === "blocked" ? "bloqueado" : "shadow";
  console.warn(
    `[authz][enforce] ${tag} — operação=${entry.operation} usuário=${entry.userId} ` +
      `tenant=${entry.tenantId} recurso=${entry.resource ?? "-"} permissão=${entry.permission} ` +
      `exigido=${entry.required} efetivo=${entry.effective} ` +
      `escopo=${entry.scope.type}:${entry.scope.id ?? "-"} motivo=${entry.reason}`,
  );
}

export function readEnforcementLog(limit = 50): EnforcementLogEntry[] {
  return enforcementLog.slice(-limit).reverse();
}

export function clearEnforcementLog(): void {
  enforcementLog.length = 0;
}

/* ------------------------------------------------------- núcleo determinístico */

/** Decide o desfecho a partir de uma decisão do guard (testável, sem I/O). */
export function resolveOutcome(
  decision: AuthorizationDecision,
  snapshot: Pick<SubjectSnapshot, "assignments" | "status">,
  mode: EnforcementMode = ENFORCEMENT_MODE,
): EnforcementOutcome {
  if (decision.allowed) return { allowed: true, enforced: true, decision };

  // Sujeito inativo nunca passa, mesmo no modo progressivo.
  const inactive = snapshot.status === "revoked" || snapshot.status === "pending";
  const migrated = snapshot.assignments.length > 0;

  if (mode === "strict" || inactive || migrated) {
    return { allowed: false, enforced: true, decision };
  }
  return { allowed: false, enforced: false, decision };
}

/* --------------------------------------------------------------- API pública */

/**
 * `requireAccess` — valida e lança `PermissionEnforcementError` quando negado.
 * Ponto obrigatório de entrada de qualquer operação protegida do backend.
 */
export async function requireAccess(
  subjectId: string,
  permission: string,
  context: EnforceContext = {},
): Promise<AuthorizationDecision> {
  const snapshot = context.snapshot ?? (await resolveSubjectSnapshot(subjectId, context));
  const decision = await can(subjectId, permission, { ...context, snapshot });
  const outcome = resolveOutcome(decision, snapshot);

  if (!decision.allowed) {
    record({
      at: new Date().toISOString(),
      operation: context.operation ?? permission,
      userId: subjectId,
      tenantId: snapshot.subject.tenantId,
      resource: context.resource ?? context.propertyId ?? context.recordId ?? null,
      permission: decision.permission,
      required: decision.required,
      effective: decision.effective,
      scope: decision.scope,
      reason: decision.reason,
      outcome: outcome.enforced ? "blocked" : "shadow",
    });
  }

  if (!outcome.allowed && outcome.enforced) throw new PermissionEnforcementError(decision);
  return decision;
}

/** Variante silenciosa — devolve o desfecho sem lançar. */
export async function checkAccess(
  subjectId: string,
  permission: string,
  context: EnforceContext = {},
): Promise<EnforcementOutcome> {
  const snapshot = context.snapshot ?? (await resolveSubjectSnapshot(subjectId, context));
  const decision = await can(subjectId, permission, { ...context, snapshot });
  return resolveOutcome(decision, snapshot);
}

/**
 * `withPermission` — envolve uma operação de backend com validação de permissão.
 *
 *   const run = withPermission("tenant.imoveis.editor", { required: "WRITE" },
 *     async ({ userId }) => { ... });
 */
export function withPermission<A extends unknown[], R>(
  permission: string,
  context: EnforceContext & { required?: AccessLevel },
  operation: (args: { userId: string; decision: AuthorizationDecision }, ...rest: A) => Promise<R>,
) {
  return async (userId: string, ...rest: A): Promise<R> => {
    const decision = await requireAccess(userId, permission, context);
    return operation({ userId, decision }, ...rest);
  };
}

/**
 * `withResourceAccess` — igual ao anterior, porém o escopo (imóvel, cliente ou
 * registro) é derivado dos argumentos da operação.
 */
export function withResourceAccess<A extends unknown[], R>(
  permission: string,
  resolveContext: (...rest: A) => EnforceContext,
  operation: (args: { userId: string; decision: AuthorizationDecision }, ...rest: A) => Promise<R>,
) {
  return async (userId: string, ...rest: A): Promise<R> => {
    const context = resolveContext(...rest);
    const decision = await requireAccess(userId, permission, context);
    return operation({ userId, decision }, ...rest);
  };
}

export const permissionEnforcer = {
  enforce,
  requireAccess,
  checkAccess,
  withPermission,
  withResourceAccess,
  resolveOutcome,
  readEnforcementLog,
  clearEnforcementLog,
  permissionDeniedPayload,
  ENFORCEMENT_MODE,
};

/* ------------------------------------------- atalho pelo mapa de operações */

/**
 * `enforce` — atalho tipado usando o mapa `PROTECTED_OPERATIONS`.
 * É a forma recomendada de proteger uma server function existente:
 *
 *   await enforce(context.userId, "imoveis.editor.write", { propertyId: id });
 */
export async function enforce(
  subjectId: string,
  key: ProtectedOperationKey,
  context: Omit<EnforceContext, "required"> = {},
): Promise<AuthorizationDecision> {
  const op = protectedOperation(key);
  return requireAccess(subjectId, op.permission, {
    ...context,
    required: op.required,
    operation: context.operation ?? key,
  });
}
