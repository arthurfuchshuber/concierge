/**
 * Permission Resolve (FASE 3.6) — camada de resolução.
 *
 * Transforma "usuário + contexto" em "permissões efetivas disponíveis".
 * NÃO decide nada: apenas carrega e normaliza o estado do sujeito
 * (tenant, papéis, plano, status, atribuições e imóveis vinculados).
 *
 * Nenhum fluxo, rota ou tela existente é alterado por este módulo.
 */
import { bootstrapPermissionRegistry } from "./permission.bootstrap";
import { permissionEngine } from "./permission.engine";
import { permissionRegistry } from "./permission.registry";
import { permissionRepository } from "./permission.repository.server";
import { resolveSlug } from "./permission.slugs";
import type {
  AccessLevel,
  PermissionAssignment,
  PermissionScope,
  PermissionSubject,
  SystemRole,
} from "./permission.types";

/** Status operacional do sujeito dentro do tenant. */
export type SubjectStatus = "active" | "pending" | "revoked" | "unknown";

/** Fotografia completa usada por qualquer decisão de autorização. */
export type SubjectSnapshot = {
  subject: PermissionSubject;
  status: SubjectStatus;
  /** Imóveis com vínculo ATIVO (escopo PROPERTY). */
  properties: string[];
  assignments: PermissionAssignment[];
  nodeIdBySlug: Record<string, string>;
  /** Slugs ativos conhecidos no banco (quando disponíveis). */
  activeSlugs: string[];
};

/** Contexto opcional informado pelo chamador. */
export type ResolveContext = {
  tenantId?: string | null;
  systemRoles?: SystemRole[];
  plan?: string | null;
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Descobre o tenant (titular da conta) e o status do usuário. */
export async function resolveTenantOf(
  userId: string,
): Promise<{ tenantId: string; status: SubjectStatus; role: string | null }> {
  const db = await admin();
  const { data } = await db
    .from("account_members")
    .select("owner_id, role, status")
    .eq("member_user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!data) return { tenantId: userId, status: "active", role: "owner" };

  const status = ((data.status as string) ?? "active") as SubjectStatus;
  return {
    tenantId: (data.owner_id as string) ?? userId,
    status: ["active", "pending", "revoked"].includes(status) ? status : "unknown",
    role: (data.role as string) ?? null,
  };
}

async function resolveSystemRoles(userId: string, tenantId: string): Promise<SystemRole[]> {
  const roles: SystemRole[] = [];
  if (userId === tenantId) roles.push("OWNER");
  try {
    const db = await admin();
    const { data } = await db
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (data) roles.push("ADMIN_SAAS");
  } catch {
    /* papéis do SaaS são opcionais para a decisão */
  }
  return roles;
}

async function resolvePlan(tenantId: string): Promise<string | null> {
  try {
    const { resolveOwnerPlanAdmin } = await import("@/lib/plan-guard.server");
    const db = await admin();
    const resolved = await resolveOwnerPlanAdmin(db, tenantId);
    return resolved.plan ?? null;
  } catch {
    return null;
  }
}

/** Carrega tudo o que uma decisão de autorização precisa, em uma única passada. */
export async function resolveSubjectSnapshot(
  userId: string,
  ctx: ResolveContext = {},
): Promise<SubjectSnapshot> {
  bootstrapPermissionRegistry();

  const resolvedTenant = ctx.tenantId
    ? { tenantId: ctx.tenantId, status: "unknown" as SubjectStatus, role: null }
    : await resolveTenantOf(userId);

  // Quando o tenant vem por parâmetro, ainda precisamos do status real.
  let status = resolvedTenant.status;
  if (ctx.tenantId) {
    if (ctx.tenantId === userId) status = "active";
    else {
      const membership = await resolveTenantOf(userId);
      status = membership.tenantId === ctx.tenantId ? membership.status : "revoked";
    }
  }

  const tenantId = resolvedTenant.tenantId;

  const [systemRoles, plan, assignments, nodeIdBySlug, propertyRows] = await Promise.all([
    ctx.systemRoles ? Promise.resolve(ctx.systemRoles) : resolveSystemRoles(userId, tenantId),
    ctx.plan !== undefined ? Promise.resolve(ctx.plan) : resolvePlan(tenantId),
    permissionRepository.listAssignments(tenantId, userId).catch(() => []),
    permissionRepository.nodeIdBySlug().catch(() => ({}) as Record<string, string>),
    permissionRepository.listPropertyAssignments(tenantId, userId).catch(() => []),
  ]);

  return {
    subject: { userId, tenantId, systemRoles, plan, isTenantMember: userId !== tenantId },
    status,
    properties: propertyRows
      .filter((r) => (r.status ?? "active") === "active")
      .map((r) => r.property_id),
    assignments,
    nodeIdBySlug,
    activeSlugs: Object.keys(nodeIdBySlug),
  };
}

/**
 * Permissões efetivas do sujeito no contexto informado.
 * Retorna o nível resolvido para cada nó permissionável conhecido.
 */
export function effectivePermissionsFromSnapshot(
  snapshot: SubjectSnapshot,
  scope?: PermissionScope,
): Record<string, AccessLevel> {
  const out: Record<string, AccessLevel> = {};
  for (const node of permissionRegistry.list()) {
    if (node.isPermissionable === false) continue;
    const decision = permissionEngine.evaluate({
      subject: snapshot.subject,
      nodeSlug: node.slug,
      required: "NONE",
      scope,
      assignments: snapshot.assignments,
      nodeIdBySlug: snapshot.nodeIdBySlug,
    });
    if (decision.effective !== "NONE") out[node.slug] = decision.effective;
  }
  return out;
}

/** Atalho: usuário + contexto → permissões efetivas. */
export async function resolveEffectivePermissions(
  userId: string,
  ctx: ResolveContext & { scope?: PermissionScope } = {},
): Promise<{ snapshot: SubjectSnapshot; permissions: Record<string, AccessLevel> }> {
  const snapshot = await resolveSubjectSnapshot(userId, ctx);
  return { snapshot, permissions: effectivePermissionsFromSnapshot(snapshot, ctx.scope) };
}

/** Normaliza o identificador de permissão (aliases/namespaces legados). */
export function normalizePermission(permission: string): string {
  return resolveSlug(permission);
}

export const permissionResolver = {
  resolveTenantOf,
  resolveSubjectSnapshot,
  effectivePermissionsFromSnapshot,
  resolveEffectivePermissions,
  normalizePermission,
};
