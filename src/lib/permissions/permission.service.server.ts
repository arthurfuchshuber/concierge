/**
 * Permission Service — orquestra Registry + Repository + Engine.
 *
 * FASE 1: disponível, porém nenhum fluxo, rota ou tela existente o consome.
 */
import { permissionEngine } from "./permission.engine";
import { permissionRegistry, runAutoDiscovery } from "./permission.registry";
import {
  permissionRepository,
  type UpsertAssignmentInput,
} from "./permission.repository.server";
import type {
  AccessLevel,
  PermissionDecision,
  PermissionScope,
  PermissionSubject,
} from "./permission.types";

/** Resolve o nível efetivo e decide o acesso consultando o banco. */
export async function checkPermission(args: {
  subject: PermissionSubject;
  nodeSlug: string;
  required: AccessLevel;
  scope?: PermissionScope;
}): Promise<PermissionDecision> {
  const { subject, nodeSlug, required, scope } = args;

  if (permissionEngine.isOwner(subject)) {
    return permissionEngine.evaluate({ subject, nodeSlug, required, scope, assignments: [] });
  }

  const [assignments, nodeIdBySlug] = await Promise.all([
    permissionRepository.listAssignments(subject.tenantId, subject.userId),
    permissionRepository.nodeIdBySlug(),
  ]);

  return permissionEngine.evaluate({
    subject,
    nodeSlug,
    required,
    scope,
    assignments,
    nodeIdBySlug,
  });
}

/** Nível efetivo do subject em um nó, sem exigir um mínimo. */
export async function resolveAccessLevel(
  subject: PermissionSubject,
  nodeSlug: string,
  scope?: PermissionScope,
): Promise<AccessLevel> {
  const decision = await checkPermission({ subject, nodeSlug, required: "NONE", scope });
  return decision.effective;
}

/**
 * Grava uma permissão. Permissões do OWNER são imutáveis por regra estrutural.
 */
export async function assignPermission(
  input: UpsertAssignmentInput & { actorId?: string | null; actorName?: string | null },
) {
  const target: PermissionSubject = { userId: input.userId, tenantId: input.tenantId };
  if (permissionEngine.assignmentsAreImmutable(target)) {
    throw new Error("As permissões do titular (OWNER) não podem ser editadas.");
  }

  const before = await permissionRepository.listAssignments(input.tenantId, input.userId);
  const previous = before.find(
    (a) =>
      a.permission_node_id === input.permissionNodeId &&
      a.scope_type === (input.scopeType ?? "TENANT") &&
      (a.scope_id ?? null) === (input.scopeId ?? null),
  );

  const saved = await permissionRepository.upsertAssignment(input);

  await permissionRepository.recordAudit({
    tenantId: input.tenantId,
    actorId: input.actorId ?? input.createdBy ?? null,
    actorName: input.actorName ?? null,
    targetUserId: input.userId,
    permissionNodeId: input.permissionNodeId,
    previousAccessLevel: previous?.access_level ?? null,
    newAccessLevel: input.accessLevel,
    scopeType: input.scopeType ?? "TENANT",
    scopeId: input.scopeId ?? null,
    action: previous ? "update" : "create",
  });

  return saved;
}

/** Sincroniza o Registry (catálogo + auto discovery) com a tabela de nós. */
export async function syncRegistryToDatabase(): Promise<{ synced: number; errors: string[] }> {
  bootstrapPermissionRegistry();
  runAutoDiscovery();
  const validation = permissionRegistry.validate();
  if (!validation.ok) return { synced: 0, errors: validation.errors };
  const defs = permissionRegistry.list();
  if (!defs.length) return { synced: 0, errors: [] };
  const synced = await permissionRepository.upsertNodes(defs);
  return { synced, errors: [] };
}

/** Relatório de consistência da árvore (rotas sem nó, pais quebrados etc.). */
export function inspectRegistryConsistency() {
  bootstrapPermissionRegistry();
  const report = buildConsistencyReport();
  logConsistencyReport(report);
  return report;
}

/** Achados do Lovable Guardian (recursos novos sem Permission Node). */
export function inspectGuardian() {
  bootstrapPermissionRegistry();
  return lovableGuardian.inspect();
}

export const permissionService = {
  checkPermission,
  resolveAccessLevel,
  assignPermission,
  syncRegistryToDatabase,
  inspectRegistryConsistency,
  inspectGuardian,
};

