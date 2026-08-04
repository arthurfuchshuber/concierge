/**
 * Permission UI (server) — camada de acesso da interface de gerenciamento.
 *
 * Resolve o contexto (conta do cliente x Admin do SaaS), valida quem pode
 * gerenciar, monta os usuários gerenciáveis e delega ao Permission Admin.
 *
 * NÃO autoriza requisições do produto: a autorização segue no sistema atual.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SAAS_TENANT_ID,
  buildNodeTree,
  previewCascade,
  readAudit,
  readSubjectPermissions,
  setSubjectPermission,
  type PermissionContextKind,
  type PermissionSubjectDTO,
  type PermissionWorkspace,
} from "./permission.admin.server";
import type { AccessLevel } from "./permission.types";

type Ctx = {
  kind: PermissionContextKind;
  supabase: SupabaseClient;
  userId: string;
};

const ROLE_LABEL: Record<string, string> = {
  owner: "Titular da conta",
  agent: "Atendente",
  viewer: "Visualizador",
  admin: "Administrador do SaaS",
};

async function isSaasAdmin(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  return !!data;
}

/** Resolve tenant e valida se o caller pode gerenciar permissões no contexto. */
async function resolveTenant(ctx: Ctx): Promise<string> {
  if (ctx.kind === "saas") {
    if (!(await isSaasAdmin(ctx.supabase, ctx.userId))) {
      throw new Error("Apenas administradores do SaaS podem gerenciar estas permissões.");
    }
    return SAAS_TENANT_ID;
  }
  // Conta do cliente: o tenant é sempre o titular (owner) da conta do caller.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: membership } = await supabaseAdmin
    .from("account_members")
    .select("owner_id, role")
    .eq("member_user_id", ctx.userId)
    .eq("status", "active")
    .maybeSingle();
  const ownerId = (membership?.owner_id as string | null) ?? ctx.userId;
  if (ownerId !== ctx.userId && membership?.role !== "owner") {
    throw new Error("Apenas o titular da conta pode gerenciar as permissões da equipe.");
  }
  return ownerId;
}

async function profilesFor(ids: string[]) {
  const out: Record<string, { name: string | null; email: string | null }> = {};
  if (!ids.length) return out;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: profs } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, trade_name")
    .in("id", ids);
  for (const p of profs ?? []) {
    out[p.id as string] = {
      name: ((p.trade_name as string) || (p.full_name as string)) ?? null,
      email: null,
    };
  }
  const { data: users } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
  for (const u of users?.users ?? []) {
    if (!ids.includes(u.id)) continue;
    out[u.id] = { name: out[u.id]?.name ?? null, email: u.email ?? null };
  }
  return out;
}

/** Usuários gerenciáveis no contexto (equipe da conta ou admins do SaaS). */
async function listSubjects(ctx: Ctx, tenantId: string): Promise<PermissionSubjectDTO[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  if (ctx.kind === "saas") {
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role")
      .eq("role", "admin");
    const ids = [...new Set((roles ?? []).map((r) => r.user_id as string))];
    const profiles = await profilesFor(ids);
    return ids.map((id) => ({
      userId: id,
      name: profiles[id]?.name || profiles[id]?.email || id,
      email: profiles[id]?.email ?? null,
      role: "admin",
      roleLabel: ROLE_LABEL.admin,
      systemRole: "ADMIN_SAAS" as const,
      status: "active",
      // O próprio administrador logado nunca edita as próprias permissões.
      isOwner: id === ctx.userId,
      userType: "Administrador do SaaS",
    }));
  }

  const { data: members } = await supabaseAdmin
    .from("account_members")
    .select("member_user_id, role, status")
    .eq("owner_id", tenantId)
    .order("created_at", { ascending: true });

  const ids = [...new Set([tenantId, ...(members ?? []).map((m) => m.member_user_id as string)])];
  const profiles = await profilesFor(ids);

  const subjects: PermissionSubjectDTO[] = [
    {
      userId: tenantId,
      name: profiles[tenantId]?.name || profiles[tenantId]?.email || "Titular",
      email: profiles[tenantId]?.email ?? null,
      role: "owner",
      roleLabel: ROLE_LABEL.owner,
      systemRole: "OWNER",
      status: "active",
      isOwner: true,
      userType: "Titular da conta",
    },
  ];

  for (const m of members ?? []) {
    const id = m.member_user_id as string;
    if (id === tenantId) continue;
    const role = (m.role as string) ?? "agent";
    subjects.push({
      userId: id,
      name: profiles[id]?.name || profiles[id]?.email || id,
      email: profiles[id]?.email ?? null,
      role,
      roleLabel: ROLE_LABEL[role] ?? role,
      systemRole: role === "owner" ? "OWNER" : null,
      status: (m.status as string) ?? "active",
      isOwner: role === "owner",
      userType: "Membro da equipe",
    });
  }
  return subjects;
}

