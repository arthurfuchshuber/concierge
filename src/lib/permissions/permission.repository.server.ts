/**
 * Permission Repository — único ponto de acesso ao banco para permissões.
 *
 * FASE 1: implementado, porém nenhum fluxo existente o utiliza.
 * Usa o cliente admin porque o engine roda server-side e faz o próprio
 * isolamento por tenant em cada consulta.
 */
import type {
  AccessLevel,
  PermissionAssignment,
  PermissionAuditEntry,
  PermissionNode,
  PermissionNodeDefinition,
  PropertyAssignment,
  ScopeType,
} from "./permission.types";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/* ------------------------------------------------------------------ nodes */

export async function listNodes(): Promise<PermissionNode[]> {
  const db = await admin();
  const { data, error } = await db
    .from("permission_nodes")
    .select("*")
    .order("order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as PermissionNode[];
}

export async function getNodeBySlug(slug: string): Promise<PermissionNode | null> {
  const db = await admin();
  const { data, error } = await db.from("permission_nodes").select("*").eq("slug", slug).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as PermissionNode) ?? null;
}

/** Mapa slug → id, consumido pelo engine na avaliação. */
export async function nodeIdBySlug(): Promise<Record<string, string>> {
  const nodes = await listNodes();
  const map: Record<string, string> = {};
  for (const node of nodes) map[node.slug] = node.id;
  return map;
}

/**
 * Sincroniza definições do Registry com a tabela (upsert por slug).
 * Nenhum nó é apagado — compatibilidade total com o que já existe.
 */
export async function upsertNodes(defs: PermissionNodeDefinition[]): Promise<number> {
  if (!defs.length) return 0;
  const db = await admin();
  const existing = await nodeIdBySlug();
  const rows = defs.map((d) => ({
    slug: d.slug,
    name: d.name,
    type: d.type,
    description: d.description ?? null,
    order: d.order ?? 0,
    active: d.active ?? true,
    parent_id: d.parentSlug ? (existing[d.parentSlug] ?? null) : null,
  }));
  const { error } = await db.from("permission_nodes").upsert(rows as never, { onConflict: "slug" });
  if (error) throw new Error(error.message);
  return rows.length;
}

/* ------------------------------------------------------ permission assignments */

export async function listAssignments(
  tenantId: string,
  userId?: string,
): Promise<PermissionAssignment[]> {
  const db = await admin();
  let query = db.from("permission_assignments").select("*").eq("tenant_id", tenantId);
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as PermissionAssignment[];
}

export type UpsertAssignmentInput = {
  tenantId: string;
  userId: string;
  permissionNodeId: string;
  accessLevel: AccessLevel;
  scopeType?: ScopeType;
  scopeId?: string | null;
  createdBy?: string | null;
};

export async function upsertAssignment(
  input: UpsertAssignmentInput,
): Promise<PermissionAssignment> {
  const db = await admin();
  const { data, error } = await db
    .from("permission_assignments")
    .upsert(
      {
        tenant_id: input.tenantId,
        user_id: input.userId,
        permission_node_id: input.permissionNodeId,
        access_level: input.accessLevel,
        scope_type: input.scopeType ?? "TENANT",
        scope_id: input.scopeId ?? null,
        created_by: input.createdBy ?? null,
      } as never,
      { onConflict: "tenant_id,user_id,permission_node_id,scope_type,scope_id" },
    )
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as unknown as PermissionAssignment;
}

export async function deleteAssignment(tenantId: string, assignmentId: string): Promise<void> {
  const db = await admin();
  const { error } = await db
    .from("permission_assignments")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", assignmentId);
  if (error) throw new Error(error.message);
}

/* -------------------------------------------------------- property assignments */

export async function listPropertyAssignments(
  tenantId: string,
  userId?: string,
): Promise<PropertyAssignment[]> {
  const db = await admin();
  let query = db.from("property_assignments").select("*").eq("tenant_id", tenantId);
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as PropertyAssignment[];
}

export async function upsertPropertyAssignment(input: {
  tenantId: string;
  propertyId: string;
  userId: string;
  status?: string;
  createdBy?: string | null;
}): Promise<PropertyAssignment> {
  const db = await admin();
  const { data, error } = await db
    .from("property_assignments")
    .upsert(
      {
        tenant_id: input.tenantId,
        property_id: input.propertyId,
        user_id: input.userId,
        status: input.status ?? "active",
        created_by: input.createdBy ?? null,
      } as never,
      { onConflict: "tenant_id,property_id,user_id" },
    )
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as unknown as PropertyAssignment;
}

/* ------------------------------------------------------------------- audit */

export type AuditInput = {
  tenantId: string;
  actorId?: string | null;
  actorName?: string | null;
  targetUserId?: string | null;
  permissionNodeId?: string | null;
  previousAccessLevel?: AccessLevel | null;
  newAccessLevel?: AccessLevel | null;
  scopeType?: ScopeType | null;
  scopeId?: string | null;
  action?: string;
  metadata?: Record<string, unknown> | null;
};

/** Auditoria nunca derruba a operação principal. */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    const db = await admin();
    await db.from("permission_audit").insert({
      tenant_id: input.tenantId,
      actor_id: input.actorId ?? null,
      actor_name: input.actorName ?? null,
      target_user_id: input.targetUserId ?? null,
      permission_node_id: input.permissionNodeId ?? null,
      previous_access_level: input.previousAccessLevel ?? null,
      new_access_level: input.newAccessLevel ?? null,
      scope_type: input.scopeType ?? null,
      scope_id: input.scopeId ?? null,
      action: input.action ?? "update",
      metadata: (input.metadata ?? null) as never,
    } as never);
  } catch (err) {
    console.error("[permissions] falha ao registrar auditoria", err);
  }
}

export async function listAudit(tenantId: string, limit = 100): Promise<PermissionAuditEntry[]> {
  const db = await admin();
  const { data, error } = await db
    .from("permission_audit")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as PermissionAuditEntry[];
}

export const permissionRepository = {
  listNodes,
  getNodeBySlug,
  nodeIdBySlug,
  upsertNodes,
  listAssignments,
  upsertAssignment,
  deleteAssignment,
  listPropertyAssignments,
  upsertPropertyAssignment,
  recordAudit,
  listAudit,
};
