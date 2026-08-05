/**
 * Permission Center (FASE 4.3) — camada de MUTAÇÃO.
 *
 * REGRAS DESTA FASE:
 *  - Nada do Registry, Guardian, Enforcement, escopos ou roles é alterado.
 *  - Apenas ATRIBUIÇÕES são criadas/removidas (usuários, roles, grants diretos,
 *    escopos e vínculos de imóvel).
 *  - Toda mutação passa obrigatoriamente por `permission.enforce.server.ts`
 *    (validação estrita: executor, tenant, escopo e permissão administrativa).
 *  - Toda mutação é auditada (usuário alterado, alteração, executor, data/hora).
 */
import { PERMISSION_CENTER_SLUG } from "./permission.center.server";
import { permissionRepository } from "./permission.repository.server";
import { resolveSubjectSnapshot, resolveTenantOf } from "./permission.resolve.server";
import { SCOPE_TYPES, type AccessLevel, type ScopeType } from "./permission.types";

export type MutationResult = { ok: true; message: string };

const ACCOUNT_ROLES = ["owner", "agent", "viewer"] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

const ROLE_LABEL: Record<string, string> = {
  owner: "Titular da conta",
  agent: "Atendente",
  viewer: "Visualizador",
};

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/* ---------------------------------------------------------------- guarda */

export type CenterWriteContext = {
  actorId: string;
  actorName: string | null;
  tenantId: string;
};

/**
 * Validação administrativa obrigatória para QUALQUER mutação do centro.
 * Diferente da leitura, aqui a decisão é aplicada de forma estrita: mesmo em
 * modo progressivo, uma negação do guard bloqueia a operação.
 */
export async function assertCenterWrite(
  actorId: string,
  scope: { scopeType?: ScopeType; scopeId?: string | null } = {},
): Promise<CenterWriteContext> {
  const { requireAccess, PermissionEnforcementError } = await import("./permission.enforce.server");
  const snapshot = await resolveSubjectSnapshot(actorId);

  const decision = await requireAccess(actorId, PERMISSION_CENTER_SLUG, {
    snapshot,
    required: "WRITE",
    operation: "permission-center:write",
    ...(scope.scopeType === "PROPERTY" && scope.scopeId ? { propertyId: scope.scopeId } : {}),
    ...(scope.scopeType === "RECORD" && scope.scopeId ? { recordId: scope.scopeId } : {}),
  });

  if (!decision.allowed) throw new PermissionEnforcementError(decision);

  const client = await db();
  const { data: profile } = await client
    .from("profiles")
    .select("full_name, trade_name")
    .eq("id", actorId)
    .maybeSingle();

  return {
    actorId,
    actorName: ((profile?.trade_name as string) || (profile?.full_name as string)) ?? null,
    tenantId: snapshot.subject.tenantId,
  };
}

/** O alvo precisa pertencer ao mesmo tenant do executor. */
async function assertSameTenant(tenantId: string, targetUserId: string) {
  if (targetUserId === tenantId) return "owner";
  const client = await db();
  const { data } = await client
    .from("account_members")
    .select("role")
    .eq("owner_id", tenantId)
    .eq("member_user_id", targetUserId)
    .maybeSingle();
  if (!data) throw new Error("Usuário não pertence a esta conta.");
  return (data.role as string) ?? "agent";
}

