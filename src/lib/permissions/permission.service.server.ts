/**
 * Permission Service — orquestra Registry + Repository + Engine.
 *
 * FASE 1: disponível, porém nenhum fluxo, rota ou tela existente o consome.
 */
import { bootstrapPermissionRegistry } from "./permission.bootstrap";
import { buildConsistencyReport, logConsistencyReport } from "./permission.consistency";
import { permissionEngine } from "./permission.engine";
import { lovableGuardian } from "./permission.guardian";
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

/**
 * Sincroniza o Registry (catálogo + auto discovery) com a tabela de nós.
 * Delegado ao sync OFICIAL da Fase 3.5 (com log de execução e soft delete).
 */
export async function syncRegistryToDatabase(
  triggeredBy?: string | null,
): Promise<{ synced: number; errors: string[] }> {
  const { syncPermissionRegistry } = await import("./permission.sync.server");
  const report = await syncPermissionRegistry({ triggeredBy: triggeredBy ?? null });
  return { synced: report.created + report.updated, errors: report.errors };
}

/** Atribui um imóvel a um usuário (escopo operacional PROPERTY). */
export async function assignUserToProperty(input: {
  tenantId: string;
  propertyId: string;
  userId: string;
  actorId?: string | null;
  actorName?: string | null;
}) {
  const saved = await permissionRepository.upsertPropertyAssignment({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    userId: input.userId,
    createdBy: input.actorId ?? null,
  });
  await permissionRepository.recordAudit({
    tenantId: input.tenantId,
    actorId: input.actorId ?? null,
    actorName: input.actorName ?? null,
    targetUserId: input.userId,
    scopeType: "PROPERTY",
    scopeId: input.propertyId,
    action: "property.assign",
  });
  return saved;
}

/** Remove o vínculo de um imóvel com um usuário. */
export async function removeUserFromProperty(input: {
  tenantId: string;
  propertyId: string;
  userId: string;
  actorId?: string | null;
  actorName?: string | null;
}) {
  await permissionRepository.deletePropertyAssignment(
    input.tenantId,
    input.propertyId,
    input.userId,
  );
  await permissionRepository.recordAudit({
    tenantId: input.tenantId,
    actorId: input.actorId ?? null,
    actorName: input.actorName ?? null,
    targetUserId: input.userId,
    scopeType: "PROPERTY",
    scopeId: input.propertyId,
    action: "property.revoke",
  });
}

/** Imóveis atribuídos a um usuário dentro da conta. */
export async function listUserProperties(
  tenantId: string,
  userId: string,
): Promise<string[]> {
  const rows = await permissionRepository.listPropertyAssignments(tenantId, userId);
  return rows.filter((r) => (r.status ?? "active") === "active").map((r) => r.property_id);
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