async function resolvePlan(ctx: Ctx, tenantId: string): Promise<{ plan: string | null; label: string }> {
  if (ctx.kind === "saas") return { plan: "enterprise", label: "Admin do SaaS" };
  const { resolveOwnerPlanAdmin } = await import("@/lib/plan-guard.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  try {
    const resolved = await resolveOwnerPlanAdmin(supabaseAdmin, tenantId);
    const plan = resolved.plan ?? null;
    return { plan, label: plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : "Gratuito" };
  } catch {
    return { plan: null, label: "Gratuito" };
  }
}

export async function resolvePermissionWorkspace(ctx: Ctx): Promise<PermissionWorkspace> {
  const tenantId = await resolveTenant(ctx);
  const { plan, label } = await resolvePlan(ctx, tenantId);
  const [{ nodes, blockedFeatures }, subjects] = await Promise.all([
    buildNodeTree({ plan, context: ctx.kind }),
    listSubjects(ctx, tenantId),
  ]);
  return {
    context: ctx.kind,
    tenantId,
    plan,
    planLabel: label,
    nodes,
    subjects,
    blockedFeatures,
  };
}

async function assertManageable(ctx: Ctx, tenantId: string, targetUserId: string) {
  const subjects = await listSubjects(ctx, tenantId);
  const subject = subjects.find((s) => s.userId === targetUserId);
  if (!subject) throw new Error("Usuário não pertence a este contexto de permissões.");
  return subject;
}

export async function loadSubjectPermissions(ctx: Ctx & { targetUserId: string }) {
  const tenantId = await resolveTenant(ctx);
  const subject = await assertManageable(ctx, tenantId, ctx.targetUserId);
  const { plan } = await resolvePlan(ctx, tenantId);
  const { nodes } = await buildNodeTree({ plan, context: ctx.kind });
  const perms = await readSubjectPermissions({
    tenantId,
    userId: ctx.targetUserId,
    isOwner: subject.isOwner,
    totalNodes: nodes.length,
  });
  return { ...perms, subject };
}

export async function previewSubjectCascade(ctx: Ctx & { targetUserId: string; slug: string }) {
  const tenantId = await resolveTenant(ctx);
  await assertManageable(ctx, tenantId, ctx.targetUserId);
  return previewCascade({ tenantId, userId: ctx.targetUserId, slug: ctx.slug });
}

export async function writeSubjectPermission(
  ctx: Ctx & { targetUserId: string; slug: string; level: AccessLevel },
) {
  const tenantId = await resolveTenant(ctx);
  const subject = await assertManageable(ctx, tenantId, ctx.targetUserId);
  const actor = await profilesFor([ctx.userId]);
  return setSubjectPermission({
    tenantId,
    userId: ctx.targetUserId,
    slug: ctx.slug,
    level: ctx.level,
    actorId: ctx.userId,
    actorName: actor[ctx.userId]?.name ?? actor[ctx.userId]?.email ?? null,
    isOwnerTarget: subject.isOwner,
  });
}

export async function compareSubjects(ctx: Ctx & { userA: string; userB: string }) {
  const tenantId = await resolveTenant(ctx);
  const [a, b] = await Promise.all([
    assertManageable(ctx, tenantId, ctx.userA),
    assertManageable(ctx, tenantId, ctx.userB),
  ]);
  const { plan } = await resolvePlan(ctx, tenantId);
  const { nodes } = await buildNodeTree({ plan, context: ctx.kind });
  const [permsA, permsB] = await Promise.all([
    readSubjectPermissions({ tenantId, userId: ctx.userA, isOwner: a.isOwner, totalNodes: nodes.length }),
    readSubjectPermissions({ tenantId, userId: ctx.userB, isOwner: b.isOwner, totalNodes: nodes.length }),
  ]);

  const levelOf = (perms: typeof permsA, slug: string, isOwner: boolean): AccessLevel =>
    isOwner ? "WRITE" : (perms.levels[slug] ?? "NONE");

  const differences = nodes
    .map((n) => ({
      slug: n.slug,
      label: n.label,
      type: n.type,
      depth: n.depth,
      levelA: levelOf(permsA, n.slug, a.isOwner),
      levelB: levelOf(permsB, n.slug, b.isOwner),
    }))
    .filter((row) => row.levelA !== row.levelB);

  return {
    subjectA: a,
    subjectB: b,
    totalNodes: nodes.length,
    differences,
  };
}