async function audit(
  ctx: CenterWriteContext,
  input: {
    targetUserId?: string | null;
    action: string;
    permissionNodeId?: string | null;
    previous?: AccessLevel | null;
    next?: AccessLevel | null;
    scopeType?: ScopeType | null;
    scopeId?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  await permissionRepository.recordAudit({
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    actorName: ctx.actorName,
    targetUserId: input.targetUserId ?? null,
    permissionNodeId: input.permissionNodeId ?? null,
    previousAccessLevel: input.previous ?? null,
    newAccessLevel: input.next ?? null,
    scopeType: input.scopeType ?? null,
    scopeId: input.scopeId ?? null,
    action: input.action,
    metadata: { ...(input.metadata ?? {}), at: new Date().toISOString() },
  });
}

/* ------------------------------------------------------------- usuários */

/** Cria o acesso de um novo usuário (convite pendente na conta). */
export async function createCenterUser(
  actorId: string,
  input: { email: string; role: AccountRole },
): Promise<MutationResult> {
  const ctx = await assertCenterWrite(actorId);
  const email = input.email.trim().toLowerCase();
  const client = await db();

  const { data: existing } = await client
    .from("account_member_invites")
    .select("id")
    .eq("owner_id", ctx.tenantId)
    .eq("email", email)
    .eq("status", "pending")
    .maybeSingle();

  if (!existing) {
    const { error } = await client.from("account_member_invites").insert({
      owner_id: ctx.tenantId,
      email,
      role: input.role,
      invited_by: ctx.actorId,
    } as never);
    if (error) throw new Error(error.message);
  }

  await audit(ctx, {
    action: "user.create",
    metadata: { email, role: input.role, roleLabel: ROLE_LABEL[input.role] },
  });
  return { ok: true, message: `Convite de acesso criado para ${email}.` };
}

/** Atualiza o papel do usuário dentro da conta. */
export async function updateCenterUserRole(
  actorId: string,
  input: { targetUserId: string; role: AccountRole },
): Promise<MutationResult> {
  const ctx = await assertCenterWrite(actorId);
  if (input.targetUserId === ctx.tenantId) throw new Error("O papel do titular da conta não pode ser alterado.");
  const previousRole = await assertSameTenant(ctx.tenantId, input.targetUserId);

  const client = await db();
  const { error } = await client
    .from("account_members")
    .update({ role: input.role } as never)
    .eq("owner_id", ctx.tenantId)
    .eq("member_user_id", input.targetUserId);
  if (error) throw new Error(error.message);

  await audit(ctx, {
    targetUserId: input.targetUserId,
    action: "role.assign",
    metadata: { previousRole, role: input.role, roleLabel: ROLE_LABEL[input.role] },
  });
  return { ok: true, message: `Papel atualizado para ${ROLE_LABEL[input.role] ?? input.role}.` };
}

/** Remove o papel atual, rebaixando o usuário para o papel mínimo (viewer). */
export async function removeCenterUserRole(
  actorId: string,
  input: { targetUserId: string },
): Promise<MutationResult> {
  const ctx = await assertCenterWrite(actorId);
  if (input.targetUserId === ctx.tenantId) throw new Error("O papel do titular da conta não pode ser removido.");
  const previousRole = await assertSameTenant(ctx.tenantId, input.targetUserId);

  const client = await db();
  const { error } = await client
    .from("account_members")
    .update({ role: "viewer" } as never)
    .eq("owner_id", ctx.tenantId)
    .eq("member_user_id", input.targetUserId);
  if (error) throw new Error(error.message);

  await audit(ctx, {
    targetUserId: input.targetUserId,
    action: "role.remove",
    metadata: { previousRole },
  });
  return { ok: true, message: "Papel removido. O usuário ficou como Visualizador." };
}

/** Ativa ou inativa o usuário. Usuário inativo não recebe nenhum acesso. */
export async function setCenterUserStatus(
  actorId: string,
  input: { targetUserId: string; status: "active" | "revoked" },
): Promise<MutationResult> {
  const ctx = await assertCenterWrite(actorId);
  if (input.targetUserId === ctx.tenantId) throw new Error("O titular da conta não pode ser inativado.");
  await assertSameTenant(ctx.tenantId, input.targetUserId);

  const client = await db();
  const { error } = await client
    .from("account_members")
    .update({ status: input.status } as never)
    .eq("owner_id", ctx.tenantId)
    .eq("member_user_id", input.targetUserId);
  if (error) throw new Error(error.message);

  await audit(ctx, {
    targetUserId: input.targetUserId,
    action: input.status === "active" ? "user.activate" : "user.deactivate",
    metadata: { status: input.status },
  });
  return {
    ok: true,
    message: input.status === "active" ? "Usuário ativado." : "Usuário inativado — acesso suspenso.",
  };
}

/** Remove por completo o acesso do usuário à conta (membro + atribuições). */
export async function removeCenterUser(
  actorId: string,
  input: { targetUserId: string },
): Promise<MutationResult> {
  const ctx = await assertCenterWrite(actorId);
  if (input.targetUserId === ctx.tenantId) throw new Error("O titular da conta não pode ser removido.");
  await assertSameTenant(ctx.tenantId, input.targetUserId);

  const client = await db();
  await client
    .from("permission_assignments")
    .delete()
    .eq("tenant_id", ctx.tenantId)
    .eq("user_id", input.targetUserId);
  await client
    .from("property_assignments")
    .delete()
    .eq("tenant_id", ctx.tenantId)
    .eq("user_id", input.targetUserId);
  const { error } = await client
    .from("account_members")
    .delete()
    .eq("owner_id", ctx.tenantId)
    .eq("member_user_id", input.targetUserId);
  if (error) throw new Error(error.message);

  await audit(ctx, { targetUserId: input.targetUserId, action: "user.remove" });
  return { ok: true, message: "Acesso removido da conta." };
}

/* -------------------------------------------------- permissões diretas */

async function nodeIdOf(namespace: string): Promise<string> {
  const map = await permissionRepository.nodeIdBySlug();
  const id = map[namespace];
  if (!id) throw new Error(`Permissão desconhecida: ${namespace}`);
  return id;
}

/** Concede uma permissão diretamente ao usuário (não altera o Registry). */
export async function grantCenterPermission(
  actorId: string,
  input: {
    targetUserId: string;
    namespace: string;
    level: Exclude<AccessLevel, "NONE">;
    scopeType?: ScopeType;
    scopeId?: string | null;
  },
): Promise<MutationResult> {
  const scopeType = input.scopeType ?? "TENANT";
  if (!SCOPE_TYPES.includes(scopeType)) throw new Error("Escopo inválido.");
  const ctx = await assertCenterWrite(actorId, { scopeType, scopeId: input.scopeId ?? null });
  await assertSameTenant(ctx.tenantId, input.targetUserId);

  const nodeId = await nodeIdOf(input.namespace);
  const before = (await permissionRepository.listAssignments(ctx.tenantId, input.targetUserId)).find(
    (a) => a.permission_node_id === nodeId && a.scope_type === scopeType,
  );

  await permissionRepository.upsertAssignment({
    tenantId: ctx.tenantId,
    userId: input.targetUserId,
    permissionNodeId: nodeId,
    accessLevel: input.level,
    scopeType,
    scopeId: input.scopeId ?? null,
    createdBy: ctx.actorId,
  });

  await audit(ctx, {
    targetUserId: input.targetUserId,
    action: "permission.grant",
    permissionNodeId: nodeId,
    previous: before?.access_level ?? "NONE",
    next: input.level,
    scopeType,
    scopeId: input.scopeId ?? null,
    metadata: { namespace: input.namespace },
  });
  return { ok: true, message: `Permissão ${input.namespace} concedida (${input.level}).` };
}

/** Remove uma permissão direta. A herança por papel permanece intacta. */
export async function revokeCenterPermission(
  actorId: string,
  input: { targetUserId: string; assignmentId: string },
): Promise<MutationResult> {
  const ctx = await assertCenterWrite(actorId);
  await assertSameTenant(ctx.tenantId, input.targetUserId);

  const assignments = await permissionRepository.listAssignments(ctx.tenantId, input.targetUserId);
  const target = assignments.find((a) => a.id === input.assignmentId);
  if (!target) throw new Error("Atribuição não encontrada nesta conta.");

  await permissionRepository.deleteAssignment(ctx.tenantId, input.assignmentId);

  await audit(ctx, {
    targetUserId: input.targetUserId,
    action: "permission.revoke",
    permissionNodeId: target.permission_node_id,
    previous: target.access_level,
    next: "NONE",
    scopeType: target.scope_type,
    scopeId: target.scope_id,
  });
  return { ok: true, message: "Permissão direta removida." };
}

/* ------------------------------------------------------------- escopos */

/**
 * Vincula ou desvincula um imóvel do usuário.
 * O imóvel é SEMPRE escopo — nenhuma permissão é criada por imóvel.
 */
export async function setCenterPropertyScope(
  actorId: string,
  input: { targetUserId: string; propertyId: string; assigned: boolean },
): Promise<MutationResult> {
  const ctx = await assertCenterWrite(actorId, { scopeType: "PROPERTY", scopeId: input.propertyId });
  await assertSameTenant(ctx.tenantId, input.targetUserId);

  const client = await db();
  const { data: property } = await client
    .from("properties")
    .select("id, name")
    .eq("id", input.propertyId)
    .eq("owner_id", ctx.tenantId)
    .maybeSingle();
  if (!property) throw new Error("Residência não pertence a esta conta.");

  if (input.assigned) {
    await permissionRepository.upsertPropertyAssignment({
      tenantId: ctx.tenantId,
      propertyId: input.propertyId,
      userId: input.targetUserId,
      createdBy: ctx.actorId,
    });
  } else {
    await permissionRepository.deletePropertyAssignment(
      ctx.tenantId,
      input.propertyId,
      input.targetUserId,
    );
  }

  await audit(ctx, {
    targetUserId: input.targetUserId,
    action: input.assigned ? "scope.property.assign" : "scope.property.remove",
    scopeType: "PROPERTY",
    scopeId: input.propertyId,
    metadata: { propertyName: (property.name as string) ?? null },
  });
  return {
    ok: true,
    message: input.assigned ? "Residência vinculada ao usuário." : "Vínculo com a residência removido.",
  };
}

export const permissionCenterMutations = {
  assertCenterWrite,
  createCenterUser,
  updateCenterUserRole,
  removeCenterUserRole,
  setCenterUserStatus,
  removeCenterUser,
  grantCenterPermission,
  revokeCenterPermission,
  setCenterPropertyScope,
};

export const ACCOUNT_ROLE_OPTIONS = ACCOUNT_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r]! }));

/** Utilitário interno usado nos testes de escopo. */
export async function tenantOf(userId: string) {
  return resolveTenantOf(userId);
}