export async function loadAudit(ctx: Ctx) {
  const tenantId = await resolveTenant(ctx);
  const rows = await readAudit(tenantId, 150);
  const ids = [...new Set(rows.map((r) => r.targetUserId).filter((v): v is string => !!v))];
  const profiles = await profilesFor(ids);
  return {
    rows: rows.map((r) => ({
      ...r,
      targetName: r.targetUserId
        ? (profiles[r.targetUserId]?.name ?? profiles[r.targetUserId]?.email ?? r.targetUserId)
        : null,
    })),
  };
}

/* ------------------------------------------------- FASE 3.5: sync e escopos */

/** Dispara o sync OFICIAL do Registry (exclusivo do Admin do SaaS). */
export async function runRegistrySync(ctx: Ctx) {
  if (!(await isSaasAdmin(ctx.supabase, ctx.userId))) {
    throw new Error("Apenas administradores do SaaS podem sincronizar a árvore de permissões.");
  }
  const { syncPermissionRegistry } = await import("./permission.sync.server");
  return syncPermissionRegistry({ triggeredBy: ctx.userId });
}

/** Diagnóstico completo: consistência, Guardian e histórico de sincronizações. */
export async function loadRegistryDiagnostics(ctx: Ctx) {
  if (!(await isSaasAdmin(ctx.supabase, ctx.userId))) {
    throw new Error("Apenas administradores do SaaS podem consultar o diagnóstico.");
  }
  const [{ inspectRegistryConsistency, inspectGuardian }, { listSyncRuns }] = await Promise.all([
    import("./permission.service.server"),
    import("./permission.sync.server"),
  ]);
  const consistency = inspectRegistryConsistency();
  const guardian = inspectGuardian();
  let runs: unknown[] = [];
  try {
    runs = await listSyncRuns(10);
  } catch (err) {
    console.error("[permissions] falha ao ler execuções de sync", err);
  }
  return { consistency, guardian, runs };
}

/** Imóveis atribuídos a um membro (escopo operacional PROPERTY). */
export async function loadUserProperties(ctx: Ctx & { targetUserId: string }) {
  const tenantId = await resolveTenant(ctx);
  await assertManageable(ctx, tenantId, ctx.targetUserId);
  const { listUserProperties } = await import("./permission.service.server");
  const propertyIds = await listUserProperties(tenantId, ctx.targetUserId);

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: properties } = await supabaseAdmin
    .from("properties")
    .select("id, name")
    .eq("user_id", tenantId)
    .order("name", { ascending: true });

  return {
    tenantId,
    assigned: propertyIds,
    properties: (properties ?? []).map((p) => ({ id: p.id, name: p.name })),
  };
}

/** Vincula ou desvincula um imóvel de um membro da equipe. */
export async function writeUserProperty(
  ctx: Ctx & { targetUserId: string; propertyId: string; assigned: boolean },
) {
  const tenantId = await resolveTenant(ctx);
  const subject = await assertManageable(ctx, tenantId, ctx.targetUserId);
  if (subject.isOwner) {
    throw new Error("O titular da conta já possui acesso a todos os imóveis.");
  }

  const { validateScope } = await import("./permission.scopes");
  const check = validateScope({
    nodeSlug: "tenant.imoveis",
    scope: { type: "PROPERTY", id: ctx.propertyId },
  });
  if (!check.ok) throw new Error(check.errors.join(" "));

  const service = await import("./permission.service.server");
  if (ctx.assigned) {
    await service.assignUserToProperty({
      tenantId,
      propertyId: ctx.propertyId,
      userId: ctx.targetUserId,
      actorId: ctx.userId,
    });
  } else {
    await service.removeUserFromProperty({
      tenantId,
      propertyId: ctx.propertyId,
      userId: ctx.targetUserId,
      actorId: ctx.userId,
    });
  }
  return { ok: true, propertyId: ctx.propertyId, assigned: ctx.assigned };
}
